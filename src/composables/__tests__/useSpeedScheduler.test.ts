/**
 * @fileoverview TDD tests for the speed scheduler pure functions.
 *
 * Tests written BEFORE implementation to drive the design.
 * Covers: parseTimeToMinutes, todayBit, isInScheduledPeriod.
 */
import { describe, it, expect } from 'vitest'
import {
  parseTimeToMinutes,
  todayBit,
  isInScheduledPeriod,
  SCHEDULER_INTERVAL_MS,
} from '@/composables/useSpeedScheduler'
import { SCHEDULE_DAY } from '@shared/constants'

// ── parseTimeToMinutes ────────────────────────────────────────────

describe('parseTimeToMinutes', () => {
  it('parses "00:00" to 0', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0)
  })

  it('parses "08:00" to 480', () => {
    expect(parseTimeToMinutes('08:00')).toBe(480) // 8 * 60
  })

  it('parses "18:30" to 1110', () => {
    expect(parseTimeToMinutes('18:30')).toBe(1110) // 18*60 + 30
  })

  it('parses "23:59" to 1439', () => {
    expect(parseTimeToMinutes('23:59')).toBe(1439)
  })

  it('returns 0 for empty string', () => {
    expect(parseTimeToMinutes('')).toBe(0)
  })

  it('returns 0 for malformed input', () => {
    expect(parseTimeToMinutes('abc')).toBe(0)
  })

  it('returns 0 for single number', () => {
    expect(parseTimeToMinutes('12')).toBe(0)
  })
})

// ── todayBit ──────────────────────────────────────────────────────

describe('todayBit', () => {
  it('returns a power of 2 between 1 and 64', () => {
    const bit = todayBit()
    expect(bit).toBeGreaterThanOrEqual(1)
    expect(bit).toBeLessThanOrEqual(64)
    // Must be a power of 2
    expect(bit & (bit - 1)).toBe(0)
  })
})

// ── isInScheduledPeriod ───────────────────────────────────────────

describe('isInScheduledPeriod', () => {
  const base = {
    speedScheduleEnabled: true,
    speedScheduleFrom: '09:00',
    speedScheduleTo: '18:00',
    speedScheduleDays: 0, // every day
  }

  it('returns false when schedule is disabled', () => {
    expect(isInScheduledPeriod({ ...base, speedScheduleEnabled: false }, 600, 1)).toBe(false)
  })

  it('returns true when inside the time range', () => {
    // 10:00 = 600 min
    expect(isInScheduledPeriod(base, 600, 1)).toBe(true)
  })

  it('returns true at exact start time (inclusive)', () => {
    // 09:00 = 540 min
    expect(isInScheduledPeriod(base, 540, 1)).toBe(true)
  })

  it('returns false at exact end time (exclusive)', () => {
    // 18:00 = 1080 min
    expect(isInScheduledPeriod(base, 1080, 1)).toBe(false)
  })

  it('returns false when outside the time range', () => {
    // 20:00 = 1200 min
    expect(isInScheduledPeriod(base, 1200, 1)).toBe(false)
  })

  it('returns false before start time', () => {
    // 07:00 = 420 min
    expect(isInScheduledPeriod(base, 420, 1)).toBe(false)
  })

  // ── Overnight spans ──

  describe('overnight span (22:00 → 08:00)', () => {
    const overnight = {
      speedScheduleEnabled: true,
      speedScheduleFrom: '22:00',
      speedScheduleTo: '08:00',
      speedScheduleDays: 0,
    }

    it('returns true at 23:00 (after start)', () => {
      expect(isInScheduledPeriod(overnight, 23 * 60, 1)).toBe(true)
    })

    it('returns true at 03:00 (early morning, before end)', () => {
      expect(isInScheduledPeriod(overnight, 3 * 60, 1)).toBe(true)
    })

    it('returns true at 22:00 (exact start, inclusive)', () => {
      expect(isInScheduledPeriod(overnight, 22 * 60, 1)).toBe(true)
    })

    it('returns false at 08:00 (exact end, exclusive)', () => {
      expect(isInScheduledPeriod(overnight, 8 * 60, 1)).toBe(false)
    })

    it('returns false at 12:00 (midday, outside)', () => {
      expect(isInScheduledPeriod(overnight, 12 * 60, 1)).toBe(false)
    })
  })

  // ── Day-of-week filtering ──

  describe('day-of-week filtering', () => {
    const weekdaysOnly = {
      speedScheduleEnabled: true,
      speedScheduleFrom: '09:00',
      speedScheduleTo: '18:00',
      speedScheduleDays: SCHEDULE_DAY.WEEKDAYS, // 31 = Mon-Fri
    }

    it('returns true on Monday (bit=1) during time range', () => {
      expect(isInScheduledPeriod(weekdaysOnly, 600, SCHEDULE_DAY.MON)).toBe(true)
    })

    it('returns true on Friday (bit=16) during time range', () => {
      expect(isInScheduledPeriod(weekdaysOnly, 600, SCHEDULE_DAY.FRI)).toBe(true)
    })

    it('returns false on Saturday (bit=32) during time range', () => {
      expect(isInScheduledPeriod(weekdaysOnly, 600, SCHEDULE_DAY.SAT)).toBe(false)
    })

    it('returns false on Sunday (bit=64) during time range', () => {
      expect(isInScheduledPeriod(weekdaysOnly, 600, SCHEDULE_DAY.SUN)).toBe(false)
    })

    it('returns false on Monday outside time range', () => {
      expect(isInScheduledPeriod(weekdaysOnly, 1200, SCHEDULE_DAY.MON)).toBe(false)
    })
  })

  describe('weekend only schedule', () => {
    const weekendsOnly = {
      speedScheduleEnabled: true,
      speedScheduleFrom: '10:00',
      speedScheduleTo: '22:00',
      speedScheduleDays: SCHEDULE_DAY.WEEKENDS, // 96 = Sat+Sun
    }

    it('returns true on Saturday during time range', () => {
      expect(isInScheduledPeriod(weekendsOnly, 12 * 60, SCHEDULE_DAY.SAT)).toBe(true)
    })

    it('returns false on Wednesday during time range', () => {
      expect(isInScheduledPeriod(weekendsOnly, 12 * 60, SCHEDULE_DAY.WED)).toBe(false)
    })
  })

  // ── Edge: same from and to ──

  it('returns false when from equals to (zero-length window)', () => {
    const same = { ...base, speedScheduleFrom: '12:00', speedScheduleTo: '12:00' }
    expect(isInScheduledPeriod(same, 12 * 60, 1)).toBe(false)
  })
})

// ── SCHEDULER_INTERVAL_MS ─────────────────────────────────────────

describe('SCHEDULER_INTERVAL_MS', () => {
  it('is 60000 ms (one minute)', () => {
    expect(SCHEDULER_INTERVAL_MS).toBe(60_000)
  })
})
