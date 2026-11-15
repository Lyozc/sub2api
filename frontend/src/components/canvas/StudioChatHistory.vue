<template>
  <div class="chat-history">
    <div class="chat-history-heading">
      <strong>{{ t('studioChat.history') }}</strong>
      <button v-if="closable" type="button" class="studio-icon-btn" :aria-label="t('common.close')" @click="$emit('close')"><Icon name="x" size="sm" /></button>
    </div>
    <button type="button" class="studio-btn studio-btn--primary" :disabled="!chatReady" @click="create"><Icon name="plus" size="sm" />{{ t('studioChat.newChat') }}</button>
    <label class="studio-field"><Icon name="search" size="xs" /><input v-model="search" :placeholder="t('studioChat.search')" :aria-label="t('studioChat.search')" /></label>
    <div class="studio-scroll chat-history-list" role="list">
      <div v-for="conversation in filtered" :key="conversation.id" class="chat-history-item" :class="{ 'is-active': conversation.id === chatActiveId }" role="listitem">
        <form v-if="editing === conversation.id" @submit.prevent="rename(conversation.id)">
          <input v-model="title" class="studio-input--boxed" :aria-label="t('studioChat.rename')" maxlength="80" @keydown.esc.prevent="editing = ''" />
          <button type="submit" class="studio-btn studio-btn--quiet studio-btn--sm">{{ t('common.save') }}</button>
        </form>
        <template v-else>
          <button type="button" class="chat-history-select" :aria-current="conversation.id === chatActiveId ? 'true' : undefined" @click="select(conversation.id)">
            <span>{{ conversation.title || t('studioChat.untitled') }}</span>
            <small>{{ conversation.id === chatRunningId ? t('studioChat.replying') : formatDate(conversation.updatedAt) }}</small>
          </button>
          <div class="chat-history-actions">
            <button type="button" class="studio-icon-btn" :aria-label="t('studioChat.rename')" @click="editing = conversation.id; title = conversation.title"><Icon name="edit" size="xs" /></button>
            <button type="button" class="studio-icon-btn" :aria-label="t('studioChat.delete')" @click="remove(conversation.id)"><Icon name="trash" size="xs" /></button>
          </div>
        </template>
      </div>
      <p v-if="!filtered.length" class="studio-note p-3">{{ t('studioChat.noHistory') }}</p>
    </div>
    <p class="studio-note chat-history-note">{{ t('studioChat.localHistory') }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import { chatActiveId, chatReady, chatRunningId, sortedChats, newChat, selectChat, deleteChat, renameChat } from '@/composables/useStudioChat'
defineProps<{ closable?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { t, locale } = useI18n()
const search = ref(''), editing = ref(''), title = ref('')
const filtered = computed(() => sortedChats.value.filter(row => row.title.toLowerCase().includes(search.value.trim().toLowerCase())))
function create() { newChat(); emit('close') }
function select(id: string) { selectChat(id); emit('close') }
async function remove(id: string) { if (window.confirm(t('studioChat.deleteConfirm'))) await deleteChat(id) }
async function rename(id: string) { await renameChat(id, title.value); editing.value = '' }
function formatDate(timestamp: number) { return new Intl.DateTimeFormat(locale.value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(timestamp) }
</script>
<style scoped>
.chat-history { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; }
.chat-history-heading { display: flex; align-items: center; justify-content: space-between; min-height: 32px; font-size: 14px; }
.chat-history-list { flex: 1; min-height: 0; }
.chat-history-item { padding: 10px; margin-bottom: 6px; border: 1px solid transparent; border-radius: 12px; }
.chat-history-item.is-active { background: var(--st-accent-soft); border-color: var(--st-accent-border); }
.chat-history-item:hover { border-color: var(--st-border-strong); }
.chat-history-select { display: flex; flex-direction: column; gap: 6px; width: 100%; text-align: left; }
.chat-history-select span { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.chat-history-select small { color: var(--st-muted); font-size: 11px; }
.chat-history-actions { display: flex; justify-content: flex-end; margin-top: 4px; gap: 4px; }
.chat-history-actions .studio-icon-btn { width: 26px; height: 26px; }
.chat-history-note { padding-top: 12px; border-top: 1px solid var(--st-border); font-size: 11px; }
</style>
