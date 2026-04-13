/**
 * @fileoverview Speed scheduler pure functions and integration helpers.
 *
 * Implements a time-based speed limit window: when both `speedLimitEnabled`
 * AND `speedScheduleEnabled` are true, the scheduler pushes configured
 * limits to aria2 during the scheduled period and pushes '0' (unlimited)
 * outside of it.
 *
 * **The scheduler never modifies `speedLimitEnabled`.** It is a passive
 * layer that only controls WHEN already-enabled limits are enforced.
 *
 * Pure functions (testable without Vue/Pinia):
 * - parseTimeToMinutes   — "HH:mm" → minutes since midnight
 * - todayBit             — current weekday as bitmask bit
 * - isInScheduledPeriod  — is the current time inside the schedule?
 *
 * Integration helpers (dependency-injected):
 * - startScheduler       — 60s interval that pushes limits to aria2
 */
import type { AppConfig } from '@shared/types'
import type { SpeedLimiterDeps } from '@/composables/useSpeedLimiter'
import { logger } from '@shared/logger'

// ── Constants ───────────────────────────────────────────────────────

/** How often the scheduler checks the current time (ms). */
export const SCHEDULER_INTERVAL_MS = 60_000

// ── Pure Functions ──────────────────────────────────────────────────

/**
 * Parses an "HH:mm" time string into minutes since midnight (0–1439).
 * Returns 0 for empty or malformed input.
 */
export function parseTimeToMinutes(time: string): number {
  if (!time || !time.includes(':')) return 0
  const [hStr, mStr] = time.split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  if (Number.isNaN(h) || Number.isNaN(m)) return 0
  return h * 60 + m
}

/**
 * Returns the current day-of-week as a bitmask bit.
 * Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64.
 *
 * JS `getDay()` returns 0=Sun, 1=Mon, …, 6=Sat.
 * We map: Mon(1)→bit0, Tue(2)→bit1, …, Sat(6)→bit5, Sun(0)→bit6.
 */
export function todayBit(): number {
  const jsDay = new Date().getDay() // 0=Sun, 1=Mon, ..., 6=Sat
  // Remap: Mon=0→bit0(1), Tue=1→bit1(2), ... Sat=5→bit5(32), Sun=6→bit6(64)
  const index = jsDay === 0 ? 6 : jsDay - 1
  return 1 << index
}

/**
 * Schedule period config subset (avoids requiring full AppConfig).
 */
interface ScheduleConfig {
  speedScheduleEnabled: boolean
  speedScheduleFrom: string
  speedScheduleTo: string
  speedScheduleDays: number
}

/**
 * Determines whether the current time falls within the scheduled period.
 *
 * Supports overnight spans (e.g. 22:00→08:00).
 * `speedScheduleDays === 0` means "every day" (bypasses bitmask check).
 *
 * @param config   - Schedule configuration
 * @param nowMin   - Optional override: current minutes since midnight (for testing)
 * @param nowDay   - Optional override: current day bitmask bit (for testing)
 */
export function isInScheduledPeriod(config: ScheduleConfig, nowMin?: number, nowDay?: number): boolean {
  if (!config.speedScheduleEnabled) return false

  const from = parseTimeToMinutes(config.speedScheduleFrom)
  const to = parseTimeToMinutes(config.speedScheduleTo)
  const now = nowMin ?? parseTimeToMinutes(`${new Date().getHours()}:${new Date().getMinutes()}`)
  const day = nowDay ?? todayBit()

  // Day-of-week check: 0 = every day (skip bitmask check)
  if (config.speedScheduleDays !== 0 && !(config.speedScheduleDays & day)) {
    return false
  }

  // Same from/to = zero-length window = never active
  if (from === to) return false

  // Time check: supports overnight (from > to)
  if (from < to) {
    return now >= from && now < to
  } else {
    // Overnight: [from, 24:00) ∪ [00:00, to)
    return now >= from || now < to
  }
}

// ── Integration: Scheduler Timer ────────────────────────────────────

/**
 * Starts the speed schedule timer that checks every 60 seconds whether
 * the scheduled time window is active.
 *
 * The scheduler is a PASSIVE layer — it never modifies `speedLimitEnabled`.
 * It only controls WHEN already-enabled limits are pushed to aria2:
 *
 * - speedLimitEnabled=false OR speedScheduleEnabled=false → idle (no RPC)
 * - Both enabled + in period → push configured limits to aria2
 * - Both enabled + out of period → push '0' (unlimited) to aria2
 *
 * Only calls changeGlobalOption when the state actually transitions,
 * avoiding redundant RPC calls.
 *
 * @param getConfig  - Getter for current AppConfig (reads from store)
 * @param deps       - Dependency-injected RPC layer
 * @returns Cleanup function to stop the timer
 */
export function startScheduler(getConfig: () => AppConfig, deps: SpeedLimiterDeps): () => void {
  let lastInPeriod: boolean | null = null

  async function tick() {
    const config = getConfig()

    // Idle when either switch is off — scheduler has nothing to manage
    if (!config.speedScheduleEnabled || !config.speedLimitEnabled) {
      if (lastInPeriod !== null) {
        lastInPeriod = null
        logger.info('SpeedScheduler', 'idle — schedule or speed limit is disabled')
      }
      return
    }

    const inPeriod = isInScheduledPeriod(config)

    // Only act on state transitions
    if (inPeriod === lastInPeriod) return
    lastInPeriod = inPeriod

    try {
      if (inPeriod) {
        // Inside scheduled window → enforce configured limits
        await deps.changeGlobalOption({
          maxOverallDownloadLimit: config.maxOverallDownloadLimit,
          maxOverallUploadLimit: config.maxOverallUploadLimit,
        })
        logger.info(
          'SpeedScheduler',
          `in period — limits: dl=${config.maxOverallDownloadLimit} ul=${config.maxOverallUploadLimit}`,
        )
      } else {
        // Outside scheduled window → unlimited
        await deps.changeGlobalOption({
          maxOverallDownloadLimit: '0',
          maxOverallUploadLimit: '0',
        })
        logger.info('SpeedScheduler', 'out of period — unlimited')
      }
    } catch (e) {
      logger.error('SpeedScheduler', `transition failed: ${(e as Error).message}`)
    }
  }

  // Run immediately on start to sync current state
  void tick()

  const id = setInterval(tick, SCHEDULER_INTERVAL_MS)

  return () => {
    clearInterval(id)
    lastInPeriod = null
  }
}
