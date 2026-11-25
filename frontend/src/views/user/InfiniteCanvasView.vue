<template>
  <component :is="standalone ? 'div' : AppLayout" :class="standalone ? 'studio-page' : ''">
    <div
      class="studio-shell studio-frame studio-night flex flex-col overflow-hidden"
      :class="standalone ? 'studio-night--standalone' : 'studio-night--embedded'"
    >
      <header class="studio-topbar shrink-0">
        <div class="studio-brand">
          <span class="studio-brand-mark" aria-hidden="true"><Icon name="sparkles" size="sm" /></span>
          <strong class="studio-brand-title">{{ t('canvas.studioTitle') }}</strong>
        </div>

        <StudioSectionNav :active="activeTab" @select="activeTab = $event" />

        <button
          v-if="standalone"
          type="button"
          class="studio-icon-btn studio-theme-toggle"
          :aria-label="t(studioIsDark ? 'nav.lightMode' : 'nav.darkMode')"
          :title="t(studioIsDark ? 'nav.lightMode' : 'nav.darkMode')"
          @click="toggleStudioTheme"
        ><Icon :name="studioIsDark ? 'sun' : 'moon'" size="sm" /></button>

        <div v-else class="studio-topbar-actions">
          <button
            type="button"
            class="studio-btn studio-btn--ghost"
            @click="openStandalone"
          ><Icon name="externalLink" size="xs" aria-hidden="true" />{{ t('imageStudio.openStandalone') }}</button>
        </div>
      </header>

      <!-- 内容区 -->
      <div :key="sessionRevision" class="studio-body min-h-0 flex-1">
        <CanvasConversation v-if="activeTab === 'conversation'" class="h-full" />
        <CanvasChatDraw v-else-if="activeTab === 'chat'" class="h-full" />
        <CanvasVideoStudio v-else-if="activeTab === 'video'" class="h-full" />
        <CanvasPromptLibrary v-else-if="activeTab === 'prompts'" class="h-full" />
        <CanvasAssets v-else-if="activeTab === 'assets'" class="h-full" />
        <CanvasConfig v-else-if="activeTab === 'config'" />
      </div>
    </div>
  </component>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, watch, ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import CanvasVideoStudio from '@/components/canvas/CanvasVideoStudio.vue'
import CanvasPromptLibrary from '@/components/canvas/CanvasPromptLibrary.vue'
import CanvasAssets from '@/components/canvas/CanvasAssets.vue'
import StudioSectionNav from '@/components/canvas/StudioSectionNav.vue'
import { studioSections } from '@/components/canvas/studioSections'
import CanvasConfig from '@/components/canvas/CanvasConfig.vue'
import { activeTab } from '@/composables/useInfiniteCanvas'
import '@/components/canvas/studio-shell.css'
import '@/components/canvas/studio-night.css'

const CanvasChatDraw = defineAsyncComponent(() => import('@/components/canvas/CanvasChatDraw.vue'))
const CanvasConversation = defineAsyncComponent(() => import('@/components/canvas/CanvasConversation.vue'))
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// Standalone windows use the same preference as the website, including changes
// made in another tab. Embedded studios keep the website's existing controls.
const studioIsDark = ref(document.documentElement.classList.contains('dark'))
let themeObserver: MutationObserver | undefined
function toggleStudioTheme() {
  const dark = !document.documentElement.classList.contains('dark')
  document.documentElement.classList.toggle('dark', dark)
  localStorage.setItem('theme', dark ? 'dark' : 'light')
}
function onThemeStorage(event: StorageEvent) {
  if (route.query.standalone !== '1' || (event.key !== 'theme' && event.key !== null)) return
  const theme = localStorage.getItem('theme')
  document.documentElement.classList.toggle('dark', theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches))
}
onMounted(() => {
  themeObserver = new MutationObserver(() => { studioIsDark.value = document.documentElement.classList.contains('dark') })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  window.addEventListener('storage', onThemeStorage)
})
onUnmounted(() => { themeObserver?.disconnect(); window.removeEventListener('storage', onThemeStorage) })

const sessionRevision = ref(0)
let sessionTimer: ReturnType<typeof setTimeout> | undefined
function reloadSession() {
  clearTimeout(sessionTimer)
  sessionTimer = setTimeout(() => { sessionRevision.value++ }, 0)
}
onMounted(() => window.addEventListener('studio-session-ended', reloadSession))
onUnmounted(() => { clearTimeout(sessionTimer); window.removeEventListener('studio-session-ended', reloadSession) })

const standalone = computed(() => route.query.standalone === '1')
function openStandalone() {
  window.open(`${window.location.origin}/studio?standalone=1&tab=${activeTab.value}`, 'lyozc-canvas', 'width=1560,height=960')
}

watch(() => route.query.tab, value => {
  const tab = studioSections.find(tab => tab.id === value)
  activeTab.value = tab?.id ?? 'chat'
  if (value && !tab) {
    void router.replace({ query: { ...route.query, tab: activeTab.value } })
  }
}, { immediate: true })

watch(activeTab, v => {
  if (route.query.tab === v) return
  void router.replace({ query: { ...route.query, tab: v } })
})
</script>
