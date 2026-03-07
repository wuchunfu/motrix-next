<script setup lang="ts">
/** @fileoverview Add task dialog: URI, torrent, and metalink input with options. */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useTaskStore } from '@/stores/task'
import { usePreferenceStore } from '@/stores/preference'
import { ADD_TASK_TYPE } from '@shared/constants'
import { isEngineReady } from '@/api/aria2'
import { detectResource, bytesToSize } from '@shared/utils'
import { buildOuts } from '@shared/utils/rename'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { downloadDir } from '@tauri-apps/api/path'
import { readFile } from '@tauri-apps/plugin-fs'
import { logger } from '@shared/logger'
import bencode from 'bencode'
import {
  NModal, NCard, NTabs, NTabPane, NForm, NFormItem, NInput, NInputNumber,
  NButton, NCheckbox, NSpace, NGrid, NGridItem, NIcon, NText, NInputGroup,
  NCollapseTransition, NTooltip, NDataTable,
} from 'naive-ui'
import { useAppMessage } from '@/composables/useAppMessage'
import type { DataTableColumns } from 'naive-ui'
import type { Aria2EngineOptions } from '@shared/types'
import { CloudUploadOutline, FolderOpenOutline, TrashOutline } from '@vicons/ionicons5'

const props = defineProps<{ type: string; show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const router = useRouter()
const appStore = useAppStore()
const taskStore = useTaskStore()
const preferenceStore = usePreferenceStore()
const message = useAppMessage()

const activeTab = ref(props.type || ADD_TASK_TYPE.URI)
const slideDirection = ref<'left' | 'right'>('left')
const showAdvanced = ref(false)
const config = preferenceStore.config

const torrentName = ref('')
const torrentBase64 = ref('')
const torrentLoaded = ref(false)
const torrentInfoHash = ref('')
const torrentFiles = ref<{ idx: number; path: string; length: number }[]>([])
const selectedFileIndices = ref<number[]>([])
const submitting = ref(false)

const form = ref({
  uris: '',
  out: '',
  dir: config.dir || '',
  split: config.split || 16,
  userAgent: '',
  authorization: '',
  referer: '',
  cookie: '',
  allProxy: '',
  newTaskShowDownloading: config.newTaskShowDownloading !== false,
})

const dialogTop = computed(() => showAdvanced.value ? '8vh' : '12vh')
const maxSplit = computed(() => config.engineMaxConnectionPerServer || 64)

const fileColumns: DataTableColumns = [
  { type: 'selection' },
  { title: '#', key: 'idx', width: 50 },
  { title: 'File', key: 'path', ellipsis: { tooltip: true } },
  {
    title: 'Size',
    key: 'length',
    width: 100,
    render(row: Record<string, unknown>) {
      return bytesToSize(row.length as number)
    }
  },
]

const checkedRowKeys = computed({
  get: () => selectedFileIndices.value,
  set: (keys: number[]) => { selectedFileIndices.value = keys }
})

onMounted(async () => {
  if (!form.value.dir) {
    try { form.value.dir = await downloadDir() } catch { form.value.dir = '~/Downloads' }
  }
})

watch(() => props.type, (val) => { if (val) activeTab.value = val })

watch(() => props.show, async (visible) => {
  if (!visible) return
  if (appStore.droppedTorrentPaths.length > 0) {
    activeTab.value = ADD_TASK_TYPE.TORRENT
    await loadTorrentFromPath(appStore.droppedTorrentPaths[0])
    return
  }
  if (activeTab.value === ADD_TASK_TYPE.URI && !form.value.uris) {
    if (appStore.addTaskUrl) {
      form.value.uris = appStore.addTaskUrl
      appStore.addTaskUrl = ''
      return
    }
    try {
      const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
      const text = await readText()
      if (text && detectResource(text)) {
        form.value.uris = text.trim()
      }
    } catch (e) { logger.debug('AddTask.readClipboard', e) }
  }
})

watch(() => appStore.droppedTorrentPaths, async (paths) => {
  if (paths.length > 0 && props.show) {
    activeTab.value = ADD_TASK_TYPE.TORRENT
    await loadTorrentFromPath(paths[0])
  }
})

async function loadTorrentFromPath(filePath: string) {
  try {
    const bytes = await readFile(filePath)
    const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    torrentName.value = filePath.substring(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1) || 'unknown.torrent'
    torrentBase64.value = uint8ToBase64(uint8)
    torrentLoaded.value = true
    await parseTorrentData(uint8)
  } catch (e) {
    logger.error('AddTask.loadTorrentFromPath', e)
  }
}

function uint8ToBase64(uint8: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i])
  }
  return btoa(binary)
}

async function parseTorrentData(uint8: Uint8Array) {
  try {
    const decoded = bencode.decode(uint8) as { info?: Record<string, unknown> & { name?: Uint8Array; files?: { path?: Uint8Array[]; length?: number; 'path.utf-8'?: Uint8Array[] }[]; length?: number }; 'creation date'?: number }
    const info = decoded.info
    if (!info) return

    const infoBytes = bencode.encode(info)
    const hashBuffer = await crypto.subtle.digest('SHA-1', new Uint8Array(infoBytes).buffer as ArrayBuffer)
    torrentInfoHash.value = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

    const textDecoder = new TextDecoder('utf-8', { fatal: false })
    const decodeName = (v: Uint8Array | string) => v instanceof Uint8Array ? textDecoder.decode(v) : String(v)

    if (info.files && info.files.length > 0) {
      torrentFiles.value = info.files.map((f: Record<string, unknown>, i: number) => {
        const pathParts = ((f.path || f['path.utf-8'] || []) as (Uint8Array | string)[]).map(decodeName)
        return {
          idx: i + 1,
          path: pathParts.join('/') || `file-${i + 1}`,
          length: Number(f.length) || 0,
        }
      })
      selectedFileIndices.value = torrentFiles.value.map(f => f.idx)
    } else if (info.name) {
      torrentFiles.value = [{
        idx: 1,
        path: decodeName((info['name.utf-8'] || info.name) as Uint8Array | string),
        length: Number(info.length) || 0,
      }]
      selectedFileIndices.value = [1]
    }
  } catch (e) {
    logger.error('AddTask.parseTorrentData', e)
    torrentFiles.value = []
    selectedFileIndices.value = []
  }
}

function clearTorrent() {
  torrentName.value = ''
  torrentBase64.value = ''
  torrentLoaded.value = false
  torrentInfoHash.value = ''
  torrentFiles.value = []
  selectedFileIndices.value = []
}

function handleTabChange(name: string) {
  slideDirection.value = name === ADD_TASK_TYPE.TORRENT ? 'left' : 'right'

  // FLIP: snapshot current height before switch
  const wrapper = document.querySelector('.add-task-card .n-tabs-pane-wrapper') as HTMLElement | null
  const startHeight = wrapper?.offsetHeight ?? 0

  activeTab.value = name

  // After Vue renders new tab content, animate height using Web Animations API
  // (runs on compositor layer, doesn't conflict with NUI's inline style management)
  nextTick(() => {
    requestAnimationFrame(() => {
      if (wrapper) {
        const endHeight = wrapper.scrollHeight
        if (Math.abs(startHeight - endHeight) > 2) {
          wrapper.animate(
            [{ height: startHeight + 'px' }, { height: endHeight + 'px' }],
            { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
          )
        }
      }
    })
  })
}

async function chooseDirectory() {
  try {
    const selected = await openDialog({ directory: true, multiple: false })
    if (typeof selected === 'string') form.value.dir = selected
  } catch (e) { logger.debug('AddTask.chooseDirectory', e) }
}

async function chooseTorrentFile() {
  try {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: 'Torrent', extensions: ['torrent'] }]
    })
    if (typeof selected === 'string') await loadTorrentFromPath(selected)
  } catch (e) { logger.debug('AddTask.chooseTorrentFile', e) }
}

function handleClose() {
  emit('close')
  clearTorrent()
}

async function handleSubmit() {
  if (submitting.value) return
  submitting.value = true
  try {
    if (activeTab.value === ADD_TASK_TYPE.URI) {
      if (!form.value.uris.trim()) return
      const uris = form.value.uris.split('\n').filter((u: string) => u.trim())
      const options: Aria2EngineOptions = {
        dir: form.value.dir,
        split: String(form.value.split),
        out: form.value.out || undefined,
      }
      if (form.value.userAgent) options['user-agent'] = form.value.userAgent
      if (form.value.referer) options.referer = form.value.referer
      const headers: string[] = []
      if (form.value.cookie) headers.push(`Cookie: ${form.value.cookie}`)
      if (form.value.authorization) headers.push(`Authorization: ${form.value.authorization}`)
      if (headers.length > 0) options.header = headers
      if (form.value.allProxy) options['all-proxy'] = form.value.allProxy
      if (uris.length > 1 && form.value.out) {
        delete options.out
        let outs = buildOuts(uris, form.value.out)
        if (outs.length === 0) {
          const dotIdx = form.value.out.lastIndexOf('.')
          const base = dotIdx > 0 ? form.value.out.substring(0, dotIdx) : form.value.out
          const ext = dotIdx > 0 ? form.value.out.substring(dotIdx) : ''
          outs = uris.map((_, i) => `${base}_${i + 1}${ext}`)
        }
        await taskStore.addUri({ uris, outs, options })
      } else {
        await taskStore.addUri({ uris, outs: [], options })
      }
    } else if (activeTab.value === ADD_TASK_TYPE.TORRENT && torrentBase64.value) {
      if (torrentInfoHash.value && isEngineReady()) {
        const { getClient } = await import('@/api/aria2')
        const [active, waiting] = await Promise.all([
          getClient().call('tellActive', ['infoHash']) as Promise<{infoHash?: string}[]>,
          getClient().call('tellWaiting', 0, 1000, ['infoHash']) as Promise<{infoHash?: string}[]>,
        ])
        const existing = [...active, ...waiting].map(t => t.infoHash).filter(Boolean)
        if (existing.includes(torrentInfoHash.value)) {
          message.warning(t('task.duplicate-task'), { duration: 5000, closable: true })
          return
        }
      }
      const options: Aria2EngineOptions = { dir: form.value.dir }
      if (selectedFileIndices.value.length > 0 && selectedFileIndices.value.length < torrentFiles.value.length) {
        options['select-file'] = selectedFileIndices.value.join(',')
      }
      await taskStore.addTorrent({ torrent: torrentBase64.value, options })
    } else {
      return
    }
    handleClose()
    if (form.value.newTaskShowDownloading) {
      router.push({ path: '/task/active' }).catch(() => { /* duplicate navigation */ })
    }
  } catch (e: unknown) {
    const errMsg = (e instanceof Error) ? e.message : String(e)
    logger.error('AddTask.submit', e)
    if (errMsg.includes('not initialized') || !isEngineReady()) {
      message.error(t('app.engine-not-ready'), { duration: 5000, closable: true })
    } else if (/duplicate|already/i.test(errMsg)) {
      message.warning(t('task.duplicate-task') || 'This task already exists and cannot be added again.', { duration: 5000, closable: true })
    } else {
      message.error(errMsg, { duration: 5000, closable: true })
    }
  } finally {
    submitting.value = false
  }
}

function handleHotkey(event: KeyboardEvent) {
  if (!props.show) return
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    handleSubmit()
  }
}

onMounted(() => { document.addEventListener('keydown', handleHotkey) })
onUnmounted(() => { document.removeEventListener('keydown', handleHotkey) })
</script>

<template>
  <NModal
    :show="props.show"
    :mask-closable="false"
    :close-on-esc="true"
    :auto-focus="false"
    transform-origin="center"
    :transition="{ name: 'fade-scale' }"
    @update:show="(v: boolean) => { if (!v) handleClose() }"
  >
    <NCard
      :title="t('task.new-task')"
      closable
      class="add-task-card"
      :style="{ maxWidth: '680px', minWidth: '380px', width: '70vw', marginTop: dialogTop }"
      :content-style="{ maxHeight: '60vh', overflowY: 'auto', overflowX: 'hidden' }"
      :segmented="{ footer: true }"
      @close="handleClose"
    >
      <NForm label-placement="left" label-width="110px">
        <NTabs :value="activeTab" type="line" animated @update:value="handleTabChange">
          <NTabPane :name="ADD_TASK_TYPE.URI" :tab="t('task.uri-task') || 'URL'">
            <div class="tab-pane-content">
              <NFormItem :show-label="false" style="margin-bottom: 0;">
                <NInput
                  v-model:value="form.uris"
                  type="textarea"
                  :rows="5"
                  :placeholder="t('task.uri-task-tips') || 'One URL per line'"
                />
              </NFormItem>
            </div>
          </NTabPane>
          <NTabPane :name="ADD_TASK_TYPE.TORRENT" :tab="t('task.torrent-task') || 'Torrent'">
            <div class="tab-pane-content">
              <Transition name="torrent-swap" mode="out-in">
                <div v-if="torrentLoaded" key="loaded" class="torrent-loaded">
                  <div class="torrent-info-row">
                    <NTooltip>
                      <template #trigger>
                        <div class="torrent-filename">
                          <NIcon :size="18" style="margin-right: 6px; flex-shrink: 0;"><CloudUploadOutline /></NIcon>
                          <span>{{ torrentName }}</span>
                        </div>
                      </template>
                      {{ torrentName }}
                    </NTooltip>
                    <NButton quaternary size="small" type="error" @click="clearTorrent">
                      <template #icon><NIcon :size="16"><TrashOutline /></NIcon></template>
                    </NButton>
                  </div>
                  <div v-if="torrentFiles.length > 0" class="torrent-file-list">
                    <NDataTable
                      v-model:checked-row-keys="checkedRowKeys"
                      :columns="fileColumns"
                      :data="torrentFiles"
                      :row-key="(row: any) => row.idx as number"
                      size="small"
                      :max-height="200"
                      :scroll-x="400"
                    />
                  </div>
                </div>
                <div v-else key="empty" class="torrent-upload" @click="chooseTorrentFile">
                  <NIcon :size="48" :depth="3"><CloudUploadOutline /></NIcon>
                  <NText style="display: block; margin-top: 8px; font-size: 14px;">
                    {{ t('task.select-torrent') || 'Drag torrent here or click to select' }}
                  </NText>
                </div>
              </Transition>
            </div>
          </NTabPane>
        </NTabs>
        <div class="tab-shared-form">
          <NGrid :cols="24" :x-gap="12">
            <NGridItem :span="15">
              <NFormItem :label="t('task.task-out') + ':'">
                <NInput v-model:value="form.out" :placeholder="t('task.task-out-tips')" :autofocus="false" />
              </NFormItem>
            </NGridItem>
            <NGridItem :span="9">
              <NFormItem :label="t('task.task-split') + ':'">
                <NInputNumber v-model:value="form.split" :min="1" :max="maxSplit" style="width: 100%;" />
              </NFormItem>
            </NGridItem>
          </NGrid>
          <NFormItem :label="t('task.task-dir') + ':'">
            <NInputGroup>
              <NInput v-model:value="form.dir" style="flex: 1;" />
              <NButton @click="chooseDirectory">
                <template #icon><NIcon><FolderOpenOutline /></NIcon></template>
              </NButton>
            </NInputGroup>
          </NFormItem>
          <NFormItem :show-label="false">
            <NCheckbox v-model:checked="showAdvanced">
              {{ t('task.show-advanced-options') }}
            </NCheckbox>
          </NFormItem>
          <NCollapseTransition :show="showAdvanced">
            <div>
              <NFormItem :label="t('task.task-user-agent') + ':'">
                <NInput v-model:value="form.userAgent" type="textarea" :autosize="{ minRows: 2, maxRows: 3 }" />
              </NFormItem>
              <NFormItem :label="t('task.task-authorization') + ':'">
                <NInput v-model:value="form.authorization" type="textarea" :autosize="{ minRows: 2, maxRows: 3 }" />
              </NFormItem>
              <NFormItem :label="t('task.task-referer') + ':'">
                <NInput v-model:value="form.referer" type="textarea" :autosize="{ minRows: 2, maxRows: 3 }" />
              </NFormItem>
              <NFormItem :label="t('task.task-cookie') + ':'">
                <NInput v-model:value="form.cookie" type="textarea" :autosize="{ minRows: 2, maxRows: 3 }" />
              </NFormItem>
              <NGrid :cols="24" :x-gap="12">
                <NGridItem :span="16">
                  <NFormItem :label="t('task.task-proxy') + ':'">
                    <NInput v-model:value="form.allProxy" placeholder="[http://][USER:PASSWORD@]HOST[:PORT]" />
                  </NFormItem>
                </NGridItem>
              </NGrid>
              <NFormItem :show-label="false">
                <NCheckbox v-model:checked="form.newTaskShowDownloading">
                  {{ t('task.navigate-to-downloading') }}
                </NCheckbox>
              </NFormItem>
            </div>
          </NCollapseTransition>
        </div>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="handleClose">{{ t('app.cancel') }}</NButton>
          <NButton type="primary" :loading="submitting" @click="handleSubmit">{{ t('app.submit') }}</NButton>
        </NSpace>
      </template>
    </NCard>
  </NModal>
</template>

<style scoped>
.tab-pane-content {
  min-height: 150px;
  padding-bottom: 12px;
}
.torrent-swap-enter-active {
  transition: opacity 0.22s cubic-bezier(0.2, 0, 0, 1), transform 0.22s cubic-bezier(0.2, 0, 0, 1);
}
.torrent-swap-leave-active {
  transition: opacity 0.15s cubic-bezier(0.3, 0, 0.8, 0.15), transform 0.15s cubic-bezier(0.3, 0, 0.8, 0.15);
}
.torrent-swap-enter-from {
  opacity: 0;
  transform: scale(0.96);
}
.torrent-swap-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
.torrent-upload {
  min-height: 138px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s cubic-bezier(0.2, 0, 0, 1);
}
.torrent-upload:hover {
  border-color: var(--color-primary);
}
.torrent-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  margin-bottom: 10px;
}
.torrent-filename {
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 14px;
  flex: 1;
  min-width: 0;
}
.torrent-filename span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.torrent-file-list {
  margin-top: 4px;
}

/* Tab slide animation for shared bottom form */
.tab-slide-left-enter-active,
.tab-slide-left-leave-active,
.tab-slide-right-enter-active,
.tab-slide-right-leave-active {
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
}
.tab-slide-left-enter-from {
  opacity: 0;
  transform: translateX(30px);
}
.tab-slide-left-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}
.tab-slide-right-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}
.tab-slide-right-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
</style>
