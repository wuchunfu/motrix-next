/** @fileoverview TDD tests for useTaskLifecycle — pure functions bridging
 * task events to download history and cleanup actions.
 *
 * Tests written BEFORE implementation per TDD Iron Law.
 * Mocks are used only for external Tauri APIs (unavoidable).
 */
import { describe, it, expect, vi } from 'vitest'
import type { Aria2Task, HistoryRecord } from '@shared/types'
import { getRestartDescriptors } from '@shared/utils'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(true),
  remove: vi.fn().mockResolvedValue(undefined),
}))

const {
  buildHistoryRecord,
  shouldRunStaleCleanup,
  historyRecordToTask,
  mergeHistoryIntoTasks,
  buildHistoryMeta,
  extractHistoryFilePaths,
} = await import('../useTaskLifecycle')

// ── Test data factories ──────────────────────────────────────────────

function makeTask(overrides: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid: 'abc123',
    status: 'complete',
    totalLength: '1048576',
    completedLength: '1048576',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    dir: '/downloads',
    files: [
      {
        index: '1',
        path: '/downloads/test.zip',
        length: '1048576',
        selected: 'true',
        uris: [{ uri: 'https://example.com/test.zip', status: 'used' }],
      },
    ],
    ...overrides,
  } as unknown as Aria2Task
}

// ── buildHistoryRecord ───────────────────────────────────────────────

describe('buildHistoryRecord', () => {
  it('extracts gid, name, dir, status from Aria2Task', () => {
    const task = makeTask({ gid: 'g1', status: 'complete', dir: '/dl' })
    const record = buildHistoryRecord(task)

    expect(record.gid).toBe('g1')
    expect(record.status).toBe('complete')
    expect(record.dir).toBe('/dl')
  })

  it('extracts name from first file path basename', () => {
    const task = makeTask({
      files: [
        { index: '1', path: '/dl/big-file.iso', length: '999', completedLength: '999', selected: 'true', uris: [] },
      ],
    })
    const record = buildHistoryRecord(task)
    expect(record.name).toBe('big-file.iso')
  })

  it('extracts name from Windows backslash path', () => {
    const task = makeTask({
      files: [
        {
          index: '1',
          path: 'C:\\Users\\foo\\Downloads\\setup.exe',
          length: '999',
          completedLength: '999',
          selected: 'true',
          uris: [],
        },
      ],
    })
    const record = buildHistoryRecord(task)
    expect(record.name).toBe('setup.exe')
  })

  it('uses bittorrent info name if available', () => {
    const task = makeTask({
      bittorrent: { info: { name: 'Ubuntu 24.04' } },
    })
    const record = buildHistoryRecord(task)
    expect(record.name).toBe('Ubuntu 24.04')
  })

  it('falls back to "Unknown" when no name source available', () => {
    const task = makeTask({ files: [], bittorrent: undefined })
    const record = buildHistoryRecord(task)
    expect(record.name).toBe('Unknown')
  })

  it('sets total_length from totalLength', () => {
    const task = makeTask({ totalLength: '2097152' })
    const record = buildHistoryRecord(task)
    expect(record.total_length).toBe(2097152)
  })

  it('extracts URI from first file uris array', () => {
    const task = makeTask({
      files: [
        {
          index: '1',
          path: '/dl/f.zip',
          length: '100',
          completedLength: '100',
          selected: 'true',
          uris: [{ uri: 'https://dl.example.com/f.zip', status: 'used' }],
        },
      ],
    })
    const record = buildHistoryRecord(task)
    expect(record.uri).toBe('https://dl.example.com/f.zip')
  })

  it('sets task_type to "bt" for bittorrent tasks', () => {
    const task = makeTask({ bittorrent: { info: { name: 'torrent' } } })
    const record = buildHistoryRecord(task)
    expect(record.task_type).toBe('bt')
  })

  it('sets task_type to "uri" for regular downloads', () => {
    const task = makeTask({ bittorrent: undefined })
    const record = buildHistoryRecord(task)
    expect(record.task_type).toBe('uri')
  })

  it('sets completed_at to ISO string', () => {
    const task = makeTask()
    const record = buildHistoryRecord(task)
    expect(record.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('preserves error status for failed downloads', () => {
    const task = makeTask({ status: 'error', errorCode: '3', errorMessage: 'Resource not found' })
    const record = buildHistoryRecord(task)
    expect(record.status).toBe('error')
    expect(record.gid).toBe('abc123')
    expect(record.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('stores infoHash in meta JSON for BT tasks', () => {
    const task = makeTask({ infoHash: 'deadbeef1234567890abcdef' })
    const record = buildHistoryRecord(task)
    expect(record.meta).toBeDefined()
    const meta = JSON.parse(record.meta!)
    expect(meta.infoHash).toBe('deadbeef1234567890abcdef')
  })

  it('stores announceList in meta JSON for BT tasks', () => {
    const task = makeTask({
      bittorrent: {
        info: { name: 'Ubuntu 24.04' },
        announceList: [
          ['udp://tracker1.example:80/announce'],
          ['https://tracker2.example/announce', 'https://tracker3.example/announce'],
        ],
      },
      infoHash: 'deadbeef1234567890abcdef',
    })
    const record = buildHistoryRecord(task)
    expect(record.meta).toBeDefined()
    const meta = JSON.parse(record.meta!)
    expect(meta.announceList).toEqual([
      ['udp://tracker1.example:80/announce'],
      ['https://tracker2.example/announce', 'https://tracker3.example/announce'],
    ])
  })

  it('omits meta when no infoHash', () => {
    const task = makeTask({ bittorrent: undefined, infoHash: undefined })
    const record = buildHistoryRecord(task)
    expect(record.meta).toBeUndefined()
  })

  it('decodes percent-encoded path segments in file name', () => {
    const task = makeTask({
      files: [
        {
          index: '1',
          path: '/downloads/AAA%20BBB.mp3',
          length: '100',
          completedLength: '100',
          selected: 'true',
          uris: [],
        },
      ],
    })
    const record = buildHistoryRecord(task)
    expect(record.name).toBe('AAA BBB.mp3')
  })

  it('decodes UTF-8 percent sequences in file name', () => {
    const task = makeTask({
      files: [
        {
          index: '1',
          path: '/downloads/%E4%B8%AD%E6%96%87.txt',
          length: '100',
          completedLength: '100',
          selected: 'true',
          uris: [],
        },
      ],
    })
    const record = buildHistoryRecord(task)
    expect(record.name).toBe('中文.txt')
  })

  it('returns original path segment when percent sequence is malformed', () => {
    const task = makeTask({
      files: [
        {
          index: '1',
          path: '/downloads/bad%ZZfile.txt',
          length: '100',
          completedLength: '100',
          selected: 'true',
          uris: [],
        },
      ],
    })
    const record = buildHistoryRecord(task)
    expect(record.name).toBe('bad%ZZfile.txt')
  })

  it('uses bittorrent info name as-is without decode (BT names are not URL-encoded)', () => {
    const task = makeTask({
      bittorrent: { info: { name: 'Ubuntu%2024.04' } },
      files: [
        {
          index: '1',
          path: '/downloads/Ubuntu%2024.04/file.iso',
          length: '100',
          completedLength: '100',
          selected: 'true',
          uris: [],
        },
      ],
    })
    const record = buildHistoryRecord(task)
    // btName takes priority and is NOT decoded — it's the literal torrent name
    expect(record.name).toBe('Ubuntu%2024.04')
  })
})

// ── shouldRunStaleCleanup ────────────────────────────────────────────

describe('shouldRunStaleCleanup', () => {
  it('returns true when autoDeleteStaleRecords is true', () => {
    expect(shouldRunStaleCleanup({ autoDeleteStaleRecords: true })).toBe(true)
  })

  it('returns false when autoDeleteStaleRecords is false', () => {
    expect(shouldRunStaleCleanup({ autoDeleteStaleRecords: false })).toBe(false)
  })

  it('returns false when config is undefined', () => {
    expect(shouldRunStaleCleanup(undefined)).toBe(false)
  })

  it('returns false when autoDeleteStaleRecords is missing', () => {
    expect(shouldRunStaleCleanup({})).toBe(false)
  })
})

// ── historyRecordToTask ─────────────────────────────────────────────

function makeRecord(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    gid: 'hist-001',
    name: 'test-file.zip',
    status: 'complete',
    uri: 'https://example.com/test-file.zip',
    dir: '/downloads',
    total_length: 2048000,
    task_type: 'uri',
    completed_at: '2026-03-15T10:00:00.000Z',
    ...overrides,
  }
}

describe('historyRecordToTask', () => {
  it('maps gid, status, dir, totalLength from record', () => {
    const task = historyRecordToTask(makeRecord())
    expect(task.gid).toBe('hist-001')
    expect(task.status).toBe('complete')
    expect(task.dir).toBe('/downloads')
    expect(task.totalLength).toBe('2048000')
    expect(task.completedLength).toBe('2048000')
  })

  it('constructs files[0] with correct path and uri for URI tasks', () => {
    const task = historyRecordToTask(makeRecord())
    expect(task.files).toHaveLength(1)
    expect(task.files[0].path).toBe('/downloads/test-file.zip')
    expect(task.files[0].uris).toEqual([{ uri: 'https://example.com/test-file.zip', status: 'used' }])
  })

  it('constructs bittorrent.info.name for BT tasks', () => {
    const task = historyRecordToTask(makeRecord({ task_type: 'bt', name: 'My Torrent' }))
    expect(task.bittorrent?.info?.name).toBe('My Torrent')
    expect(task.files[0].path).toBe('/downloads/My Torrent')
  })

  it('handles missing optional fields gracefully', () => {
    const task = historyRecordToTask(makeRecord({ uri: undefined, dir: undefined, total_length: undefined }))
    expect(task.dir).toBe('')
    expect(task.totalLength).toBe('0')
    expect(task.files[0].uris).toEqual([])
  })

  it('preserves error status', () => {
    const task = historyRecordToTask(makeRecord({ status: 'error' }))
    expect(task.status).toBe('error')
  })

  it('sets completedLength = totalLength for complete records, 0 for error', () => {
    const complete = historyRecordToTask(makeRecord({ status: 'complete', total_length: 5000 }))
    expect(complete.completedLength).toBe('5000')

    const errored = historyRecordToTask(makeRecord({ status: 'error', total_length: 5000 }))
    expect(errored.completedLength).toBe('0')
  })

  it('restores infoHash from meta JSON for BT restart', () => {
    const meta = JSON.stringify({ infoHash: 'deadbeef1234567890abcdef' })
    const task = historyRecordToTask(makeRecord({ task_type: 'bt', name: 'My Torrent', meta }))
    expect(task.infoHash).toBe('deadbeef1234567890abcdef')
    expect(task.bittorrent?.info?.name).toBe('My Torrent')
  })

  it('restores announceList from meta JSON for BT restart descriptors', () => {
    const meta = JSON.stringify({
      infoHash: 'deadbeef1234567890abcdef',
      announceList: [['udp://tracker1.example:80/announce'], ['https://tracker2.example/announce']],
    })
    const task = historyRecordToTask(makeRecord({ task_type: 'bt', name: 'My Torrent', meta }))

    expect(task.bittorrent?.announceList).toEqual([
      ['udp://tracker1.example:80/announce'],
      ['https://tracker2.example/announce'],
    ])
    expect(getRestartDescriptors(task, true)).toEqual([
      [
        'magnet:?xt=urn:btih:deadbeef1234567890abcdef&dn=My%20Torrent&tr=udp%3A%2F%2Ftracker1.example%3A80%2Fannounce&tr=https%3A%2F%2Ftracker2.example%2Fannounce',
      ],
    ])
  })

  it('handles missing/corrupt meta gracefully', () => {
    const task1 = historyRecordToTask(makeRecord({ meta: undefined }))
    expect(task1.infoHash).toBeUndefined()

    const task2 = historyRecordToTask(makeRecord({ meta: 'NOT_JSON' }))
    expect(task2.infoHash).toBeUndefined()
  })
})

// ── mergeHistoryIntoTasks ───────────────────────────────────────────

describe('mergeHistoryIntoTasks', () => {
  it('returns aria2 tasks unchanged when no history records', () => {
    const aria2 = [makeTask({ gid: 'a1' })]
    const result = mergeHistoryIntoTasks(aria2, [])
    expect(result).toEqual(aria2)
  })

  it('appends history-only records after aria2 tasks', () => {
    const aria2 = [makeTask({ gid: 'a1' })]
    const history = [makeRecord({ gid: 'h1' })]
    const result = mergeHistoryIntoTasks(aria2, history)
    expect(result).toHaveLength(2)
    expect(result[0].gid).toBe('a1')
    expect(result[1].gid).toBe('h1')
  })

  it('deduplicates by GID — aria2 data wins', () => {
    const aria2 = [makeTask({ gid: 'shared', totalLength: '9999' })]
    const history = [makeRecord({ gid: 'shared', total_length: 1111 })]
    const result = mergeHistoryIntoTasks(aria2, history)
    expect(result).toHaveLength(1)
    expect(result[0].gid).toBe('shared')
    expect(result[0].totalLength).toBe('9999') // aria2 data preserved
  })

  it('handles empty aria2 with history records', () => {
    const history = [makeRecord({ gid: 'h1' }), makeRecord({ gid: 'h2' })]
    const result = mergeHistoryIntoTasks([], history)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.gid)).toEqual(['h1', 'h2'])
  })

  it('handles both empty', () => {
    expect(mergeHistoryIntoTasks([], [])).toEqual([])
  })
})

// ── buildHistoryMeta ────────────────────────────────────────────────

describe('buildHistoryMeta', () => {
  it('stores complete files array in meta.files for multi-file tasks', () => {
    const task = makeTask({
      files: [
        {
          index: '1',
          path: '/dl/a.zip',
          length: '100',
          completedLength: '100',
          selected: 'true',
          uris: [{ uri: 'http://m1/a.zip', status: 'used' }],
        },
        {
          index: '2',
          path: '/dl/b.zip',
          length: '200',
          completedLength: '200',
          selected: 'true',
          uris: [{ uri: 'http://m1/b.zip', status: 'used' }],
        },
        {
          index: '3',
          path: '/dl/c.zip',
          length: '300',
          completedLength: '300',
          selected: 'false',
          uris: [{ uri: 'http://m1/c.zip', status: 'used' }],
        },
      ],
    })
    const meta = buildHistoryMeta(task)
    expect(meta.files).toBeDefined()
    expect(meta.files).toHaveLength(3)
    expect(meta.files![0].path).toBe('/dl/a.zip')
    expect(meta.files![2].selected).toBe('false')
  })

  it('does NOT store meta.files for single-file single-mirror tasks', () => {
    const task = makeTask() // default has 1 file with 1 URI
    const meta = buildHistoryMeta(task)
    expect(meta.files).toBeUndefined()
  })

  it('stores meta.files for single-file multi-mirror tasks', () => {
    const task = makeTask({
      files: [
        {
          index: '1',
          path: '/dl/archive.zip',
          length: '5000',
          completedLength: '5000',
          selected: 'true',
          uris: [
            { uri: 'http://mirror1.example.com/archive.zip', status: 'used' },
            { uri: 'http://mirror2.example.com/archive.zip', status: 'waiting' },
            { uri: 'http://mirror3.example.com/archive.zip', status: 'waiting' },
          ],
        },
      ],
    })
    const meta = buildHistoryMeta(task)
    expect(meta.files).toBeDefined()
    expect(meta.files).toHaveLength(1)
    expect(meta.files![0].path).toBe('/dl/archive.zip')
    expect(meta.files![0].uris).toEqual([
      'http://mirror1.example.com/archive.zip',
      'http://mirror2.example.com/archive.zip',
      'http://mirror3.example.com/archive.zip',
    ])
  })

  it('round-trips single-file multi-mirror through write → restore', () => {
    // Write: buildHistoryMeta captures all mirrors
    const task = makeTask({
      files: [
        {
          index: '1',
          path: '/dl/archive.zip',
          length: '5000',
          completedLength: '5000',
          selected: 'true',
          uris: [
            { uri: 'http://mirror1/archive.zip', status: 'used' },
            { uri: 'http://mirror2/archive.zip', status: 'waiting' },
          ],
        },
      ],
    })
    const meta = buildHistoryMeta(task)
    expect(meta.files).toHaveLength(1)

    // Restore: historyRecordToTask rebuilds complete uris[]
    const restored = historyRecordToTask(makeRecord({ meta: JSON.stringify(meta), status: 'complete' }))
    expect(restored.files).toHaveLength(1)
    expect(restored.files[0].uris).toEqual([
      { uri: 'http://mirror1/archive.zip', status: 'used' },
      { uri: 'http://mirror2/archive.zip', status: 'used' },
    ])
  })

  it('preserves full mirror URIs per file', () => {
    const task = makeTask({
      files: [
        {
          index: '1',
          path: '/dl/a.zip',
          length: '100',
          completedLength: '100',
          selected: 'true',
          uris: [
            { uri: 'http://mirror1/a.zip', status: 'used' },
            { uri: 'http://mirror2/a.zip', status: 'waiting' },
          ],
        },
        {
          index: '2',
          path: '/dl/b.zip',
          length: '200',
          completedLength: '200',
          selected: 'true',
          uris: [{ uri: 'http://mirror1/b.zip', status: 'used' }],
        },
      ],
    })
    const meta = buildHistoryMeta(task)
    expect(meta.files![0].uris).toEqual(['http://mirror1/a.zip', 'http://mirror2/a.zip'])
    expect(meta.files![1].uris).toEqual(['http://mirror1/b.zip'])
  })

  it('stores announceList in structured BT history meta', () => {
    const task = makeTask({
      bittorrent: {
        info: { name: 'Ubuntu 24.04' },
        announceList: [['udp://tracker1.example:80/announce'], ['https://tracker2.example/announce']],
      },
    })

    const meta = buildHistoryMeta(task)

    expect(meta.announceList).toEqual([['udp://tracker1.example:80/announce'], ['https://tracker2.example/announce']])
  })
})

// ── historyRecordToTask multi-file ──────────────────────────────────

describe('historyRecordToTask — multi-file restoration', () => {
  it('restores complete files[] from meta.files', () => {
    const meta = JSON.stringify({
      files: [
        { path: '/dl/a.zip', length: '100', selected: 'true', uris: ['http://m1/a.zip'] },
        { path: '/dl/b.zip', length: '200', selected: 'true', uris: ['http://m1/b.zip'] },
        { path: '/dl/c.zip', length: '300', selected: 'false', uris: ['http://m1/c.zip'] },
      ],
    })
    const task = historyRecordToTask(makeRecord({ meta }))
    expect(task.files).toHaveLength(3)
    expect(task.files[0].path).toBe('/dl/a.zip')
    expect(task.files[1].length).toBe('200')
    expect(task.files[2].selected).toBe('false')
  })

  it('restores full mirror URIs from meta.files', () => {
    const meta = JSON.stringify({
      files: [{ path: '/dl/a.zip', length: '100', uris: ['http://mirror1/a.zip', 'http://mirror2/a.zip'] }],
    })
    const task = historyRecordToTask(makeRecord({ meta }))
    expect(task.files[0].uris).toEqual([
      { uri: 'http://mirror1/a.zip', status: 'used' },
      { uri: 'http://mirror2/a.zip', status: 'used' },
    ])
  })

  it('falls back to single-file synthesis when meta.files is absent', () => {
    const task = historyRecordToTask(makeRecord({ meta: undefined }))
    expect(task.files).toHaveLength(1)
    expect(task.files[0].path).toBe('/downloads/test-file.zip')
  })

  it('falls back to single-file synthesis when meta.files is empty array', () => {
    const meta = JSON.stringify({ files: [] })
    const task = historyRecordToTask(makeRecord({ meta }))
    expect(task.files).toHaveLength(1)
  })
})

// ── extractHistoryFilePaths ─────────────────────────────────────────

describe('extractHistoryFilePaths', () => {
  it('returns all paths from meta.files when present', () => {
    const meta = JSON.stringify({
      files: [
        { path: '/dl/a.zip', uris: [] },
        { path: '/dl/b.zip', uris: [] },
        { path: '/dl/c.zip', uris: [] },
      ],
    })
    const paths = extractHistoryFilePaths(makeRecord({ meta }))
    expect(paths).toEqual(['/dl/a.zip', '/dl/b.zip', '/dl/c.zip'])
  })

  it('falls back to dir + name when meta.files is absent', () => {
    const paths = extractHistoryFilePaths(makeRecord({ dir: '/dl', name: 'file.zip', meta: undefined }))
    expect(paths).toEqual(['/dl/file.zip'])
  })

  it('returns empty array when both dir and name are missing', () => {
    const paths = extractHistoryFilePaths(makeRecord({ dir: undefined, name: '', meta: undefined }))
    expect(paths).toEqual([])
  })
})
