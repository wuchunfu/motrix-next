/** @fileoverview Pure utility functions for task lifecycle events.
 *
 * Bridges aria2 task state changes to download history records
 * and cleanup logic. All functions are pure for testability.
 */
import type { Aria2Task, Aria2File, HistoryRecord, HistoryMeta, HistoryFileSnapshot } from '@shared/types'
import { decodePathSegment } from '@shared/utils/batchHelpers'

/** Detect BT metadata-only downloads (the intermediate magnet resolution phase).
 *
 * These tasks have `[METADATA]` in the first file path (aria2 convention when
 * bt-save-metadata is enabled) or a `followedBy` field pointing to the real
 * download. They should NOT be persisted as history records. */
export function isMetadataTask(task: Aria2Task): boolean {
  if (task.followedBy && task.followedBy.length > 0) return true
  const firstPath = task.files?.[0]?.path ?? ''
  return firstPath.startsWith('[METADATA]')
}

// ── Centralized history snapshot helpers ────────────────────────────
// All meta read/write MUST go through these functions. Never JSON.parse
// HistoryRecord.meta directly in consumer code.

/** Build structured meta from a live aria2 task (write path).
 *
 * - Stores infoHash for BT magnet reconstruction.
 * - Stores full file list (with ALL mirror URIs) for multi-file tasks.
 *   Single-file tasks omit meta.files to keep JSON compact. */
export function buildHistoryMeta(task: Aria2Task): HistoryMeta {
  const meta: HistoryMeta = {}
  if (task.infoHash) meta.infoHash = task.infoHash
  if (task.bittorrent?.announceList && task.bittorrent.announceList.length > 0) {
    meta.announceList = task.bittorrent.announceList.map((tier) => [...tier])
  }

  // Snapshot trigger: multi-file OR any file with multiple mirror URIs.
  // Multi-file: enables correct delete (all files) and stale cleanup.
  // Multi-mirror: enables correct restart with all mirrors via addUriAtomic.
  const files = task.files ?? []
  const hasMultipleFiles = files.length > 1
  const hasMirrors = files.some((f) => (f.uris?.length ?? 0) > 1)
  const needsSnapshot = hasMultipleFiles || hasMirrors
  if (needsSnapshot) {
    meta.files = files.map(
      (f): HistoryFileSnapshot => ({
        path: f.path,
        length: f.length,
        selected: f.selected,
        uris: (f.uris ?? []).map((u) => u.uri),
      }),
    )
  }
  return meta
}

/** Parse structured meta from a persisted history record (read path).
 *  Never throws — returns empty object on corrupt/missing meta. */
export function parseHistoryMeta(record: HistoryRecord): HistoryMeta {
  if (!record.meta) return {}
  try {
    return JSON.parse(record.meta) as HistoryMeta
  } catch {
    return {}
  }
}

/** Extract all expected file paths from a history record.
 *
 * Used by stale cleanup to check whether downloaded files still exist.
 * Multi-file records return all paths; legacy single-file records return
 * a single synthetic path from dir + name. */
export function extractHistoryFilePaths(record: HistoryRecord): string[] {
  const meta = parseHistoryMeta(record)
  if (meta.files && meta.files.length > 0) {
    return meta.files.map((f) => f.path).filter(Boolean)
  }
  // Legacy fallback: single file path from dir + name
  if (record.dir && record.name) {
    const dir = record.dir.replace(/[\\/]+$/, '')
    return [`${dir}/${record.name}`]
  }
  return []
}

/** Extract a HistoryRecord from an aria2 task for persistence. */
export function buildHistoryRecord(task: Aria2Task): HistoryRecord {
  const btName = task.bittorrent?.info?.name
  const firstFile = task.files?.[0]
  const pathName = firstFile?.path?.split(/[/\\]/).pop()
  const name = btName || (pathName ? decodePathSegment(pathName) : '') || 'Unknown'

  const uri = firstFile?.uris?.[0]?.uri
  const taskType = task.bittorrent ? 'bt' : 'uri'

  // Build structured meta snapshot (centralised — no inline JSON.stringify elsewhere)
  const meta = buildHistoryMeta(task)

  return {
    gid: task.gid,
    name,
    uri: uri ?? undefined,
    dir: task.dir ?? undefined,
    total_length: task.totalLength ? Number(task.totalLength) : undefined,
    status: task.status,
    task_type: taskType,
    completed_at: new Date().toISOString(),
    meta: Object.keys(meta).length > 0 ? JSON.stringify(meta) : undefined,
  }
}

/** Determine if stale record cleanup should run based on user config. */
export function shouldRunStaleCleanup(config: Partial<{ autoDeleteStaleRecords: boolean }> | undefined): boolean {
  return config?.autoDeleteStaleRecords === true
}

/** Reconstruct an Aria2Task from a persisted HistoryRecord.
 *
 * This is the inverse of buildHistoryRecord — it synthesizes the `files[]`
 * and optional `bittorrent` fields so that TaskItem can render the record
 * using the same code paths as live aria2 tasks.
 *
 * Fields not available in the DB (downloadSpeed, connections, etc.) are
 * zero-filled, which is correct for stopped/completed tasks. */
export function historyRecordToTask(record: HistoryRecord): Aria2Task {
  const dir = record.dir ?? ''
  const totalLength = String(record.total_length ?? 0)
  const completedLength = record.status === 'complete' ? totalLength : '0'

  // Centralised meta parsing — never JSON.parse directly.
  const meta = parseHistoryMeta(record)

  // Build files array: prefer multi-file snapshot from meta.files,
  // fall back to legacy single-file synthesis for old records.
  let files: Aria2File[]
  if (meta.files && meta.files.length > 0) {
    // Full restoration from snapshot — preserves all paths, lengths, and mirror URIs.
    files = meta.files.map((f, i) => ({
      index: String(i + 1),
      path: f.path,
      length: f.length ?? '0',
      completedLength: record.status === 'complete' ? (f.length ?? '0') : '0',
      selected: f.selected ?? 'true',
      uris: f.uris.map((uri) => ({ uri, status: 'used' as const })),
    }))
  } else {
    // Legacy single-file fallback — path is dir + separator + name.
    // dir may end with `\\` (Windows) or `/` (Unix); avoid double separators.
    const filePath = dir && record.name ? `${dir.replace(/[\\/]+$/, '')}/${record.name}` : record.name
    const uris = record.uri ? [{ uri: record.uri, status: 'used' as const }] : []
    files = [{ index: '1', path: filePath, length: totalLength, completedLength, selected: 'true', uris }]
  }

  const task: Aria2Task = {
    gid: record.gid,
    status: record.status as Aria2Task['status'],
    totalLength,
    completedLength,
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    dir,
    files,
  }

  // BT tasks get a bittorrent.info stub so getTaskName() resolves correctly
  if (record.task_type === 'bt') {
    task.bittorrent = { info: { name: record.name } }
    if (meta.announceList && meta.announceList.length > 0) {
      task.bittorrent.announceList = meta.announceList.map((tier) => [...tier])
    }
  }

  // Restore infoHash from meta — essential for magnet link reconstruction
  if (meta.infoHash) {
    task.infoHash = meta.infoHash
  }

  return task
}

/** Merge live aria2 stopped tasks with persisted history records.
 *
 * Aria2 data takes priority for any GID that appears in both sources.
 * History-only records (from previous sessions) are appended after
 * the live data, preserving temporal ordering. */
export function mergeHistoryIntoTasks(aria2Tasks: Aria2Task[], historyRecords: HistoryRecord[]): Aria2Task[] {
  if (historyRecords.length === 0) return aria2Tasks

  const seenGids = new Set(aria2Tasks.map((t) => t.gid))
  const historyOnly = historyRecords.filter((r) => !seenGids.has(r.gid))

  return [...aria2Tasks, ...historyOnly.map(historyRecordToTask)]
}
