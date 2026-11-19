<template>
  <section class="studio-panel text-chat" :aria-label="t('canvas.tabConversation')">
    <aside class="text-chat-sidebar"><StudioChatHistory /></aside>
    <div v-if="historyOpen" class="studio-shell chat-history-overlay" @click.self="historyOpen = false">
      <aside ref="historyDialog" class="chat-history-drawer" role="dialog" aria-modal="true" :aria-label="t('studioChat.history')" tabindex="-1"><StudioChatHistory closable @close="historyOpen = false" /></aside>
    </div>
    <main class="text-chat-main">
      <header class="studio-panel-head text-chat-head">
        <div class="studio-panel-title">
          <button type="button" class="studio-icon-btn text-chat-history-toggle" :aria-label="t('studioChat.history')" @click="historyOpen = true"><Icon name="menu" size="sm" /></button>
          <span class="studio-title-mark text-chat-desktop-mark" aria-hidden="true"><Icon name="chat" size="sm" /></span>
          <div class="min-w-0"><h1 class="studio-heading">{{ t('canvas.tabConversation') }}</h1><p class="studio-subheading">{{ t('studioChat.subtitle') }}</p></div>
        </div>
        <button type="button" class="studio-btn studio-btn--ghost studio-btn--sm ml-auto" :disabled="!chatReady" @click="newChat"><Icon name="plus" size="xs" />{{ t('studioChat.newChat') }}</button>
      </header>
      <div v-if="chatOptionsError" role="alert" class="studio-alert text-chat-alert">{{ chatOptionsError }}<button type="button" class="underline" @click="refreshChatOptions">{{ t('common.retry') }}</button></div>
      <div v-if="chatStorageError" role="alert" class="studio-alert text-chat-alert"><span>{{ chatStorageError }}</span><button type="button" class="underline" :disabled="chatBusy" @click="retryChatSave">{{ t('studioChat.retrySave') }}</button><button type="button" class="underline" :disabled="chatBusy" @click="reloadHistory">{{ t('studioChat.reloadHistory') }}</button></div>
      <div v-if="backgroundChatId" class="text-chat-background" role="status"><span>{{ t('studioChat.backgroundReply') }}</span><button type="button" class="underline" @click="selectChat(backgroundChatId)">{{ t('studioChat.viewReply') }}</button></div>
      <div ref="scroller" class="studio-scroll text-chat-messages" role="log" :aria-label="t('studioChat.messages')" aria-live="polite" @scroll="trackScroll">
        <div v-if="!chatReady && !chatStorageError" class="studio-empty" role="status"><p class="studio-note">{{ t('studioChat.loading') }}</p></div>
        <div v-else-if="!activeChat?.messages.length" class="studio-empty chat-welcome">
          <span class="studio-empty-mark" aria-hidden="true"><Icon name="chat" size="lg" /></span>
          <h2 class="studio-empty-title">{{ t('studioChat.welcome') }}</h2><p class="studio-empty-text">{{ t('studioChat.description') }}</p>
          <div v-if="!chatOptionsLoading && !chatKeys.length" class="chat-no-key"><p>{{ t('studioChat.noKeys') }}</p><RouterLink class="studio-btn studio-btn--primary" to="/keys">{{ t('studioChat.manageKeys') }}</RouterLink></div>
          <div v-else class="chat-examples"><button v-for="key in ['brainstorm', 'write', 'explain'] as const" :key="key" type="button" class="studio-btn studio-btn--ghost" @click="applyExample(key)"><Icon name="sparkles" size="xs" />{{ t(`studioChat.examples.${key}.title`) }}<Icon name="arrowRight" size="xs" /></button></div>
        </div>
        <div v-else class="chat-message-list">
          <article v-for="(message, index) in activeChat.messages" :key="message.id" class="chat-message" :class="`is-${message.role}`" :data-testid="`chat-${message.role}-message`">
            <div class="chat-message-heading"><span class="chat-avatar" aria-hidden="true"><Icon :name="message.role === 'user' ? 'user' : 'sparkles'" size="xs" /></span><strong>{{ message.role === 'user' ? t('studioChat.you') : message.model || t('studioChat.assistant') }}</strong><span v-if="message.status === 'streaming'" class="chat-stream-dot" :aria-label="t('studioChat.replying')"></span></div>
            <div v-if="message.role === 'assistant' && message.content" v-show="!htmlPreview[message.id]" class="chat-markdown" v-html="renderMarkdown(message.content)"></div>
            <p v-else-if="message.content" class="chat-user-text">{{ message.content }}</p>
            <p v-else-if="message.status === 'streaming'" class="studio-note">{{ t('studioChat.thinking') }}</p>
            <p v-if="message.status === 'stopped'" class="chat-message-note">{{ t('studioChat.stopped') }}</p>
            <p v-if="message.status === 'failed'" class="chat-message-error" role="alert">{{ message.error || t('studioChat.requestFailed') }}</p>
            <div v-if="message.content || message.status === 'failed' || message.status === 'stopped'" class="chat-message-actions">
              <button v-if="message.content" type="button" class="studio-btn studio-btn--quiet studio-btn--sm" :aria-label="t('studioChat.copy')" @click="copy(message.content)"><Icon name="copy" size="xs" />{{ copied === message.content ? t('studioChat.copied') : t('studioChat.copy') }}</button>
              <button v-if="message.role === 'assistant' && extractStudioChatHtml(message.content)" type="button" class="studio-btn studio-btn--quiet studio-btn--sm" :aria-pressed="htmlPreview[message.id] === true" @click="toggleHtmlPreview(message.id)"><Icon name="eye" size="xs" />{{ htmlPreview[message.id] ? t('studioChat.showHtmlCode') : t('studioChat.previewHtml') }}</button>
              <button v-if="message.role === 'assistant' && ['failed', 'stopped'].includes(message.status) && index === activeChat.messages.length - 1" type="button" class="studio-btn studio-btn--ghost studio-btn--sm" :title="t('studioChat.retryHint')" :disabled="chatActiveBusy || !!chatStorageError" @click="sendChat(true)"><Icon name="refresh" size="xs" />{{ t('studioChat.retryReply') }}</button>
            </div>
            <iframe v-if="htmlPreviewCreated[message.id]" v-show="message.role === 'assistant' && htmlPreview[message.id] && extractStudioChatHtml(message.content)" class="chat-html-preview" :srcdoc="studioChatHtmlDocument(message.content)" :title="t('studioChat.htmlPreview')" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
          </article>
        </div>
      </div>
      <button v-if="!atBottom && activeChat?.messages.length" type="button" class="studio-btn studio-btn--ghost chat-latest" @click="scrollToBottom">{{ t('studioChat.latest') }}<Icon name="arrowDown" size="xs" /></button>
      <div class="text-chat-options">
        <label class="studio-label"><span>{{ t('studioChat.apiKey') }}</span><select class="studio-input--boxed" data-testid="chat-key" :value="chatKeyId ?? ''" :disabled="chatOptionsLoading" @change="selectChatKey(Number(($event.target as HTMLSelectElement).value) || null)"><option v-if="!chatKeys.length" value="">{{ t('studioChat.chooseKey') }}</option><option v-for="key in chatKeys" :key="key.id" :value="key.id">{{ key.name }}</option></select></label>
        <label class="studio-label"><span>{{ t('studioChat.model') }}</span><select class="studio-input--boxed" data-testid="chat-model" :value="chatModel" :disabled="chatOptionsLoading || !chatModels.length" @change="selectChatModel(($event.target as HTMLSelectElement).value)"><option v-if="!chatModels.length" value="">{{ t(chatOptionsLoading ? 'studioChat.loadingModels' : 'studioChat.noModels') }}</option><option v-for="model in chatModels" :key="model" :value="model">{{ model }}</option></select></label>
        <button type="button" class="studio-icon-btn" :disabled="chatOptionsLoading" :aria-label="t('studioChat.refresh')" @click="refreshChatOptions"><Icon name="refresh" size="sm" /></button>
      </div>
      <form class="text-chat-composer" @submit.prevent="sendChat()">
        <div class="chat-input-box"><textarea ref="input" v-model="draft" rows="3" maxlength="32000" data-testid="chat-input" :aria-label="t('studioChat.input')" :placeholder="t('studioChat.placeholder')" :disabled="!chatReady" @blur="saveChatDraft" @keydown="onKeydown"></textarea>
          <div class="chat-composer-bottom"><span>{{ t('studioChat.shortcut') }}</span><button v-if="chatActiveBusy" type="button" class="studio-btn studio-btn--ghost" data-testid="chat-stop" @click="stopChat()"><span class="chat-stop-icon" aria-hidden="true"></span>{{ t('studioChat.stop') }}</button><button v-else type="submit" class="studio-btn studio-btn--primary" data-testid="chat-send" :disabled="!canSend"><Icon name="arrowUp" size="sm" />{{ t('studioChat.send') }}</button></div>
        </div>
        <p class="chat-composer-note">{{ t('studioChat.billingNote') }}</p>
      </form>
    </main>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import Icon from '@/components/icons/Icon.vue'
import StudioChatHistory from './StudioChatHistory.vue'
import { extractStudioChatHtml, studioChatHtmlDocument } from './studioChatHtml'
import { useAppStore } from '@/stores/app'
import { useStudioDialog } from '@/composables/useStudioDialog'
import { activeChat, chatActiveBusy, chatActiveId, chatBusy, chatKeyId, chatKeys, chatModel, chatModels, chatOptionsError, chatOptionsLoading, chatReady, chatRunningIds, chatStorageError, initStudioChat, newChat, refreshChatOptions, reloadChatHistory, retryChatSave, saveChatDraft, selectChat, selectChatKey, selectChatModel, sendChat, stopChat } from '@/composables/useStudioChat'
import './studio-shell.css'
const { t } = useI18n(), app = useAppStore()
const scroller = ref<HTMLElement>(), input = ref<HTMLTextAreaElement>(), atBottom = ref(true), historyOpen = ref(false), historyDialog = ref<HTMLElement>(), copied = ref('')
const htmlPreview = ref<Record<string, boolean>>({})
const htmlPreviewCreated = ref<Record<string, boolean>>({})
useStudioDialog(historyDialog, () => { historyOpen.value = false }, historyOpen)
const draft = computed({ get: () => activeChat.value?.draft || '', set: value => { if (activeChat.value) activeChat.value.draft = value } })
const backgroundChatId = computed(() => chatRunningIds.value.find(id => id !== chatActiveId.value) || '')
const canSend = computed(() => chatReady.value && !chatActiveBusy.value && !chatOptionsLoading.value && !chatStorageError.value && !!chatKeyId.value && chatModels.value.includes(chatModel.value) && !!draft.value.trim())
function renderMarkdown(text: string) {
  return DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: true }), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'a', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title', 'class'], ALLOW_DATA_ATTR: false
  })
}
function toggleHtmlPreview(messageId: string) {
  htmlPreviewCreated.value[messageId] = true
  htmlPreview.value[messageId] = !htmlPreview.value[messageId]
}
function trackScroll() { const element = scroller.value; if (element) atBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 90 }
function scrollToBottom() { if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight; atBottom.value = true }
watch(() => [chatActiveId.value, activeChat.value?.messages.length], async () => { await nextTick(); scrollToBottom() }, { flush: 'post', immediate: true })
watch(() => activeChat.value?.messages.at(-1)?.content, async () => { if (atBottom.value) { await nextTick(); scrollToBottom() } }, { flush: 'post' })
function onKeydown(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (canSend.value) void sendChat() } }
function applyExample(key: 'brainstorm' | 'write' | 'explain') { draft.value = t(`studioChat.examples.${key}.prompt`); input.value?.focus() }
async function reloadHistory() { if (!window.confirm(t('studioChat.reloadConfirm'))) return; await reloadChatHistory() }
async function copy(text: string) {
  let element: HTMLTextAreaElement | undefined
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
    else { element = document.createElement('textarea'); element.value = text; element.style.position = 'fixed'; element.style.opacity = '0'; document.body.append(element); element.select(); if (!document.execCommand('copy')) throw new Error('Copy failed') }
    copied.value = text
  } catch { app.showError(t('common.copyFailed')) }
  finally { element?.remove() }
}
onMounted(() => { void initStudioChat() })
</script>
<style scoped>
.text-chat { display: flex; position: relative; height: 100%; min-height: 0; overflow: hidden; }
.text-chat-sidebar { width: 250px; flex-shrink: 0; padding: 16px 12px; border-right: 1px solid var(--st-border); background: var(--st-panel-soft); }
.text-chat-main { position: relative; display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
.text-chat-head { flex-shrink: 0; }
.text-chat-history-toggle { display: none; }
.text-chat-options { display: flex; align-items: flex-end; justify-content: center; gap: 10px; padding: 12px 24px 0; flex-shrink: 0; border-top: 1px solid var(--st-border); background: var(--st-panel); }
.text-chat-options label { flex: 1; min-width: 0; max-width: 320px; }
.text-chat-options select { width: 100%; font-size: 12px; min-width: 0; text-overflow: ellipsis; }
.text-chat-alert { margin: 8px 16px 0; flex-shrink: 0; }
.text-chat-background { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; padding: 8px; font-size: 12px; background: var(--st-accent-soft); color: var(--st-accent-text); }
.text-chat-messages { flex: 1; min-height: 0; padding: 24px; scroll-behavior: auto; }
.chat-welcome { min-height: 100%; padding-block: 24px; }
.chat-examples { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 24px; }
.chat-no-key { margin-top: 20px; display: grid; gap: 12px; justify-items: center; color: var(--st-text-soft); font-size: 13px; }
.chat-message-list { display: flex; flex-direction: column; gap: 24px; max-width: 780px; margin: 0 auto; }
.chat-message { min-width: 0; }
.chat-message-heading { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; color: var(--st-text-soft); font-size: 12px; }
.chat-avatar { display: grid; place-items: center; width: 27px; height: 27px; border-radius: 9px; background: var(--st-accent-soft); color: var(--st-accent-text); }
.chat-message.is-user { margin-left: auto; max-width: 88%; }
.chat-message.is-user .chat-message-heading { justify-content: flex-end; }
.chat-user-text { padding: 12px 16px; border-radius: 16px 4px 16px 16px; background: var(--st-accent-soft); color: var(--st-text); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.8; }
.chat-message-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.chat-message.is-user .chat-message-actions { justify-content: flex-end; }
.chat-message-note, .chat-message-error { margin-top: 10px; font-size: 12px; overflow-wrap: anywhere; }
.chat-message-note { color: var(--st-muted); }
.chat-message-error { color: var(--st-danger); }
.chat-stream-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--st-accent); animation: pulse 1s infinite; }
.chat-stop-icon { width: 10px; height: 10px; border-radius: 2px; background: currentColor; }
.text-chat-composer { flex-shrink: 0; padding: 10px 24px 14px; background: var(--st-panel); }
.chat-input-box { max-width: 800px; margin-inline: auto; padding: 12px; border: 1px solid var(--st-border-strong); border-radius: 16px; background: var(--st-panel-soft); box-shadow: var(--st-shadow-sm); }
.chat-input-box:focus-within { border-color: var(--st-accent); }
.chat-input-box textarea { display: block; resize: none; width: 100%; min-height: 60px; max-height: 150px; border: 0; outline: 0; background: transparent; color: var(--st-text); font-size: 14px; line-height: 1.7; }
.chat-composer-bottom { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
.chat-composer-bottom > span { color: var(--st-muted); font-size: 11px; }
.chat-composer-note { margin: 8px 0 0; text-align: center; color: var(--st-muted); font-size: 10px; line-height: 1.5; }
.chat-latest { position: absolute; bottom: 210px; left: 50%; transform: translateX(-50%); z-index: 5; background: var(--st-panel); box-shadow: var(--st-shadow); }
.chat-history-overlay { position: absolute; inset: 0; z-index: 80; background: #02061780; }
.chat-history-drawer { height: 100%; width: min(310px, 88%); padding: 16px; background: var(--st-panel); box-shadow: var(--st-shadow-lg); }
.chat-markdown { font-size: 14px; line-height: 1.85; color: var(--st-text); overflow-wrap: anywhere; }
.chat-markdown :deep(p), .chat-markdown :deep(ul), .chat-markdown :deep(ol), .chat-markdown :deep(blockquote) { margin: 0 0 12px; }
.chat-markdown :deep(ul), .chat-markdown :deep(ol) { padding-left: 22px; list-style: revert; }
.chat-markdown :deep(pre) { max-width: 100%; overflow: auto; padding: 14px; margin: 12px 0; background: var(--st-surface); border: 1px solid var(--st-border); border-radius: 12px; white-space: pre; font-size: 12px; }
.chat-markdown :deep(code) { padding: 2px 4px; background: var(--st-surface); border-radius: 4px; font-size: .9em; }
.chat-markdown :deep(pre code) { padding: 0; }
.chat-markdown :deep(a) { color: var(--st-accent-text); text-decoration: underline; }
.chat-markdown :deep(blockquote) { border-left: 3px solid var(--st-accent-border); padding-left: 12px; color: var(--st-text-soft); }
.chat-markdown :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin-bottom: 12px; }
.chat-markdown :deep(td), .chat-markdown :deep(th) { border: 1px solid var(--st-border); padding: 6px 10px; }
.chat-markdown :deep(h1), .chat-markdown :deep(h2), .chat-markdown :deep(h3) { font-weight: 700; margin: 16px 0 8px; }
.chat-html-preview { display: block; width: 100%; min-height: 360px; margin-top: 12px; border: 1px solid var(--st-border); border-radius: 12px; background: #fff; }
@keyframes pulse { 50% { opacity: .25; } }
@media (max-width: 1023px) {
  .text-chat-sidebar, .text-chat-desktop-mark { display: none; }
  .text-chat-history-toggle { display: inline-grid; }
  .text-chat-options { padding: 10px 12px; gap: 8px; }
  .text-chat-messages { padding: 16px 12px; }
  .text-chat-composer { padding: 8px 10px; }
  .chat-composer-bottom > span { max-width: 130px; }
  .chat-input-box textarea { font-size: 16px; min-height: 50px; }
}
@media (max-height: 700px) { .chat-composer-note { display: none; } .chat-input-box textarea { min-height: 40px; height: 48px; } }
@media (prefers-reduced-motion: reduce) { .chat-stream-dot { animation: none; } .text-chat-messages { scroll-behavior: auto; } }
</style>
