<template>
  <div class="studio-panel flex h-full min-h-0 flex-col overflow-hidden">
    <div class="studio-panel-head">
      <div class="studio-panel-title">
        <span class="studio-title-mark" aria-hidden="true"><Icon name="grid" size="sm" /></span>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h2 class="studio-heading">{{ t('canvas.tabAssets') }}</h2>
            <span class="studio-count">{{ items.length }}</span>
          </div>
          <p class="studio-subheading">{{ t('canvas.assetsHint') }}</p>
        </div>
      </div>
      <div class="ml-auto flex min-w-0 flex-wrap items-center gap-2">
        <div class="studio-segment" role="group" :aria-label="t('canvas.assetsFilterLabel')">
          <button
            v-for="option in KIND_FILTERS"
            :key="option"
            type="button"
            class="studio-segment-item"
            :class="kind === option ? 'is-active' : ''"
            :aria-pressed="kind === option"
            @click="kind = option"
          >
            {{ t(`canvas.assetsFilter.${option}`) }}
            <span class="studio-chip-count">{{ counts[option] }}</span>
          </button>
        </div>
        <label class="studio-field min-w-[8.5rem] max-w-full flex-1 sm:max-w-[15rem] sm:flex-none sm:basis-[15rem]">
          <Icon name="search" size="xs" aria-hidden="true" />
          <input
            v-model="search"
            type="text"
            :placeholder="t('imageStudio.historySearch')"
            :aria-label="t('imageStudio.historySearch')"
          />
        </label>
      </div>
    </div>

    <div class="studio-scroll flex-1 p-4">
      <!-- 旧版历史导入提示(组件自带下外边距,无内容时不渲染) -->
      <StudioLegacyHistory kind="image" @imported="loadImageHistory" />

      <div v-if="items.length" class="asset-grid">
        <figure v-for="item in items" :key="item.kind + item.id" class="asset-card">
          <div class="asset-media">
            <button
              v-if="item.kind === 'image'"
              type="button"
              class="asset-open"
              :aria-label="t('canvasChat.preview')"
              :title="t('canvasChat.preview')"
              @click="viewer = item.url"
            >
              <img
                :src="item.url"
                class="aspect-square w-full select-none object-contain"
                draggable="false"
                alt=""
              />
            </button>
            <video v-else :src="item.url" controls preload="metadata" class="aspect-video w-full bg-black object-contain"></video>
          </div>
          <figcaption class="asset-caption">
            <span class="asset-caption-prompt" :title="item.prompt || t('canvas.assetsNoPrompt')">{{ item.prompt || t('canvas.assetsNoPrompt') }}</span>
            <span class="asset-caption-meta">
              <span class="asset-kind">{{ t(item.kind === 'image' ? 'canvas.kindImage' : 'canvas.kindVideo') }}</span>
              <span v-if="item.model" class="asset-caption-model" :title="item.model">{{ item.model }}</span>
              <time :datetime="new Date(item.ts).toISOString()">{{ formatTime(item.ts) }}</time>
            </span>
            <div class="asset-actions">
              <button
                v-if="item.prompt?.trim()"
                type="button"
                class="studio-btn studio-btn--accent-soft studio-btn--sm"
                @click="fillPrompt(item.kind, item.prompt)"
              ><Icon name="edit" size="xs" aria-hidden="true" />{{ t('canvas.reusePrompt') }}</button>
              <a :href="item.url" :download="item.download" class="studio-icon-btn ml-auto" :title="t('imageStudio.download')" :aria-label="t('imageStudio.download')">
                <Icon name="download" size="xs" aria-hidden="true" />
              </a>
              <button
                type="button"
                class="studio-icon-btn asset-delete"
                :title="t('common.delete')"
                :aria-label="t('common.delete')"
                @click="item.remove()"
              ><Icon name="trash" size="xs" aria-hidden="true" /></button>
            </div>
          </figcaption>
        </figure>
      </div>

      <div v-else class="studio-empty">
        <span class="studio-empty-mark" aria-hidden="true"><Icon name="inbox" size="lg" /></span>
        <h3 class="studio-empty-title">{{ t(emptyState.title) }}</h3>
        <p class="studio-empty-text">{{ t(emptyState.text) }}</p>
        <div class="studio-empty-actions">
          <button v-if="filtersActive" type="button" class="studio-btn studio-btn--primary" @click="clearFilters">
            <Icon name="x" size="xs" aria-hidden="true" />{{ t('canvas.assetsClearFilters') }}
          </button>
          <template v-else>
            <button type="button" class="studio-btn studio-btn--primary" @click="goTab('chat')">
              <Icon name="chat" size="xs" aria-hidden="true" />{{ t('canvas.tabChat') }}
            </button>
            <button type="button" class="studio-btn studio-btn--ghost" @click="goTab('video')">
              <Icon name="play" size="xs" aria-hidden="true" />{{ t('canvas.tabVideo') }}
            </button>
          </template>
        </div>
      </div>
    </div>

    <div
      v-if="viewer"
      ref="dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('canvas.kindImage')"
      tabindex="-1"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-6"
      @click="viewer = null"
    >
      <button
        type="button"
        :aria-label="t('common.close')"
        :title="t('common.close')"
        class="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        @click="viewer = null"
      ><Icon name="x" size="sm" /></button>
      <img :src="viewer" class="max-h-[90vh] max-w-[92vw] rounded-xl object-contain" alt="" @click.stop />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useStudioDialog } from '@/composables/useStudioDialog'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import { useStudioImageAssets } from '@/composables/useStudioImageAssets'
import { imageFileExtension } from '@/composables/studioMedia'
import StudioLegacyHistory from './StudioLegacyHistory.vue'
import { loadHistory as loadImageHistory } from '@/composables/useImageStudioEngine'
import { activeTab } from '@/composables/useInfiniteCanvas'
import { useStudioPromptHandoff } from '@/composables/useStudioPromptHandoff'
import {
  history as videoHistory, historyVideoUrl, deleteHistory as deleteVideoHistory,
  loadHistory as loadVideoHistory,
} from '@/composables/useVideoStudioEngine'
import './studio-shell.css'

const { t, locale } = useI18n()
const { fillPrompt } = useStudioPromptHandoff()
const { items: imageHistory, objectUrlFor: imageObjectUrl } = useStudioImageAssets()

const KIND_FILTERS = ['all', 'image', 'video'] as const
type KindFilter = typeof KIND_FILTERS[number]

const search = ref('')
const kind = ref<KindFilter>('all')
const viewer = ref<string | null>(null)
const dialog = ref<HTMLElement>()
useStudioDialog(dialog, () => { viewer.value = null }, computed(() => Boolean(viewer.value)))

interface AssetItem {
  kind: 'image' | 'video'
  id: string | number
  ts: number
  url: string
  prompt: string
  model: string
  download: string
  remove: () => void
}

/** 搜索结果(含两种类型);提示词与模型都参与匹配,与搜索框提示一致 */
const matched = computed<AssetItem[]>(() => {
  const kw = search.value.trim().toLowerCase()
  const hit = (item: { prompt: string; model: string }) =>
    !kw || `${item.prompt} ${item.model}`.toLowerCase().includes(kw)
  const out: AssetItem[] = []
  for (const item of imageHistory.value) {
    if (!hit(item)) continue
    const url = imageObjectUrl(item)
    if (!url) continue
    out.push({
      kind: 'image', id: item.id, ts: item.ts, url, prompt: item.prompt, model: item.model,
      download: `image-${item.ts}.${imageFileExtension(item.images[0].blob!)}`,
      remove: () => void item.remove()
    })
  }
  for (const item of videoHistory.value) {
    if (!hit(item)) continue
    out.push({
      kind: 'video', id: item.id, ts: item.ts, url: historyVideoUrl(item), prompt: item.prompt, model: item.model,
      download: `video-${item.ts}.mp4`,
      remove: () => void deleteVideoHistory(item.id)
    })
  }
  return out.sort((a, b) => b.ts - a.ts)
})
const counts = computed<Record<KindFilter, number>>(() => ({
  all: matched.value.length,
  image: matched.value.filter(item => item.kind === 'image').length,
  video: matched.value.filter(item => item.kind === 'video').length
}))
const items = computed(() => kind.value === 'all' ? matched.value : matched.value.filter(item => item.kind === kind.value))
const filtersActive = computed(() => Boolean(search.value.trim()) || kind.value !== 'all')
const emptyState = computed(() => {
  if (search.value.trim()) return { title: 'canvas.assetsNoMatch', text: 'canvas.assetsNoMatchHint' }
  if (kind.value !== 'all') return { title: 'canvas.assetsNoMatch', text: `canvas.assetsNoKind.${kind.value}` }
  return { title: 'canvas.assetsEmptyTitle', text: 'canvas.noAssets' }
})
function clearFilters() {
  search.value = ''
  kind.value = 'all'
}
function formatTime(ts: number) {
  return new Intl.DateTimeFormat(locale.value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ts)
}

function goTab(tab: 'chat' | 'video') {
  activeTab.value = tab
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && viewer.value) viewer.value = null
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void loadImageHistory()
  void loadVideoHistory()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
  align-content: start;
  align-items: start;
  gap: 12px;
}
.asset-card {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--st-border);
  border-radius: 14px;
  background: var(--st-panel);
  box-shadow: var(--st-shadow-sm);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.asset-card:hover,
.asset-card:focus-within {
  border-color: var(--st-border-strong);
  box-shadow: var(--st-shadow);
}
.asset-media {
  position: relative;
  min-width: 0;
  background: var(--st-surface);
}
.asset-open {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
}
.asset-open:focus-visible {
  outline: 2px solid var(--st-focus);
  outline-offset: -2px;
}
.asset-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 6px;
}
.asset-actions .asset-delete:hover {
  border-color: var(--st-danger-border);
  color: var(--st-danger);
}
.asset-caption {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--st-border);
  color: var(--st-text-soft);
  font-size: 11px;
  line-height: 1.5;
}
.asset-caption-prompt {
  min-width: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
  color: var(--st-text);
  font-size: 13px;
}
.asset-caption-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--st-muted);
  font-size: 10px;
}
.asset-kind {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--st-surface);
  color: var(--st-text-soft);
}
.asset-caption-model {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.asset-caption-meta time {
  flex-shrink: 0;
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
@media (pointer: coarse) {
  .asset-actions :is(a, button) {
    min-height: 44px;
    min-width: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .asset-card {
    transition: none;
  }
}
</style>
