<template>
  <article class="chat-message" :class="`is-${message.role}`" :data-testid="`chat-${message.role}-message`">
    <div class="chat-message-heading">
      <span class="chat-avatar" aria-hidden="true"><Icon :name="assistant ? 'sparkles' : 'user'" size="xs" /></span>
      <strong>{{ assistant ? message.model || t('studioChat.assistant') : t('studioChat.you') }}</strong>
      <span v-if="streaming" class="chat-stream-dot" :aria-label="t('studioChat.replying')"></span>
    </div>

    <div v-if="assistant && message.content && streaming" class="chat-markdown chat-live-text">{{ message.content }}</div>
    <div v-else-if="assistant && message.content" v-show="!previewVisible" class="chat-markdown" v-html="markdown"></div>
    <p v-else-if="message.content" class="chat-user-text">{{ message.content }}</p>
    <p v-else-if="waiting" class="studio-note">
      {{ t('studioChat.thinking') }}
      <span role="timer" aria-live="off">{{ t('studioChat.waitingElapsed', { seconds: elapsedSeconds }) }}</span>
    </p>

    <p v-if="message.status === 'stopped'" class="chat-message-note">{{ t('studioChat.stopped') }}</p>
    <template v-if="message.status === 'failed'">
      <p class="chat-message-error" role="alert">
        <template v-if="http2Interrupted">
          {{ t(message.content ? 'studioChat.http2InterruptedPartial' : 'studioChat.http2Interrupted') }}
          <span v-if="last">{{ t('studioChat.interruptedRetry') }}</span>
        </template>
        <template v-else>{{ message.error || t('studioChat.requestFailed') }}</template>
      </p>
      <p v-if="message.clientRequestId" class="chat-message-note">{{ t('studioChat.traceId', { id: message.clientRequestId }) }}</p>
    </template>

    <div v-if="message.content || retryable" class="chat-message-actions">
      <button v-if="message.content" type="button" class="studio-btn studio-btn--quiet studio-btn--sm" :aria-label="t('studioChat.copy')" @click="emit('copy')">
        <Icon name="copy" size="xs" />{{ copied ? t('studioChat.copied') : t('studioChat.copy') }}
      </button>
      <button v-if="previewable" type="button" class="studio-btn studio-btn--quiet studio-btn--sm" :aria-pressed="previewVisible" @click="emit('togglePreview')">
        <Icon name="eye" size="xs" />{{ previewVisible ? t('studioChat.showHtmlCode') : t('studioChat.previewHtml') }}
      </button>
      <button v-if="previewVisible && previewable" type="button" class="studio-btn studio-btn--quiet studio-btn--sm" :aria-pressed="zoomed" @click="emit('toggleZoom', $event)">
        <Icon name="arrowsUpDown" size="xs" />{{ t(zoomed ? 'studioChat.exitHtmlZoom' : 'studioChat.zoomHtml') }}
      </button>
      <button v-if="retryable && last" type="button" class="studio-btn studio-btn--ghost studio-btn--sm" :title="t('studioChat.retryHint')" :disabled="retryDisabled" @click="emit('retry')">
        <Icon name="refresh" size="xs" />{{ t('studioChat.retryReply') }}
      </button>
    </div>

    <div
      v-if="previewCreated && previewable"
      v-show="previewVisible"
      :ref="element => emit('frame', element)"
      class="chat-html-frame"
      :class="{ 'is-zoomed': zoomed }"
      :role="zoomed ? 'dialog' : undefined"
      :aria-modal="zoomed || undefined"
      :aria-label="zoomed ? t('studioChat.htmlPreview') : undefined"
      tabindex="-1"
    >
      <button v-if="zoomed" type="button" class="studio-btn studio-btn--ghost studio-btn--sm chat-html-exit" @click="emit('exitZoom')">
        <Icon name="x" size="xs" />{{ t('studioChat.exitHtmlZoom') }}
      </button>
      <iframe class="chat-html-preview" :srcdoc="previewDocument" :title="t('studioChat.htmlPreview')" sandbox="allow-scripts" referrerpolicy="no-referrer" tabindex="0"></iframe>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import Icon from '@/components/icons/Icon.vue'
import type { StudioChatMessage } from '@/composables/studioChatStorage'
import { studioChatHTTP2ErrorMessage } from '@/composables/studioChatStream'
import { extractStudioChatHtml, studioChatHtmlDocument } from './studioChatHtml'

const props = defineProps<{
  message: StudioChatMessage
  last: boolean
  copied: boolean
  retryDisabled: boolean
  previewVisible: boolean
  previewCreated: boolean
  zoomed: boolean
}>()
const emit = defineEmits<{
  copy: []
  retry: []
  togglePreview: []
  toggleZoom: [event: MouseEvent]
  exitZoom: []
  frame: [element: unknown]
}>()
const { t } = useI18n()
const assistant = computed(() => props.message.role === 'assistant')
const streaming = computed(() => props.message.status === 'streaming')
const http2Interrupted = computed(() => props.message.error === studioChatHTTP2ErrorMessage)
const retryable = computed(() => assistant.value && (props.message.status === 'failed' || props.message.status === 'stopped'))
const waiting = computed(() => streaming.value && !props.message.content)
const elapsedSeconds = ref(0)
watch(waiting, (isWaiting, _, onCleanup) => {
  if (!isWaiting) return
  const start = props.message.startedAt ?? Date.now()
  function update() { elapsedSeconds.value = Math.max(0, Math.floor((Date.now() - start) / 1000)) }
  update()
  const timer = window.setInterval(update, 1000)
  onCleanup(() => window.clearInterval(timer))
}, { immediate: true })

// Rich formatting can traverse the entire reply. The template reads these
// computed values only for settled messages, and creates srcdoc on demand.
const markdown = computed(() => DOMPurify.sanitize(marked.parse(props.message.content, { async: false, gfm: true, breaks: true }), {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'a', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
  ALLOWED_ATTR: ['href', 'title', 'class'], ALLOW_DATA_ATTR: false
}))
const previewable = computed(() => assistant.value && !streaming.value && !!extractStudioChatHtml(props.message.content))
const previewDocument = computed(() => studioChatHtmlDocument(props.message.content))
</script>

<style scoped>
.chat-message { min-width: 0; }
.chat-message-heading { display: flex; align-items: center; gap: 6px; min-height: 28px; margin-bottom: 6px; color: var(--st-muted); font-size: 11px; }
.chat-message-heading strong { font-weight: 500; }
.chat-avatar { display: grid; place-items: center; flex-shrink: 0; width: 28px; height: 28px; border: 1px solid var(--st-border); border-radius: 50%; background: var(--st-panel); color: var(--st-text-soft); }
.chat-message.is-user { display: flex; flex-direction: column; align-items: flex-end; margin-left: auto; max-width: min(100%, 38rem); }
.chat-message.is-user .chat-message-heading { flex-direction: row-reverse; }
.chat-message.is-user .chat-avatar { border-color: transparent; background: var(--st-accent-soft); color: var(--st-accent-text); }
.chat-user-text { padding: 10px 14px; border-radius: 18px 4px 18px 18px; background: var(--st-accent-soft); color: var(--st-text); box-shadow: none; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.75; }

.chat-message-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chat-message.is-user .chat-message-actions { justify-content: flex-end; }
.chat-message-note, .chat-message-error { margin-top: 10px; font-size: 12px; overflow-wrap: anywhere; }
.chat-message-note { color: var(--st-muted); }
.chat-message-error { color: var(--st-danger); }
.chat-stream-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--st-accent); animation: pulse 1s infinite; }
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
.chat-html-frame { position: relative; margin-top: 12px; }
.chat-html-preview { display: block; width: 100%; min-height: 360px; border: 1px solid var(--st-border); border-radius: 12px; background: #fff; }
/* 放大预览:组件内固定定位,不使用原生 Fullscreen API,iframe 不重建 */
.chat-html-frame.is-zoomed { position: fixed; inset: 0; z-index: 120; margin: 0; padding: 48px 12px 12px; background: #020617e6; }
.chat-html-frame.is-zoomed .chat-html-preview { height: 100%; min-height: 0; border-radius: 12px; }
.chat-html-exit { position: absolute; top: 10px; right: 12px; z-index: 1; }

@keyframes pulse { 50% { opacity: .25; } }
.chat-live-text { white-space: pre-wrap; }
@media (prefers-reduced-motion: reduce) { .chat-stream-dot { animation: none; } }
</style>
