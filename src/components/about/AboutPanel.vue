<script setup lang="ts">
/** @fileoverview About panel with staggered entrance animations and glass effect. */
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NModal, NIcon } from 'naive-ui'
import { LogoGithub, HeartOutline, DocumentTextOutline, RocketOutline } from '@vicons/ionicons5'
import { open } from '@tauri-apps/plugin-shell'
import { getVersion } from '@tauri-apps/api/app'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const version = ref('')
const year = new Date().getFullYear()
const animate = ref(false)

onMounted(async () => {
  version.value = await getVersion()
})

/* Trigger entrance animation each time the panel opens. */
watch(
  () => props.show,
  (visible) => {
    if (visible) {
      animate.value = false
      requestAnimationFrame(() => {
        animate.value = true
      })
    }
  },
)

const techStack = [
  { name: 'Tauri v2', color: '#FFC131' },
  { name: 'Vue 3', color: '#42b883' },
  { name: 'aria2', color: '#339af0' },
  { name: 'Naive UI', color: '#63e2b7' },
  { name: 'TypeScript', color: '#3178c6' },
  { name: 'Vite', color: '#bd34fe' },
]

const links = [
  { key: 'github', label: 'GitHub', icon: LogoGithub, url: 'https://github.com/AnInsomniacy/motrix-next' },
  {
    key: 'release',
    i18n: 'about.release',
    icon: RocketOutline,
    url: 'https://github.com/AnInsomniacy/motrix-next/releases',
  },
  {
    key: 'license',
    i18n: 'about.license',
    icon: DocumentTextOutline,
    url: 'https://github.com/AnInsomniacy/motrix-next/blob/main/LICENSE',
  },
  {
    key: 'support',
    i18n: 'about.support',
    icon: HeartOutline,
    url: 'https://github.com/AnInsomniacy/motrix-next/issues',
  },
]

function openUrl(url: string) {
  open(url)
}
</script>

<template>
  <NModal
    :show="show"
    transform-origin="center"
    @update:show="
      (v: boolean) => {
        if (!v) emit('close')
      }
    "
  >
    <div class="about-glass" :class="{ 'about-enter': animate }">
      <!-- Close button -->
      <button class="about-close" :aria-label="t('about.about')" @click="emit('close')">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>

      <!-- Logo -->
      <div class="about-logo stagger stagger-1">
        <img src="@/assets/logo.png" alt="Motrix Next" width="96" height="96" />
      </div>

      <!-- Title + Version -->
      <div class="about-title stagger stagger-2">Motrix <span class="accent">Next</span></div>
      <div class="about-version stagger stagger-2">v{{ version }}</div>

      <!-- Description -->
      <p class="about-desc stagger stagger-3">{{ t('about.description') }}</p>

      <!-- Tech Stack -->
      <div class="about-section-label stagger stagger-4">Tech Stack</div>
      <div class="about-tags stagger stagger-4">
        <span v-for="tech in techStack" :key="tech.name" class="about-tag" :style="{ '--tag-color': tech.color }">
          {{ tech.name }}
        </span>
      </div>

      <!-- Links Grid -->
      <div class="about-links stagger stagger-5">
        <button v-for="link in links" :key="link.key" class="about-link-card" @click="openUrl(link.url)">
          <NIcon :size="18"><component :is="link.icon" /></NIcon>
          <span>{{ link.i18n ? t(link.i18n) : link.label }}</span>
        </button>
      </div>

      <!-- Footer -->
      <div class="about-footer stagger stagger-6">
        <span>
          Developed by
          <a class="about-link" @click="openUrl('https://github.com/AnInsomniacy')">AnInsomniacy</a>
          · Inspired by
          <a class="about-link" @click="openUrl('https://github.com/agalwood/Motrix')">Motrix</a>
        </span>
        <span>&copy; {{ year }} AnInsomniacy</span>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
/* ── Glass Container ──────────────────────────────────────────────── */
.about-glass {
  position: relative;
  max-width: 440px;
  min-width: 320px;
  width: 50vw;
  padding: 32px 28px 24px;
  text-align: center;
  border-radius: 16px;
  border: 1px solid var(--m3-outline-variant);
  background: var(--about-glass-bg);
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  box-shadow:
    0 8px 32px var(--m3-shadow),
    0 0 0 1px var(--about-glass-ring);
}

/* ── Close Button ─────────────────────────────────────────────────── */
.about-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--m3-on-surface-variant);
  cursor: pointer;
  transition: var(--transition-all);
}
.about-close:hover {
  background: var(--m3-surface-container-highest);
  color: var(--m3-on-surface);
}

/* ── Logo ─────────────────────────────────────────────────────────── */
.about-logo img {
  border-radius: 22px;
  box-shadow: 0 4px 20px var(--m3-shadow);
}

/* ── Title ────────────────────────────────────────────────────────── */
.about-title {
  margin-top: 16px;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: var(--m3-on-surface);
}
.about-title .accent {
  color: var(--color-primary);
}

/* ── Version Badge ────────────────────────────────────────────────── */
.about-version {
  display: inline-block;
  margin-top: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  padding: 3px 12px;
  border-radius: 20px;
  border: 1px solid var(--m3-outline-variant);
  color: var(--m3-on-surface-variant);
  background: var(--m3-surface-container);
}

/* ── Description ──────────────────────────────────────────────────── */
.about-desc {
  margin: 16px auto 0;
  max-width: 320px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--m3-on-surface-variant);
}

/* ── Section Label ────────────────────────────────────────────────── */
.about-section-label {
  margin-top: 20px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--m3-outline);
}

/* ── Tech Tags ────────────────────────────────────────────────────── */
.about-tags {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.about-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
  color: var(--tag-color);
  background: color-mix(in srgb, var(--tag-color) 12%, transparent);
  letter-spacing: 0.3px;
}

/* ── Link Cards (2×2 Grid) ────────────────────────────────────────── */
.about-links {
  margin-top: 20px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.about-link-card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 0;
  border: 1px solid var(--m3-outline-variant);
  border-radius: 10px;
  background: var(--about-card-bg);
  color: var(--m3-on-surface-variant);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: var(--transition-all);
}
.about-link-card:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--about-card-hover-bg);
}

/* ── Footer ───────────────────────────────────────────────────────── */
.about-footer {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--m3-outline);
}
.about-link {
  color: var(--color-primary);
  cursor: pointer;
  text-decoration: none;
}
.about-link:hover {
  text-decoration: underline;
}

/* ── Staggered Entrance Animation ─────────────────────────────────── */
.stagger {
  opacity: 0;
  transform: translateY(12px);
}
.about-enter .stagger {
  animation: about-fade-up 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
}
.about-enter .stagger-1 {
  animation-delay: 0.05s;
}
.about-enter .stagger-2 {
  animation-delay: 0.12s;
}
.about-enter .stagger-3 {
  animation-delay: 0.18s;
}
.about-enter .stagger-4 {
  animation-delay: 0.24s;
}
.about-enter .stagger-5 {
  animation-delay: 0.3s;
}
.about-enter .stagger-6 {
  animation-delay: 0.36s;
}

@keyframes about-fade-up {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
