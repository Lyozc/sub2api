<template>
  <div class="chat-history">
    <div class="chat-history-heading">
      <strong>{{ t('studioChat.history') }}</strong>
      <button v-if="closable" type="button" class="studio-icon-btn" :aria-label="closeLabel || t('common.close')" :title="closeLabel || t('common.close')" @click="emit('close')"><Icon :name="closeIcon ?? 'x'" size="sm" /></button>
    </div>
    <button type="button" class="studio-btn studio-btn--ghost chat-history-new" :disabled="!chatReady" @click="create"><Icon name="plus" size="sm" />{{ t('studioChat.newChat') }}</button>
    <label class="studio-field chat-history-search"><Icon name="search" size="xs" /><input v-model="search" :placeholder="t('studioChat.search')" :aria-label="t('studioChat.search')" /></label>
    <div class="studio-scroll chat-history-list" role="list">
      <div v-for="conversation in filtered" :key="conversation.id" class="chat-history-item" :class="{ 'is-active': conversation.id === chatActiveId }" role="listitem">
        <form v-if="editing === conversation.id" class="chat-history-rename" @submit.prevent="rename(conversation.id)">
          <input v-model="title" class="studio-input--boxed" :aria-label="t('studioChat.rename')" maxlength="80" @keydown.esc.prevent="editing = ''" />
          <button type="submit" class="studio-btn studio-btn--quiet studio-btn--sm">{{ t('common.save') }}</button>
        </form>
        <template v-else>
          <button type="button" class="chat-history-select" :aria-current="conversation.id === chatActiveId ? 'true' : undefined" @click="select(conversation.id)">
            <span class="chat-history-title">{{ conversation.title || t('studioChat.untitled') }}</span>
            <small>{{ t('studioChat.messageCount', { n: conversation.messages.length }) }} · {{ formatDate(conversation.updatedAt) }}</small>
            <span v-if="isChatRunning(conversation.id)" class="chat-running-badge"><span class="studio-dot studio-dot--ok" aria-hidden="true"></span>{{ t('studioChat.replying') }}</span>
          </button>
          <div class="chat-history-actions">
            <button type="button" class="studio-icon-btn" :aria-label="t('studioChat.rename')" :title="t('studioChat.rename')" @click="editing = conversation.id; title = conversation.title"><Icon name="edit" size="xs" /></button>
            <button type="button" class="studio-icon-btn chat-history-delete" :aria-label="t('studioChat.delete')" :title="t('studioChat.delete')" @click="remove(conversation.id)"><Icon name="trash" size="xs" /></button>
          </div>
        </template>
      </div>
      <p v-if="!filtered.length" class="studio-note p-3">{{ t('studioChat.noHistory') }}</p>
    </div>
    <div class="chat-history-summary">
      <div><span>{{ t('studioChat.totalMessages') }}</span><strong>{{ totalMessages }}</strong></div>
      <div><span>{{ t('canvasChat.statsSessions') }}</span><span>{{ sortedChats.length }}</span></div>
    </div>
    <p class="studio-note chat-history-note">{{ t('studioChat.localHistory') }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import { chatActiveId, chatReady, sortedChats, newChat, selectChat, deleteChat, renameChat, isChatRunning } from '@/composables/useStudioChat'
defineProps<{ closable?: boolean; closeLabel?: string; closeIcon?: 'x' | 'chevronLeft' }>()
const emit = defineEmits<{ close: []; navigate: [] }>()
const { t, locale } = useI18n()
const search = ref(''), editing = ref(''), title = ref('')
const filtered = computed(() => sortedChats.value.filter(row => row.title.toLowerCase().includes(search.value.trim().toLowerCase())))
const totalMessages = computed(() => sortedChats.value.reduce((total, chat) => total + chat.messages.length, 0))
function create() { newChat(); emit('navigate') }
function select(id: string) { selectChat(id); emit('navigate') }
async function remove(id: string) { if (window.confirm(t('studioChat.deleteConfirm'))) await deleteChat(id) }
async function rename(id: string) { await renameChat(id, title.value); editing.value = '' }
function formatDate(timestamp: number) { return new Intl.DateTimeFormat(locale.value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(timestamp) }
</script>
<style scoped>
.chat-history { display: flex; flex-direction: column; gap: 10px; width: 100%; height: 100%; min-height: 0; }
.chat-history-heading { display: flex; align-items: center; justify-content: space-between; min-height: 36px; color: var(--st-text); font-size: 15px; }
.chat-history-new { min-height: 40px; width: 100%; border-radius: 12px; font-size: 14px; font-weight: 600; box-shadow: var(--st-shadow-sm); }
.chat-history-search { flex-shrink: 0; min-height: 36px; }
.chat-history-list { flex: 1; min-height: 0; margin-inline: -4px; padding-inline: 4px; }
.chat-history-item { display: flex; position: relative; align-items: center; min-height: 56px; padding: 8px 10px; margin-bottom: 4px; border: 1px solid transparent; border-radius: 12px; transition: border-color .15s ease, background-color .15s ease; }
.chat-history-item.is-active { background: var(--st-surface); border-color: var(--st-border-strong); }
.chat-history-item:hover { background: var(--st-panel-soft); border-color: var(--st-border); }
.chat-history-select { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; width: 100%; text-align: left; }
.chat-history-title { width: 100%; padding-right: 48px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--st-text); font-size: 13px; font-weight: 600; }
.chat-history-select small { color: var(--st-muted); font-size: 10px; white-space: nowrap; }
.chat-running-badge { display: inline-flex; align-items: center; gap: 5px; width: fit-content; padding: 2px 7px; border-radius: 999px; background: var(--st-accent-soft); color: var(--st-accent-text); font-size: 11px; }
.chat-history-actions { display: flex; position: absolute; right: 8px; top: 8px; gap: 2px; }
.chat-history-actions .studio-icon-btn { width: 24px; height: 24px; border-radius: 6px; background: var(--st-panel); }
.chat-history-delete:hover { color: var(--st-danger); background: var(--st-danger-soft); }
.chat-history-rename { display: flex; flex-wrap: wrap; min-width: 0; width: 100%; gap: 4px; }
.chat-history-rename input { min-width: 0; width: 100%; }
.chat-history-summary { display: grid; gap: 5px; padding: 10px 12px; border: 1px solid var(--st-border); border-radius: 12px; background: var(--st-panel-soft); color: var(--st-text-soft); font-size: 11px; }
.chat-history-summary > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.chat-history-summary strong { color: var(--st-text); font-size: 16px; }
.chat-history-note { margin: 0; font-size: 10px; line-height: 1.5; }
.chat-history-select:focus-visible { outline: 2px solid var(--st-focus); outline-offset: 3px; border-radius: 4px; }
@media (hover: hover) and (min-width: 1024px) {
  .chat-history-actions { opacity: 0; pointer-events: none; }
  .chat-history-item:hover .chat-history-actions, .chat-history-item:focus-within .chat-history-actions { opacity: 1; pointer-events: auto; }
}
</style>
