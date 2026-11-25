<template>
  <section class="text-chat" :aria-label="t('canvas.tabConversation')">
    <aside v-if="!sidebarCollapsed" class="studio-panel text-chat-sidebar" :aria-label="t('studioChat.history')">
      <StudioChatHistory closable close-icon="chevronLeft" :close-label="t('studioChat.collapseHistory')" @close="sidebarCollapsed = true" />
    </aside>
    <Teleport to="body">
      <div v-if="historyOpen" class="studio-shell chat-history-overlay" @click.self="historyOpen = false">
        <aside ref="historyDialog" class="studio-panel chat-history-drawer" role="dialog" aria-modal="true" :aria-label="t('studioChat.history')" tabindex="-1"><StudioChatHistory closable @close="historyOpen = false" @navigate="historyOpen = false" /></aside>
      </div>
    </Teleport>
    <main class="studio-panel text-chat-main">
      <header class="text-chat-head">
        <div class="chat-head-identity">
          <button type="button" class="studio-icon-btn text-chat-history-toggle" :aria-label="t('studioChat.history')" :title="t('studioChat.history')" @click="historyOpen = true"><Icon name="menu" size="sm" /></button>
          <button v-if="sidebarCollapsed" type="button" class="studio-icon-btn text-chat-sidebar-toggle" :aria-label="t('studioChat.expandHistory')" :title="t('studioChat.expandHistory')" @click="sidebarCollapsed = false"><Icon name="chevronRight" size="sm" /></button>
          <div class="chat-head-text"><h1 :title="activeChat?.title || t('studioChat.untitled')">{{ activeChat?.title || t('studioChat.untitled') }}</h1><p role="status"><span class="studio-dot" :class="{ 'studio-dot--ok': chatReady && !chatActiveBusy && !chatOptionsError && !chatStorageError }" aria-hidden="true"></span>{{ t(chatActiveBusy ? 'studioChat.replying' : chatOptionsLoading ? 'studioChat.loadingModels' : chatReady ? 'studioChat.ready' : 'studioChat.loading') }}</p></div>
        </div>
        <button type="button" class="studio-btn studio-btn--ghost studio-btn--sm chat-new-button" :disabled="!chatReady" :aria-label="t('studioChat.newChat')" @click="newChat"><Icon name="plus" size="xs" /><span>{{ t('studioChat.newChat') }}</span></button>
      </header>
      <div v-if="chatOptionsError" role="alert" class="studio-alert text-chat-alert">{{ chatOptionsError }}<button type="button" class="underline" @click="refreshChatOptions">{{ t('common.retry') }}</button></div>
      <div v-if="chatStorageError" role="alert" class="studio-alert text-chat-alert"><span>{{ chatStorageError }}</span><button type="button" class="underline" :disabled="chatBusy" @click="retryChatSave">{{ t('studioChat.retrySave') }}</button><button type="button" class="underline" :disabled="chatBusy" @click="reloadHistory">{{ t('studioChat.reloadHistory') }}</button></div>
      <div v-if="backgroundChatId" class="text-chat-background" role="status"><span>{{ t('studioChat.backgroundReply') }}</span><button type="button" class="underline" @click="selectChat(backgroundChatId)">{{ t('studioChat.viewReply') }}</button></div>
      <div class="text-chat-thread">
        <div ref="scroller" class="studio-scroll text-chat-messages" role="log" :aria-label="t('studioChat.messages')" aria-live="polite" @scroll="trackScroll">
          <div v-if="!chatReady && !chatStorageError" class="studio-empty" role="status"><p class="studio-note">{{ t('studioChat.loading') }}</p></div>
          <div v-else-if="!activeChat?.messages.length" class="chat-welcome">
            <span class="studio-empty-mark" aria-hidden="true"><Icon name="chat" size="lg" /></span>
            <h2 class="studio-empty-title">{{ t('studioChat.welcome') }}</h2><p class="studio-empty-text">{{ t('studioChat.description') }}</p>
            <div v-if="!chatOptionsLoading && !chatKeys.length" class="chat-no-key"><p>{{ t('studioChat.noKeys') }}</p><RouterLink class="studio-btn studio-btn--primary" to="/keys">{{ t('studioChat.manageKeys') }}</RouterLink></div>
            <div v-else class="chat-examples">
              <div class="chat-example-heading"><span></span>{{ t('studioChat.tryExamples') }}<span></span></div>
              <ul><li v-for="key in ['brainstorm', 'write', 'explain'] as const" :key="key"><button type="button" @click="applyExample(key)"><Icon name="sparkles" size="xs" /><span>{{ t(`studioChat.examples.${key}.prompt`) }}</span><Icon name="arrowRight" size="xs" /></button></li></ul>
            </div>
          </div>
          <div v-else class="chat-message-list">
            <StudioChatMessageRow
              v-for="(message, index) in activeChat.messages"
              :key="message.id"
              :message="message"
              :last="index === activeChat.messages.length - 1"
              :retry-disabled="chatActiveBusy || !!chatStorageError"
              :copied="copied === message.id"
              :preview-visible="!!htmlPreview[message.id]"
              :preview-created="!!htmlPreviewCreated[message.id]"
              :zoomed="htmlZoomId === message.id"
              @copy="copy(message.id, message.content)"
              @toggle-preview="toggleHtmlPreview(message.id)"
              @toggle-zoom="toggleHtmlZoom(message.id, $event)"
              @exit-zoom="exitHtmlZoom"
              @frame="registerHtmlFrame(message.id, $event)"
              @retry="sendChat(true)"
            />
          </div>
        </div>
        <button v-if="!atBottom && activeChat?.messages.length" type="button" class="studio-icon-btn chat-latest" :aria-label="t('studioChat.latest')" :title="t('studioChat.latest')" @click="scrollToBottom"><Icon name="arrowDown" size="sm" /></button>
      </div>
      <div class="text-chat-composer">
        <div class="chat-composer-content">
          <div class="text-chat-options">
            <label class="chat-option"><span>{{ t('studioChat.apiKey') }}</span><select data-testid="chat-key" :aria-label="t('studioChat.apiKey')" :value="chatKeyId ?? ''" :disabled="chatOptionsLoading" @change="selectChatKey(Number(($event.target as HTMLSelectElement).value) || null)"><option v-if="!chatKeys.length" value="">{{ t('studioChat.chooseKey') }}</option><option v-for="key in chatKeys" :key="key.id" :value="key.id">{{ key.name }}</option></select></label>
            <label class="chat-option chat-model-option"><span>{{ t('studioChat.model') }}</span><select data-testid="chat-model" :aria-label="t('studioChat.model')" :value="chatModel" :disabled="chatOptionsLoading || !chatModels.length" @change="selectChatModel(($event.target as HTMLSelectElement).value)"><option v-if="!chatModels.length" value="">{{ t(chatOptionsLoading ? 'studioChat.loadingModels' : 'studioChat.noModels') }}</option><option v-for="model in chatModels" :key="model" :value="model">{{ model }}</option></select></label>
            <button type="button" class="studio-icon-btn chat-refresh" :disabled="chatOptionsLoading" :aria-label="t('studioChat.refresh')" :title="t('studioChat.refresh')" @click="refreshChatOptions"><Icon name="refresh" size="xs" /></button>
          </div>
          <form class="chat-input-box" @submit.prevent="sendChat()">
            <textarea ref="input" v-model="draft" rows="1" maxlength="32000" data-testid="chat-input" :aria-label="t('studioChat.input')" :placeholder="t('studioChat.placeholder')" :disabled="!chatReady" @blur="saveChatDraft" @keydown="onKeydown"></textarea>
            <div class="chat-composer-bottom"><span>{{ t('studioChat.shortcut') }}</span><button v-if="chatActiveBusy" type="button" class="chat-submit is-stop" data-testid="chat-stop" :aria-label="t('studioChat.stop')" :title="t('studioChat.stop')" @click="stopChat()"><span class="chat-stop-icon" aria-hidden="true"></span></button><button v-else type="submit" class="chat-submit" data-testid="chat-send" :aria-label="t('studioChat.send')" :title="t('studioChat.send')" :disabled="!canSend"><Icon name="arrowUp" size="md" /></button></div>
          </form>
          <p class="chat-composer-note">{{ t('studioChat.billingNote') }}</p>
        </div>
      </div>
    </main>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import Icon from '@/components/icons/Icon.vue'
import StudioChatHistory from './StudioChatHistory.vue'
import StudioChatMessageRow from './StudioChatMessageRow.vue'
import { useAppStore } from '@/stores/app'
import { useStudioDialog } from '@/composables/useStudioDialog'
import { activeChat, chatActiveBusy, chatActiveId, chatBusy, chatKeyId, chatKeys, chatModel, chatModels, chatOptionsError, chatOptionsLoading, chatReady, chatRunningIds, chatStorageError, initStudioChat, newChat, refreshChatOptions, reloadChatHistory, retryChatSave, saveChatDraft, selectChat, selectChatKey, selectChatModel, sendChat, stopChat } from '@/composables/useStudioChat'
import './studio-shell.css'
const { t } = useI18n(), app = useAppStore()
const scroller = ref<HTMLElement>(), input = ref<HTMLTextAreaElement>(), atBottom = ref(true), historyOpen = ref(false), historyDialog = ref<HTMLElement>(), copied = ref('')
const htmlPreview = ref<Record<string, boolean>>({})
const htmlPreviewCreated = ref<Record<string, boolean>>({})
/** 放大预览的消息 id;放大只改样式,iframe 不重建,sandbox/srcdoc 保持不变 */
const htmlZoomId = ref('')
const sidebarCollapsed = ref(false)
let zoomOrigin: HTMLElement | null = null
const htmlFrames = new Map<string, HTMLElement>()
const zoomDialog = computed(() => htmlZoomId.value ? htmlFrames.get(htmlZoomId.value) : undefined)
useStudioDialog(zoomDialog, exitHtmlZoom, computed(() => Boolean(htmlZoomId.value)))
useStudioDialog(historyDialog, () => { historyOpen.value = false }, historyOpen)
const draft = computed({ get: () => activeChat.value?.draft || '', set: value => { if (activeChat.value) activeChat.value.draft = value } })
const backgroundChatId = computed(() => chatRunningIds.value.find(id => id !== chatActiveId.value) || '')
const canSend = computed(() => chatReady.value && !chatActiveBusy.value && !chatOptionsLoading.value && !chatStorageError.value && !!chatKeyId.value && chatModels.value.includes(chatModel.value) && !!draft.value.trim())
function toggleHtmlPreview(messageId: string) {
  htmlPreviewCreated.value[messageId] = true
  htmlPreview.value[messageId] = !htmlPreview.value[messageId]
  // 隐藏预览回到代码视图前先退出放大,避免遗留覆盖层
  if (!htmlPreview.value[messageId] && htmlZoomId.value === messageId) exitHtmlZoom()
}
function registerHtmlFrame(messageId: string, element: unknown) {
  if (element instanceof HTMLElement) htmlFrames.set(messageId, element)
  else htmlFrames.delete(messageId)
}
function toggleHtmlZoom(messageId: string, event?: Event) {
  if (htmlZoomId.value === messageId) { exitHtmlZoom(); return }
  zoomOrigin = (event?.currentTarget as HTMLElement) ?? null
  htmlZoomId.value = messageId
  // 把焦点交给覆盖层里的退出按钮,键盘用户不必穿过 iframe
  void nextTick(() => document.querySelector<HTMLElement>('.chat-html-frame.is-zoomed .chat-html-exit')?.focus())
}
function exitHtmlZoom() {
  if (!htmlZoomId.value) return
  htmlZoomId.value = ''
  const origin = zoomOrigin
  zoomOrigin = null
  void nextTick(() => origin?.focus())
}
function trackScroll() { const element = scroller.value; if (element) atBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 90 }
function scrollToBottom() { if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight; atBottom.value = true }
watch(() => [chatActiveId.value, activeChat.value?.messages.length], async () => { await nextTick(); scrollToBottom() }, { flush: 'post', immediate: true })
watch([
  () => activeChat.value?.messages.at(-1)?.content,
  () => activeChat.value?.messages.at(-1)?.status
], async () => {
  if (atBottom.value) { await nextTick(); scrollToBottom() }
}, { flush: 'post' })
function onKeydown(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (canSend.value) void sendChat() } }
function applyExample(key: 'brainstorm' | 'write' | 'explain') { draft.value = t(`studioChat.examples.${key}.prompt`); input.value?.focus() }
async function reloadHistory() { if (!window.confirm(t('studioChat.reloadConfirm'))) return; await reloadChatHistory() }
async function copy(id: string, text: string) {
  let element: HTMLTextAreaElement | undefined
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
    else { element = document.createElement('textarea'); element.value = text; element.style.position = 'fixed'; element.style.opacity = '0'; document.body.append(element); element.select(); if (!document.execCommand('copy')) throw new Error('Copy failed') }
    copied.value = id
  } catch { app.showError(t('common.copyFailed')) }
  finally { element?.remove() }
}
// 切换对话时退出放大,避免覆盖层停留在另一段对话上
watch(chatActiveId, () => { if (htmlZoomId.value) { htmlZoomId.value = ''; zoomOrigin = null } })
function autoGrow() {
  const element = input.value
  if (!element) return
  element.style.height = 'auto'
  const maxHeight = parseFloat(getComputedStyle(element).maxHeight) || 136
  element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`
  element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden'
}
watch([draft, chatActiveId], () => { void nextTick(autoGrow) }, { flush: 'post' })
let messageResize: ResizeObserver | undefined
onMounted(() => {
  void initStudioChat()
  void nextTick(autoGrow)
  messageResize = new ResizeObserver(() => { if (atBottom.value) scrollToBottom() })
  if (scroller.value) messageResize.observe(scroller.value)
})
onUnmounted(() => messageResize?.disconnect())
</script>
<style scoped>
.text-chat { display: flex; gap: 12px; height: 100%; min-height: 0; min-width: 0; }
.text-chat-sidebar { display: flex; width: 248px; flex-shrink: 0; min-height: 0; overflow: hidden; padding: 12px; }
.text-chat-main { position: relative; display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.text-chat-head { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 12px; min-height: 58px; padding: 10px 14px; border-bottom: 1px solid var(--st-border); }
.chat-head-identity { display: flex; align-items: center; gap: 8px; min-width: 0; }
.chat-head-text { min-width: 0; }
.chat-head-text h1 { margin: 0; max-width: min(32rem, 48vw); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 700; color: var(--st-text); }
.chat-head-text p { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 12px; line-height: 16px; color: var(--st-muted); }
.chat-new-button { flex-shrink: 0; }
.text-chat-history-toggle { display: none; }
.text-chat-sidebar-toggle { display: inline-grid; }
.text-chat-alert { margin: 8px 14px 0; flex-shrink: 0; }
.text-chat-background { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; padding: 8px; font-size: 12px; background: var(--st-accent-soft); color: var(--st-accent-text); }
.text-chat-thread { display: flex; position: relative; flex: 1; min-height: 0; }
.text-chat-messages { width: 100%; min-height: 0; padding: 16px 24px 24px; scroll-behavior: auto; }
.chat-welcome { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 46vh; padding: 32px 8px; text-align: center; }
.chat-welcome h2 { font-size: clamp(1.25rem, 3.2vw, 1.65rem); }
.chat-examples { width: 100%; max-width: 576px; margin-top: 28px; }
.chat-example-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 11px; font-weight: 600; color: var(--st-muted); }
.chat-example-heading > span { height: 1px; flex: 1; background: var(--st-border); }
.chat-examples ul { display: grid; list-style: none; gap: 8px; margin: 0; padding: 0; }
.chat-examples button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: 1px solid var(--st-border); border-radius: 12px; background: var(--st-panel); color: var(--st-text-soft); font-size: 12.5px; line-height: 1.6; text-align: left; }
.chat-examples button:hover { border-color: var(--st-accent-border); color: var(--st-text); }
.chat-examples button > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.chat-examples button > svg { flex-shrink: 0; color: var(--st-accent); }
.chat-no-key { margin-top: 20px; display: grid; gap: 12px; justify-items: center; color: var(--st-text-soft); font-size: 13px; }
.chat-message-list { display: flex; flex-direction: column; gap: 20px; max-width: 832px; margin: 0 auto; }
.text-chat-composer { position: relative; flex-shrink: 0; padding: 4px 16px 12px; }
.text-chat-composer::before { content: ''; pointer-events: none; position: absolute; inset: -24px 0 auto; height: 24px; background: linear-gradient(to top, var(--st-panel), transparent); }
.chat-composer-content { max-width: 768px; margin-inline: auto; }
.text-chat-options { display: flex; align-items: center; gap: 8px; margin: 0 4px 8px; }
.chat-option { display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 44%; height: 32px; padding: 0 10px; border: 1px solid var(--st-border); border-radius: 999px; background: var(--st-panel); box-shadow: var(--st-shadow-sm); }
.chat-option > span { flex-shrink: 0; color: var(--st-muted); font-size: 10px; }
.chat-option select { min-width: 0; max-width: 100%; border: 0; outline: 0; background: transparent; color: var(--st-text-soft); text-overflow: ellipsis; font-size: 12px; }
.chat-option:focus-within { outline: 2px solid var(--st-focus); outline-offset: 2px; }
.chat-model-option { flex: 1; }
.chat-refresh { width: 32px; height: 32px; flex-shrink: 0; border: 1px solid var(--st-border); border-radius: 50%; background: var(--st-panel); }
.chat-input-box { padding: 12px; border: 1px solid var(--st-border); border-radius: 24px; background: var(--st-panel); box-shadow: 0 10px 28px -16px #10182840; }
.chat-input-box:focus-within { border-color: var(--st-accent); }
.chat-input-box textarea { display: block; resize: none; width: 100%; min-height: 44px; max-height: 136px; padding: 4px 6px; border: 0; outline: 0; background: transparent; color: var(--st-text); font-size: 15px; line-height: 1.5; }
.chat-composer-bottom { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
.chat-composer-bottom > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--st-muted); font-size: 11px; padding: 0 6px 10px; }
.chat-submit { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; background: var(--st-accent); color: var(--st-accent-on); transition: background-color .15s ease; }
.chat-submit:hover:enabled { background: var(--st-accent-hover); }
.chat-submit:disabled { cursor: not-allowed; border: 1px solid var(--st-border); background: var(--st-surface); color: var(--st-muted); }
.chat-submit.is-stop { border: 1px solid var(--st-danger-border); background: var(--st-danger-soft); color: var(--st-danger); }
.chat-stop-icon { width: 14px; height: 14px; border-radius: 3px; background: currentColor; }
.chat-composer-note { margin: 8px 0 0; text-align: center; color: var(--st-muted); font-size: 10px; line-height: 1.5; }
.chat-latest { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 5; width: 40px; height: 40px; border: 1px solid var(--st-border); border-radius: 50%; background: var(--st-panel); box-shadow: var(--st-shadow); }
.chat-history-overlay { position: fixed; inset: 0; z-index: 260; padding: 12px; background: #0f172a80; }
.chat-history-drawer { height: 100%; max-height: calc(100dvh - 24px); width: min(352px, 88vw); display: flex; flex-direction: column; padding: 12px; box-shadow: var(--st-shadow-lg); }
.chat-examples button:focus-visible, .chat-submit:focus-visible { outline: 2px solid var(--st-focus); outline-offset: 2px; }
@media (max-width: 1023px) {
  .text-chat-sidebar, .text-chat-sidebar-toggle { display: none; }
  .text-chat-history-toggle { display: inline-grid; }
  .text-chat-messages { padding: 16px 12px 24px; }
}
@media (max-width: 639px) {
  .text-chat-head { padding: 10px 12px; }
  .chat-new-button > span { display: none; }
  .text-chat-composer { padding: 4px 12px 12px; }
  .chat-option { max-width: 42%; padding-inline: 8px; }
  .chat-option > span { display: none; }
  .chat-model-option { max-width: none; }
  .chat-input-box textarea { font-size: 16px; }
  .chat-composer-bottom > span { font-size: 10px; }
}
@media (max-height: 700px) { .chat-composer-note { display: none; } }

</style>
