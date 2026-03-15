<script setup lang="ts">
/** @fileoverview Custom window control buttons (minimize, maximize/restore, close). */
import { getCurrentWindow } from '@tauri-apps/api/window'
import { NIcon } from 'naive-ui'
import { RemoveOutline, CopyOutline, SquareOutline, CloseOutline } from '@vicons/ionicons5'
import { usePreferenceStore } from '@/stores/preference'

defineProps<{
  isMaximized: boolean
}>()

const emit = defineEmits<{
  close: []
  'maximize-toggled': []
}>()

const appWindow = getCurrentWindow()
const preferenceStore = usePreferenceStore()

function minimize() {
  appWindow.minimize()
}

function toggleMaximize() {
  appWindow.toggleMaximize()
  emit('maximize-toggled')
}

async function close() {
  if (preferenceStore.config.minimizeToTrayOnClose) {
    // Signal Rust to hide the Dock icon if the user opted in.
    // The Rust command reads the preference from the persistent store.
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_dock_visible', { visible: false })

    appWindow.hide()
  } else {
    // Emit to parent instead of triggering the native window close.
    // On macOS, the native close → onCloseRequested → preventDefault()
    // flow freezes the webview (known Tauri v2 bug).  The parent
    // (MainLayout) handles showing the exit confirmation dialog.
    emit('close')
  }
}
</script>

<template>
  <div class="window-controls">
    <button class="ctrl-btn" title="Minimize" @click="minimize">
      <NIcon :size="14"><RemoveOutline /></NIcon>
    </button>
    <button class="ctrl-btn" :title="isMaximized ? 'Restore' : 'Maximize'" @click="toggleMaximize">
      <NIcon :size="14">
        <Transition name="icon-swap" mode="out-in">
          <CopyOutline v-if="isMaximized" key="restore" />
          <SquareOutline v-else key="maximize" />
        </Transition>
      </NIcon>
    </button>
    <button class="ctrl-btn close" title="Close" @click="close">
      <NIcon :size="14"><CloseOutline /></NIcon>
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ctrl-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--window-ctrl-border);
  border-radius: 8px;
  background: var(--window-ctrl-bg);
  color: var(--window-ctrl-color);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  outline: none;
  padding: 0;
}
.ctrl-btn:hover {
  background: var(--window-ctrl-hover-bg);
  border-color: var(--window-ctrl-hover-border);
  color: var(--window-ctrl-hover-color);
}
.ctrl-btn.close:hover {
  background: rgba(255, 59, 48, 0.75);
  border-color: rgba(255, 59, 48, 0.9);
  color: #fff;
}

/* Icon cross-fade animation for maximize ↔ restore toggle */
.icon-swap-enter-active,
.icon-swap-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}
.icon-swap-enter-from {
  opacity: 0;
  transform: scale(0.75);
}
.icon-swap-leave-to {
  opacity: 0;
  transform: scale(0.75);
}
</style>
