/** @fileoverview Application entry point: mounts Vue, initializes i18n, aria2 engine, and IPC listeners. */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import { i18n } from '@/composables/useLocale'
import { setI18nLocale } from '@shared/utils/i18n'
import { usePreferenceStore } from './stores/preference'
import { useTaskStore } from './stores/task'
import { useAppStore } from './stores/app'
import aria2Api, { initClient } from './api/aria2'
import { ENGINE_RPC_PORT } from '@shared/constants'
import { logger } from '@shared/logger'
import App from './App.vue'
import 'virtual:uno.css'
import './styles/variables.css'

import { getCurrentWindow } from '@tauri-apps/api/window'
import { getLocale } from 'tauri-plugin-locale-api'
import { nextTick } from 'vue'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(i18n)

app.mount('#app')

nextTick(() => {
    setTimeout(() => {
        getCurrentWindow().show()
        getCurrentWindow().setFocus()
    }, 50)
})

const preferenceStore = usePreferenceStore()
const taskStore = useTaskStore()
const appStore = useAppStore()

async function waitForEngine(port: number, secret: string, maxRetries = 15): Promise<boolean> {
    const { Aria2 } = await import('@shared/aria2')
    for (let i = 0; i < maxRetries; i++) {
        try {
            const probe = new Aria2({ host: '127.0.0.1', port, secret })
            await probe.open()
            await probe.call('getVersion')
            await probe.close()
            return true
        } catch { /* engine not ready yet, retry after delay */
            await new Promise((r) => setTimeout(r, 500))
        }
    }
    return false
}

async function autoCheckForUpdate() {
    const config = preferenceStore.config
    if (config.autoCheckUpdate === false) return

    const lastCheck = Number(config.lastCheckUpdateTime) || 0
    const intervalMs = (Number(config.autoCheckUpdateInterval) || 24) * 3_600_000
    if (Date.now() - lastCheck < intervalMs) return

    try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check()
        preferenceStore.updateAndSave({ lastCheckUpdateTime: Date.now() })
        if (update?.available) {
            appStore.pendingUpdate = update
        }
    } catch (e) {
        logger.warn('Updater', 'auto check failed: ' + (e as Error).message)
    }
}

preferenceStore.loadPreference().then(async () => {
    let locale = preferenceStore.locale
    if (!locale) {
        try {
            const raw = (await getLocale()) || 'en-US'
            const sysLang = raw.replace('-Hans', '').replace('-Hant', '')
            const available = i18n.global.availableLocales
            if (available.includes(sysLang)) {
                locale = sysLang
            } else {
                const prefix = sysLang.split('-')[0]
                locale = available.find(l => l === prefix || l.startsWith(prefix + '-')) || 'en-US'
            }
        } catch { /* locale detection failed, fallback to en-US */
            locale = 'en-US'
        }
        preferenceStore.updateAndSave({ locale })
    }
    if (locale && i18n.global.locale) {
        setI18nLocale(i18n, locale)
    }

    const config = preferenceStore.config
    const port = config.rpcListenPort || ENGINE_RPC_PORT
    let secret = config.rpcSecret || ''

    if (!secret) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        const values = crypto.getRandomValues(new Uint8Array(16))
        secret = Array.from(values, (v) => chars[v % chars.length]).join('')
        await preferenceStore.updateAndSave({ rpcSecret: secret })
    }

    taskStore.setApi(aria2Api)

    try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('save_system_config', {
            config: { 'rpc-secret': secret, 'rpc-listen-port': String(port) },
        })
        await invoke('start_engine_command')
    } catch (e) {
        logger.error('Engine', e)
    }

    const ready = await waitForEngine(port, secret)
    if (!ready) {
        logger.error('Engine', 'Engine did not become ready after retries')
    }

    try {
        await initClient({ port, secret })
        logger.info('Engine', `RPC client connected via WebSocket on port ${port}`)
    } catch (e) {
        logger.warn('Engine', 'WebSocket failed, using HTTP fallback: ' + (e as Error).message)
    }

    try {
        const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link')
        const startUrls = await getCurrent()
        if (startUrls && startUrls.length > 0) {
            appStore.handleDeepLinkUrls(startUrls)
        }
        await onOpenUrl((urls) => {
            appStore.handleDeepLinkUrls(urls)
        })
    } catch (e) {
        logger.warn('DeepLink', 'setup failed: ' + (e as Error).message)
    }

    autoCheckForUpdate()

    let lastClipboardText = ''
    getCurrentWindow().onFocusChanged(async ({ payload: focused }) => {
        if (!focused) return
        if (appStore.addTaskVisible) return
        try {
            const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
            const text = (await readText() || '').trim()
            if (!text || text === lastClipboardText) return
            const { detectResource } = await import('@shared/utils')
            if (detectResource(text)) {
                lastClipboardText = text
                appStore.addTaskUrl = text
                appStore.showAddTaskDialog('uri')
            }
        } catch (e) { logger.debug('Main.clipboardMonitor', e) }
    })
})

