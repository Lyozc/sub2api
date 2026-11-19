<template>
  <component :is="standalone ? 'div' : AppLayout" :class="standalone ? 'min-h-screen bg-gray-50 p-3 dark:bg-dark-950' : ''">
    <div
      class="studio-shell studio-frame flex flex-col overflow-hidden lg:min-h-[560px] lg:overflow-hidden"
      :class="standalone ? 'lg:h-[calc(100dvh-1.5rem)]' : 'lg:h-[calc(100dvh-9rem)]'"
      :style="['video', 'conversation'].includes(activeTab) ? { height: standalone ? 'calc(100dvh - 1.5rem)' : 'calc(100dvh - 9rem)', minHeight: '520px', overflow: 'hidden' } : undefined"
    >
      <!-- 工作台头部:品牌 + 主导航(移动端导航可横向滑动) -->
      <header class="studio-topbar shrink-0">
        <div class="studio-brand">
          <span class="studio-brand-mark" aria-hidden="true"><Icon name="sparkles" size="sm" /></span>
          <span class="studio-brand-text">
            <strong class="studio-brand-title">{{ t('canvas.studioTitle') }}</strong>
            <span class="studio-brand-sub">{{ t(activeTabMeta.label) }} · {{ t('canvas.studioSubtitle') }}</span>
          </span>
        </div>

        <nav class="studio-nav" :aria-label="t('canvas.studioNav')">
          <button
            v-for="tab in TABS"
            :key="tab.value"
            type="button"
            class="studio-nav-item"
            :class="activeTab === tab.value ? 'is-active' : ''"
            :aria-current="activeTab === tab.value ? 'page' : undefined"
            @click="switchTab(tab.value)"
          ><Icon :name="tab.icon" size="sm" aria-hidden="true" /><span class="studio-nav-label">{{ t(tab.label) }}</span></button>
        </nav>

        <div class="studio-topbar-actions">
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
import CanvasConfig from '@/components/canvas/CanvasConfig.vue'
import { activeTab } from '@/composables/useInfiniteCanvas'
import '@/components/canvas/studio-shell.css'

const CanvasChatDraw = defineAsyncComponent(() => import('@/components/canvas/CanvasChatDraw.vue'))
const CanvasConversation = defineAsyncComponent(() => import('@/components/canvas/CanvasConversation.vue'))
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

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

const TABS = [
  { value: 'conversation' as const, label: 'canvas.tabConversation', icon: 'chat' as const },
  { value: 'chat' as const, label: 'canvas.tabChat', icon: 'chat' as const },
  { value: 'video' as const, label: 'canvas.tabVideo', icon: 'play' as const },
  { value: 'prompts' as const, label: 'canvas.tabPrompts', icon: 'lightbulb' as const },
  { value: 'assets' as const, label: 'canvas.tabAssets', icon: 'grid' as const },
  { value: 'config' as const, label: 'canvas.tabConfig', icon: 'cog' as const }
]
const activeTabMeta = computed(() => TABS.find(tab => tab.value === activeTab.value) ?? TABS[0])

watch(() => route.query.tab, value => {
  const tab = TABS.find(tab => tab.value === value)
  activeTab.value = tab?.value ?? 'chat'
  if (value && !tab) {
    void router.replace({ query: { ...route.query, tab: activeTab.value } })
  }
}, { immediate: true })

watch(activeTab, v => {
  if (route.query.tab === v) return
  void router.replace({ query: { ...route.query, tab: v } })
})

function switchTab(v: typeof activeTab.value) {
  activeTab.value = v
}


</script>
