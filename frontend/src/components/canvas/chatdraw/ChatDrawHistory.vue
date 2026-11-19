<template>
  <div class="flex h-full min-h-0 flex-col gap-2.5">
    <div class="flex min-h-9 items-center justify-between gap-2">
      <span class="text-[15px] font-bold text-[var(--st-text)]">{{ t('canvasChat.history') }}</span>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--st-muted)] transition-colors hover:bg-[var(--st-danger-soft)] hover:text-[var(--st-danger)] disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!sessions.length || (sessions.length === 1 && !sessions[0].turnCount)"
          :title="t('canvasChat.clearAll')"
          :aria-label="t('canvasChat.clearAll')"
          @click="emit('clear')"
        ><Icon name="trash" size="sm" /></button>
        <button
          v-if="closable"
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--st-muted)] transition-colors hover:bg-[var(--st-surface)] hover:text-[var(--st-text)]"
          :title="closeLabel"
          :aria-label="closeLabel"
          @click="emit('close')"
        ><Icon :name="closeIcon ??'x'" size="sm" /></button>
      </div>
    </div>

    <button
      type="button"
      class="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[var(--st-border)] bg-[var(--st-panel)] text-sm font-semibold text-[var(--st-text)] shadow-sm transition-colors hover:border-[var(--st-border-strong)]"
      @click="emit('create')"
    ><Icon name="plus" size="sm" />{{ t('canvasChat.newChat') }}</button>

    <label v-if="sessions.length > 6" class="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-[var(--st-border)] bg-[var(--st-panel)] px-3 text-[var(--st-muted)]">
      <Icon name="search" size="xs" class="shrink-0" />
      <input v-model="query" class="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--st-text)] outline-none placeholder:text-[var(--st-muted)]" :placeholder="t('canvasChat.searchHistory')" :aria-label="t('canvasChat.searchHistory')" />
    </label>

    <div class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1" role="list">
      <div
        v-for="s in filtered"
        :key="s.id"
        role="listitem"
        class="group relative mb-1 flex min-h-[3.125rem] items-center rounded-xl border px-2.5 py-2 transition-colors"
        :class="s.id === activeId
          ?'border-[var(--st-border-strong)] bg-[var(--st-surface)]'
          :'border-transparent hover:border-[var(--st-border)] hover:bg-[var(--st-panel-soft)]'"
      >
        <form v-if="editingId === s.id" class="w-full" @submit.prevent="commitRename(s.id)">
          <input
            ref="editInput"
            v-model="editingTitle"
            maxlength="80"
            :aria-label="t('canvasChat.rename')"
            class="h-8 w-full rounded-lg border border-[var(--st-border-strong)] bg-[var(--st-panel)] px-2 text-[13px] font-semibold outline-none focus:border-[var(--st-accent-border)]"
            @keydown.esc.prevent="editingId =''"
            @blur="commitRename(s.id)"
          />
        </form>
        <template v-else>
          <button
            type="button"
            class="flex min-w-0 flex-1 flex-col gap-0.5 pr-14 text-left"
            :aria-current="s.id === activeId ?'true' : undefined"
            @click="emit('select', s.id)"
            @dblclick.stop="beginRename(s)"
          >
            <span class="block truncate text-[13px] font-semibold leading-5 text-[var(--st-text)]">{{ s.title || t('canvasChat.untitled') }}</span>
            <span class="flex min-w-0 items-center gap-1.5 truncate text-[11px] leading-4 text-[var(--st-muted)]">
              <span>{{ s.turnCount ? t('canvasChat.sessionMeta', { turns: s.turnCount, images: s.imageCount }) : t('canvasChat.sessionEmpty') }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ formatTime(s.lastTs) }}</span>
            </span>
            <span
              v-if="running.has(s.id) || notices[s.id]"
              class="mt-0.5 w-fit rounded-full px-2 py-px text-[11px] font-semibold"
              :class="running.has(s.id)
                ?'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                : notices[s.id] ==='error'
                  ?'bg-[var(--st-danger-soft)] text-[var(--st-danger)]'
                  :'bg-[var(--st-accent-soft)] text-[var(--st-accent-text)]'"
            >{{ running.has(s.id) ? t('canvasChat.badgeRunning') : notices[s.id] ==='error' ? t('canvasChat.badgeError') : t('canvasChat.badgeDone') }}</span>
          </button>
          <div class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-px transition-opacity lg:opacity-0 lg:focus-within:opacity-100 lg:group-hover:opacity-100">
            <button
              type="button"
              class="flex h-6 w-6 items-center justify-center rounded-md text-[var(--st-muted)] hover:bg-[var(--st-panel)] hover:text-[var(--st-text)]"
              :title="t('canvasChat.rename')"
              :aria-label="t('canvasChat.rename')"
              @click.stop="beginRename(s)"
            ><Icon name="edit" size="xs" /></button>
            <button
              type="button"
              class="flex h-6 w-6 items-center justify-center rounded-md text-[var(--st-muted)] hover:bg-[var(--st-danger-soft)] hover:text-[var(--st-danger)]"
              :title="t('canvasChat.deleteSession')"
              :aria-label="t('canvasChat.deleteSession')"
              @click.stop="emit('delete', s.id)"
            ><Icon name="trash" size="xs" /></button>
          </div>
        </template>
      </div>
      <div v-if="!filtered.length" class="px-3 py-4 text-center text-xs leading-relaxed text-[var(--st-muted)]">
        {{ query.trim() ? t('canvasChat.noMatch') : t('canvasChat.historyEmpty') }}
      </div>
    </div>

    <!-- 底部统计 -->
    <div class="shrink-0 rounded-xl border border-[var(--st-border)] bg-[var(--st-panel-soft)] px-3 py-2.5">
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-[11px] text-[var(--st-muted)]">{{ t('canvasChat.statsImages') }}</span>
        <span class="text-base font-bold tabular-nums text-[var(--st-text)]">{{ totalImages }}</span>
      </div>
      <div class="mt-0.5 flex items-baseline justify-between gap-2">
        <span class="text-[11px] text-[var(--st-muted)]">{{ t('canvasChat.statsSessions') }}</span>
        <span class="text-xs font-semibold tabular-nums text-[var(--st-text-soft)]">{{ savedCount }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import type { ChatSession, SessionNotice } from '@/composables/useChatDrawEngine'

const props = defineProps<{
  sessions: ChatSession[]
  activeId: string
  running: Set<string>
  notices: Record<string, SessionNotice>
  totalImages: number
  closable?: boolean
  closeLabel?: string
  closeIcon?: 'chevronLeft' | 'x'
}>()
const emit = defineEmits<{
  create: []
  select: [id: string]
  rename: [id: string, title: string]
  delete: [id: string]
  clear: []
  close: []
}>()

const { t, locale } = useI18n()
const query = ref('')
const editingId = ref('')
const editingTitle = ref('')
const editInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null)

const filtered = computed(() => {
  const k = query.value.trim().toLowerCase()
  return k ? props.sessions.filter(s => (s.title || '').toLowerCase().includes(k)) : props.sessions
})
const savedCount = computed(() => props.sessions.filter(s => s.turnCount > 0).length)

function formatTime(ts: number): string {
  if (!ts) return ''
  return new Intl.DateTimeFormat(locale.value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}
function beginRename(s: ChatSession) {
  editingId.value = s.id
  editingTitle.value = s.title || ''
  void nextTick(() => {
    const el = Array.isArray(editInput.value) ? editInput.value[0] : editInput.value
    el?.focus()
    el?.select()
  })
}
function commitRename(id: string) {
  if (editingId.value !== id) return
  const title = editingTitle.value.trim()
  editingId.value = ''
  emit('rename', id, title)
}
</script>
