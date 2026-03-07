/** @fileoverview Unit tests for TaskStore with mocked TaskApi. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTaskStore } from '../task'
import type { Aria2Task, Aria2Peer, TaskStatus } from '@shared/types'

const makeMockTask = (gid: string, status: TaskStatus = 'active'): Aria2Task => ({
    gid,
    status,
    totalLength: '1000',
    completedLength: '500',
    uploadLength: '0',
    downloadSpeed: '1000',
    uploadSpeed: '0',
    connections: '1',
    numSeeders: '0',
    dir: '/tmp',
    files: [],
    bittorrent: undefined,
    infoHash: undefined,
    errorCode: undefined,
    errorMessage: undefined,
    numPieces: undefined,
    pieceLength: undefined,
    followedBy: undefined,
    following: undefined,
    belongsTo: undefined,
})

function createMockApi() {
    return {
        fetchTaskList: vi.fn().mockResolvedValue([makeMockTask('gid1'), makeMockTask('gid2')]),
        fetchTaskItem: vi.fn().mockResolvedValue(makeMockTask('gid1')),
        fetchTaskItemWithPeers: vi.fn().mockResolvedValue({ ...makeMockTask('gid1'), peers: [] as Aria2Peer[] }),
        fetchActiveTaskList: vi.fn().mockResolvedValue([]),
        addUri: vi.fn().mockResolvedValue(['gid3']),
        addTorrent: vi.fn().mockResolvedValue('gid4'),
        addMetalink: vi.fn().mockResolvedValue(['gid5']),
        getOption: vi.fn().mockResolvedValue({}),
        changeOption: vi.fn().mockResolvedValue(undefined),
        removeTask: vi.fn().mockResolvedValue('gid1'),
        forcePauseTask: vi.fn().mockResolvedValue('gid1'),
        pauseTask: vi.fn().mockResolvedValue('gid1'),
        resumeTask: vi.fn().mockResolvedValue('gid1'),
        pauseAllTask: vi.fn().mockResolvedValue('OK'),
        forcePauseAllTask: vi.fn().mockResolvedValue('OK'),
        resumeAllTask: vi.fn().mockResolvedValue('OK'),
        batchResumeTask: vi.fn().mockResolvedValue([]),
        batchPauseTask: vi.fn().mockResolvedValue([]),
        batchForcePauseTask: vi.fn().mockResolvedValue([]),
        batchRemoveTask: vi.fn().mockResolvedValue([]),
        removeTaskRecord: vi.fn().mockResolvedValue('OK'),
        purgeTaskRecord: vi.fn().mockResolvedValue('OK'),
        saveSession: vi.fn().mockResolvedValue('OK'),
    }
}

describe('TaskStore', () => {
    let store: ReturnType<typeof useTaskStore>
    let mockApi: ReturnType<typeof createMockApi>

    beforeEach(() => {
        setActivePinia(createPinia())
        store = useTaskStore()
        mockApi = createMockApi()
        store.setApi(mockApi)
    })

    it('fetchList populates taskList', async () => {
        await store.fetchList()
        expect(store.taskList).toHaveLength(2)
        expect(store.taskList[0].gid).toBe('gid1')
        expect(mockApi.fetchTaskList).toHaveBeenCalledWith({ type: 'active' })
    })

    it('fetchList prunes selectedGidList to valid gids', async () => {
        store.selectTasks(['gid1', 'gid_invalid'])
        await store.fetchList()
        expect(store.selectedGidList).toEqual(['gid1'])
    })

    it('selectAllTask selects all gids', async () => {
        await store.fetchList()
        store.selectAllTask()
        expect(store.selectedGidList).toEqual(['gid1', 'gid2'])
    })

    it('addUri calls api and refreshes list', async () => {
        await store.addUri({ uris: ['http://example.com/file.zip'], outs: [], options: {} })
        expect(mockApi.addUri).toHaveBeenCalled()
        expect(mockApi.fetchTaskList).toHaveBeenCalled()
    })

    it('pauseAllTask falls back to forcePause on error', async () => {
        mockApi.pauseAllTask.mockRejectedValueOnce(new Error('fail'))
        await store.pauseAllTask()
        expect(mockApi.forcePauseAllTask).toHaveBeenCalled()
    })

    it('showTaskDetail sets visibility and gid', () => {
        const task = makeMockTask('gid1')
        store.showTaskDetail(task)
        expect(store.taskDetailVisible).toBe(true)
        expect(store.currentTaskGid).toBe('gid1')
    })

    it('hideTaskDetail resets detail state', () => {
        store.showTaskDetail(makeMockTask('gid1'))
        store.hideTaskDetail()
        expect(store.taskDetailVisible).toBe(false)
    })

    it('changeCurrentList resets and fetches', async () => {
        store.taskList = [makeMockTask('old')]
        await store.changeCurrentList('completed')
        expect(store.currentList).toBe('completed')
        expect(mockApi.fetchTaskList).toHaveBeenCalledWith({ type: 'completed' })
    })
})
