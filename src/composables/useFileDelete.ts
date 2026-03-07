/** @fileoverview Composable for deleting download task files and associated artifacts from disk. */
import { remove } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { logger } from '@shared/logger'
import { getTaskName } from '@shared/utils'
import type { Aria2Task } from '@shared/types'

/**
 * Deletes all files associated with a download task, including:
 * - Each file referenced by the task
 * - Companion .aria2 control files
 * - Empty parent directories (if different from task root dir)
 * - The named task directory itself
 */
export async function deleteTaskFiles(task: Aria2Task): Promise<void> {
    const dir = task.dir
    const files = task.files || []
    const parentDirs = new Set<string>()

    for (const f of files) {
        if (!f.path) continue
        try { await remove(f.path) } catch (e) { logger.debug('deleteTaskFiles.file', e) }
        try { await remove(f.path + '.aria2') } catch (e) { logger.debug('deleteTaskFiles.aria2', e) }
        const lastSep = Math.max(f.path.lastIndexOf('/'), f.path.lastIndexOf('\\'))
        if (lastSep > 0) {
            const parent = f.path.substring(0, lastSep)
            if (parent !== dir) parentDirs.add(parent)
        }
    }

    for (const pd of parentDirs) {
        try { await remove(pd, { recursive: true }) } catch (e) { logger.debug('deleteTaskFiles.parentDir', e) }
    }

    if (dir) {
        const name = getTaskName(task, { defaultName: '', maxLen: -1 })
        if (name) {
            const taskDir = await join(dir, name)
            try { await remove(taskDir, { recursive: true }) } catch (e) { logger.debug('deleteTaskFiles.taskDir', e) }
        }
    }
}
