<template>
  <div class="studio-panel flex h-full min-h-0 flex-col overflow-hidden">
    <!-- 顶部:视图切换 + 搜索 + 操作 -->
    <div class="studio-panel-head">
      <div class="studio-panel-title">
        <span class="studio-title-mark" aria-hidden="true"><Icon name="lightbulb" size="sm" /></span>
        <div class="min-w-0">
          <h2 class="studio-heading">{{ t('canvas.tabPrompts') }}</h2>
          <p class="studio-subheading">{{ t('canvas.promptLibraryHint') }}</p>
        </div>
      </div>

      <div class="ml-auto flex min-w-0 flex-wrap items-center gap-2">
        <div class="studio-segment" role="group" :aria-label="t('canvas.tabPrompts')">
          <button
            type="button"
            class="studio-segment-item"
            :class="view === 'mine' ? 'is-active' : ''"
            :aria-pressed="view === 'mine'"
            @click="view = 'mine'"
          >{{ t('canvas.promptMine') }}</button>
          <button
            type="button"
            class="studio-segment-item"
            :class="view === 'online' ? 'is-active' : ''"
            :aria-pressed="view === 'online'"
            @click="view = 'online'"
          >{{ t('canvas.promptOnline') }}</button>
        </div>

        <label class="studio-field min-w-[8.5rem] max-w-full flex-1 sm:max-w-[14rem]">
          <Icon name="search" size="xs" aria-hidden="true" />
          <input
            v-if="view === 'mine'"
            v-model="search"
            type="text"
            :placeholder="t('canvas.promptSearch')"
            :aria-label="t('canvas.promptSearch')"
          />
          <input
            v-else
            v-model="onlineSearch"
            type="text"
            :placeholder="t('canvas.promptSearch')"
            :aria-label="t('canvas.promptSearch')"
          />
        </label>

        <template v-if="view === 'mine'">
          <button type="button" class="studio-btn studio-btn--quiet studio-btn--sm" @click="recoverPrompts">
            <Icon name="sync" size="xs" aria-hidden="true" />{{ t('canvas.recoverPrompts') }}
          </button>
          <button type="button" class="studio-btn studio-btn--primary" @click="onCreate">
            <Icon name="plus" size="xs" aria-hidden="true" />{{ t('canvas.promptNew') }}
          </button>
        </template>
        <button
          v-else-if="activeSource"
          type="button"
          class="studio-btn studio-btn--ghost studio-btn--sm"
          @click="reloadActive"
        ><Icon name="refresh" size="xs" aria-hidden="true" />{{ t('canvas.onlineRefresh') }}</button>
      </div>
    </div>

    <!-- 在线模板库 -->
    <template v-if="view === 'online'">
      <div class="flex flex-wrap gap-1.5 border-b px-4 py-3" :style="{ borderColor: 'var(--st-border)' }">
        <button
          v-for="s in sources"
          :key="s.id"
          type="button"
          class="studio-chip"
          :class="activeSourceId === s.id ? 'is-active' : ''"
          :aria-pressed="activeSourceId === s.id"
          @click="loadSource(s.id)"
        >
          {{ s.name }}<span class="studio-chip-count">{{ s.loading ? '…' : (s.items.length || '') }}</span>
        </button>
      </div>
      <div v-if="!activeSource" class="studio-scroll flex flex-1 items-center justify-center p-6">
        <p class="studio-note max-w-md text-center">{{ t('canvas.onlinePickSource') }}</p>
      </div>
      <div v-else-if="activeSource.loading && !activeSource.items.length" class="flex flex-1 flex-col items-center justify-center gap-2.5 p-6" role="status">
        <span class="prompt-spinner" aria-hidden="true"></span>
        <p class="studio-note">{{ t('canvas.onlineLoading') }}</p>
      </div>
      <div v-else-if="activeSource.error" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p class="studio-alert max-w-md" role="alert">{{ t('canvas.onlineLoadFailed') }}: {{ activeSource.error }}</p>
        <button type="button" class="studio-btn studio-btn--ghost" @click="loadSource(activeSource.id, true)">
          <Icon name="refresh" size="xs" aria-hidden="true" />{{ t('common.retry') }}
        </button>
      </div>
      <div v-else class="studio-scroll flex-1 p-4">
        <div v-if="filteredOnline.length" class="prompt-grid">
          <article v-for="p in filteredOnline" :key="p.id" class="studio-card overflow-hidden">
            <img
              v-if="p.coverUrl"
              :src="p.coverUrl"
              loading="lazy"
              class="h-32 w-full border-b object-cover"
              :style="{ borderColor: 'var(--st-border)', background: 'var(--st-surface)' }"
              alt=""
              referrerpolicy="no-referrer"
            />
            <div class="studio-card-head">
              <h3 class="studio-card-title" :title="p.title">{{ p.title }}</h3>
            </div>
            <p class="studio-card-text">{{ p.prompt }}</p>
            <div class="studio-card-actions">
              <button type="button" class="studio-btn studio-btn--quiet studio-btn--sm" @click="fillPrompt('image', p.prompt)">
                <Icon name="chat" size="xs" aria-hidden="true" />{{ t('canvas.useForImage') }}
              </button>
              <button type="button" class="studio-btn studio-btn--quiet studio-btn--sm" @click="fillPrompt('video', p.prompt)">
                <Icon name="play" size="xs" aria-hidden="true" />{{ t('canvas.useForVideo') }}
              </button>
              <button
                type="button"
                class="studio-icon-btn ml-auto !h-7 !w-7"
                :title="t('canvas.onlineFav')"
                :aria-label="t('canvas.onlineFav')"
                @click="favOnline(p)"
              ><Icon name="plus" size="xs" /></button>
            </div>
          </article>
        </div>
        <p v-else class="studio-note py-12 text-center">{{ t('canvas.onlineEmpty') }}</p>
      </div>
    </template>

    <!-- 我的提示词 -->
    <div v-else class="studio-scroll flex-1 p-4">
      <div v-if="filtered.length" class="prompt-grid">
        <article v-for="p in filtered" :key="p.id" class="studio-card">
          <div class="studio-card-head">
            <h3 class="studio-card-title" :title="p.name">{{ p.name }}</h3>
            <span v-if="p.category" class="studio-tag">{{ p.category }}</span>
          </div>
          <p class="studio-card-text">{{ p.content }}</p>
          <div class="studio-card-actions">
            <button type="button" class="studio-btn studio-btn--quiet studio-btn--sm" @click="copy(p)">
              <Icon name="copy" size="xs" aria-hidden="true" />{{ t('canvas.copy') }}
            </button>
            <button type="button" class="studio-btn studio-btn--quiet studio-btn--sm" @click="fillPrompt('image', p.content)">
              <Icon name="chat" size="xs" aria-hidden="true" />{{ t('canvas.useForImage') }}
            </button>
            <button type="button" class="studio-btn studio-btn--quiet studio-btn--sm" @click="fillPrompt('video', p.content)">
              <Icon name="play" size="xs" aria-hidden="true" />{{ t('canvas.useForVideo') }}
            </button>
            <button
              v-if="!p.builtin"
              type="button"
              class="studio-icon-btn prompt-delete ml-auto !h-7 !w-7"
              :title="t('common.delete')"
              :aria-label="t('common.delete')"
              @click="onDelete(p)"
            ><Icon name="trash" size="xs" /></button>
            <span v-else class="studio-tag ml-auto">{{ t('canvas.builtin') }}</span>
          </div>
        </article>
      </div>
      <div v-else class="studio-empty">
        <span class="studio-empty-mark" aria-hidden="true"><Icon name="lightbulb" size="lg" /></span>
        <h3 class="studio-empty-title">{{ t(search.trim() ? 'canvas.sidePanel.noPrompts' : 'canvas.promptEmptyTitle') }}</h3>
        <p class="studio-empty-text">{{ t(search.trim() ? 'canvas.promptNoMatchHint' : 'canvas.promptEmptyHint') }}</p>
        <div class="studio-empty-actions">
          <button type="button" class="studio-btn studio-btn--primary" @click="onCreate">
            <Icon name="plus" size="xs" aria-hidden="true" />{{ t('canvas.promptNew') }}
          </button>
          <button type="button" class="studio-btn studio-btn--ghost" @click="view = 'online'">
            <Icon name="globe" size="xs" aria-hidden="true" />{{ t('canvas.promptOnline') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 新建/编辑弹层 -->
    <div v-if="editing" class="studio-shell studio-overlay" @click.self="editing = null">
      <div
        ref="dialogEl"
        class="studio-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('canvas.promptNew')"
        tabindex="-1"
      >
        <div class="studio-dialog-head">
          <h2 class="studio-heading">{{ t('canvas.promptNew') }}</h2>
          <button
            type="button"
            class="studio-icon-btn"
            :aria-label="t('common.close')"
            :title="t('common.close')"
            @click="editing = null"
          ><Icon name="x" size="sm" /></button>
        </div>
        <div class="studio-dialog-body">
          <div class="flex flex-wrap gap-2.5">
            <label class="studio-label min-w-[12rem] flex-1">
              {{ t('canvas.promptName') }}
              <input v-model="editName" type="text" class="studio-input--boxed" :placeholder="t('canvas.promptName')" />
            </label>
            <label class="studio-label min-w-[8rem] flex-1 sm:max-w-[10rem]">
              {{ t('canvas.promptCategory') }}
              <input v-model="editCategory" type="text" class="studio-input--boxed" :placeholder="t('canvas.promptCategory')" />
            </label>
          </div>
          <label class="studio-label">
            {{ t('canvas.promptContent') }}
            <textarea v-model="editContent" rows="9" class="studio-textarea"></textarea>
          </label>
        </div>
        <div class="studio-dialog-foot">
          <button type="button" class="studio-btn studio-btn--ghost" @click="editing = null">{{ t('common.cancel') }}</button>
          <button
            type="button"
            class="studio-btn studio-btn--primary"
            :disabled="!editName.trim() || !editContent.trim()"
            @click="onSave"
          >{{ t('common.save') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import { useAppStore } from '@/stores/app'
import { useStudioDialog } from '@/composables/useStudioDialog'
import {
  prompts, loadPrompts, addPrompt, deletePrompt, recoverLegacyPrompts,
} from '@/composables/useInfiniteCanvas'
import { useStudioPromptHandoff } from '@/composables/useStudioPromptHandoff'
import {
  sources, activeSourceId, activeSource, onlineSearch, filteredOnline,
  loadSource, rememberOnlinePrompt, type OnlinePrompt,
} from '@/composables/useOnlinePrompts'
import './studio-shell.css'

const { t } = useI18n()
const appStore = useAppStore()
const { fillPrompt } = useStudioPromptHandoff()

const search = ref('')
const view = ref<'mine' | 'online'>('mine')
const editing = ref<{ id?: string; name: string; category: string; content: string } | null>(null)
const editName = ref('')
const editCategory = ref('')
const editContent = ref('')
const dialogEl = ref<HTMLElement>()
useStudioDialog(dialogEl, () => { editing.value = null }, computed(() => Boolean(editing.value)))

const filtered = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return prompts.value
  return prompts.value.filter(p => p.name.toLowerCase().includes(kw) || p.category.toLowerCase().includes(kw) || p.content.toLowerCase().includes(kw))
})

onMounted(() => { void loadPrompts() })

function onCreate() {
  editName.value = ''
  editCategory.value = ''
  editContent.value = ''
  editing.value = { name: '', category: '', content: '' }
}
async function onSave() {
  if (!editing.value || !editName.value.trim() || !editContent.value.trim()) return
  await addPrompt(editName.value.trim(), editCategory.value.trim(), editContent.value.trim())
  editing.value = null
}
async function onDelete(p: { id: string }) {
  if (window.confirm(t('canvas.promptDeleteConfirm'))) await deletePrompt(p.id)
}
async function copy(p: { content: string }) {
  try {
    await navigator.clipboard.writeText(p.content)
    appStore.showSuccess(t('imageStudio.copied'))
  } catch {
    appStore.showError(t('common.copyFailed'))
  }
}
async function recoverPrompts() {
  if (!window.confirm(t('canvas.recoverPromptsConfirm'))) return
  try {
    const count = await recoverLegacyPrompts()
    appStore.showSuccess(t('canvas.recoverPromptsDone', { count }))
  } catch { appStore.showError(t('canvas.legacyHistoryFailed')) }
}
async function favOnline(p: OnlinePrompt) {
  const info = rememberOnlinePrompt(p)
  await addPrompt(info.name, info.category, info.content)
}
function reloadActive() {
  if (activeSource.value) void loadSource(activeSource.value.id, true)
}
</script>

<style scoped>
/* align-items: start keeps each card at its natural height, so short prompts
 * no longer leave the large empty gaps the stretched layout produced. */
.prompt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 17.5rem), 1fr));
  align-content: start;
  align-items: start;
  gap: 12px;
}
.prompt-delete:hover {
  border-color: var(--st-danger-border);
  color: var(--st-danger);
}
.prompt-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid var(--st-border-strong);
  border-top-color: var(--st-accent);
  border-radius: 50%;
  animation: prompt-spin 0.9s linear infinite;
}
@keyframes prompt-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .prompt-spinner {
    animation: none;
  }
}
</style>
