import { computed, ref } from 'vue'
import { i18n } from '@/i18n'
import { listChatModelsForKey, listStudioKeys, type StudioKeyOption } from './useAIPrompt'
import { sessionOwnerKey, StudioSessionChangedError } from './studioSession'
import { studioId } from './studioIdentity'
import { readStudioChatResponse } from './studioChatStream'
import { loadStudioChatHistory, saveStudioChatConversation, StudioChatConflictError, type StudioChatConversation, type StudioChatMessage } from './studioChatStorage'

const t = i18n.global.t
export const chatConversations = ref<StudioChatConversation[]>([])
export const chatActiveId = ref('')
export const chatKeys = ref<StudioKeyOption[]>([])
export const chatKeyId = ref<number | null>(null)
export const chatModels = ref<string[]>([])
export const chatModel = ref('')
export const chatOptionsLoading = ref(false)
export const chatOptionsError = ref('')
export const chatStorageError = ref('')
export const chatReady = ref(false)
export const chatRunningId = ref('')
export const activeChat = computed(() => chatConversations.value.find(row => row.id === chatActiveId.value))
export const sortedChats = computed(() => [...chatConversations.value].sort((a, b) => b.updatedAt - a.updatedAt))
export const chatBusy = computed(() => Boolean(chatRunningId.value))
let epoch = 0, owner = '', optionSequence = 0, controller: AbortController | undefined
let initializing: Promise<void> | undefined
let persistence = Promise.resolve()
let stopped = false
const removed = new Set<string>()
function snapshot() { const account = sessionOwnerKey(), version = epoch; return { account, current: () => account === sessionOwnerKey() && version === epoch } }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }

async function persist(conversation: StudioChatConversation, deleted = false): Promise<boolean> {
  const state = snapshot()
  if (owner !== state.account || !chatConversations.value.includes(conversation)) return false
  let saved = false
  const task = persistence.then(async () => {
    if (!state.current() || removed.has(conversation.id) && !deleted) return
    try {
      conversation.revision = await saveStudioChatConversation(state.account, conversation, state.current, deleted)
      saved = true
    } catch (error) {
      if (state.current() && !(error instanceof StudioSessionChangedError)) chatStorageError.value = t(error instanceof StudioChatConflictError ? 'studioChat.storageConflict' : 'studioChat.saveFailed')
    }
  })
  persistence = task.catch(() => {})
  await task
  return saved
}
function rememberSelection() {
  try { localStorage.setItem(`studio_text_chat_settings:${owner}`, JSON.stringify({ keyId: chatKeyId.value, model: chatModel.value })) } catch { /* History errors are reported independently. */ }
}
export function selectChatModel(model: string) { if (chatModels.value.includes(model)) { chatModel.value = model; rememberSelection() } }

export async function selectChatKey(keyId: number | null) {
  const state = snapshot(), sequence = ++optionSequence
  chatKeyId.value = keyId
  chatModels.value = []; chatModel.value = ''; chatOptionsError.value = ''; chatOptionsLoading.value = true
  const selected = chatKeys.value.find(key => key.id === keyId)
  try {
    if (selected) {
      const models = (await listChatModelsForKey(selected.key)).filter(model => !/(embed|rerank|whisper|(?:^|[-_/])tts(?:$|[-_/])|moderation|transcrib|realtime)/i.test(model))
      if (!state.current() || sequence !== optionSequence) return
      chatModels.value = [...new Set(models)]
      let savedModel = ''
      try { savedModel = JSON.parse(localStorage.getItem(`studio_text_chat_settings:${state.account}`) || '{}').model } catch { /* Invalid preferences use the first model. */ }
      chatModel.value = models.includes(savedModel) ? savedModel : models[0] || ''
    }
    if (state.current() && sequence === optionSequence) rememberSelection()
  } catch (error) {
    if (state.current() && sequence === optionSequence) chatOptionsError.value = errorMessage(error)
  } finally { if (state.current() && sequence === optionSequence) chatOptionsLoading.value = false }
}
export async function refreshChatOptions() {
  const state = snapshot(), sequence = ++optionSequence
  chatOptionsLoading.value = true; chatOptionsError.value = ''
  try {
    const keys = await listStudioKeys()
    if (!state.current() || sequence !== optionSequence) return
    chatKeys.value = keys
    let savedId: number | null = chatKeyId.value
    try { savedId ||= JSON.parse(localStorage.getItem(`studio_text_chat_settings:${state.account}`) || '{}').keyId } catch { /* Invalid preferences use the first key. */ }
    await selectChatKey(keys.find(key => key.id === savedId)?.id || keys[0]?.id || null)
  } catch (error) {
    if (state.current() && sequence === optionSequence) { chatKeys.value = []; chatModels.value = []; chatModel.value = ''; chatOptionsError.value = errorMessage(error) }
  } finally { if (state.current() && sequence === optionSequence) chatOptionsLoading.value = false }
}
export async function reloadChatHistory() {
  if (chatBusy.value) return
  const state = snapshot()
  chatReady.value = false; chatStorageError.value = ''
  try {
    const rows = await loadStudioChatHistory(state.account, state.current)
    if (!state.current()) return
    chatConversations.value = rows
    if (!rows.some(row => row.id === chatActiveId.value)) chatActiveId.value = [...rows].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id || ''
    chatReady.value = true
    if (!rows.length) newChat()
  } catch (error) { if (state.current() && !(error instanceof StudioSessionChangedError)) chatStorageError.value = t('studioChat.loadFailed') }
}
export function initStudioChat(): Promise<void> {
  if (owner !== sessionOwnerKey()) resetStudioChat()
  owner = sessionOwnerKey()
  if (!initializing) {
    const version = epoch
    initializing = Promise.all([reloadChatHistory(), refreshChatOptions()]).then(() => {})
      .finally(() => { if (version === epoch) initializing = undefined })
  }
  return initializing
}
export function newChat() {
  if (!chatReady.value) return
  const empty = chatConversations.value.find(row => !row.messages.length && !row.draft && !row.revision)
  if (empty) { chatActiveId.value = empty.id; return }
  const now = Date.now()
  const conversation: StudioChatConversation = { id: studioId(), title: '', createdAt: now, updatedAt: now, revision: 0, draft: '', messages: [] }
  chatConversations.value.push(conversation); chatActiveId.value = conversation.id
}
export function selectChat(id: string) { if (chatConversations.value.some(row => row.id === id)) chatActiveId.value = id }
export function stopChat() { stopped = true; controller?.abort() }
export async function deleteChat(id: string) {
  const state = snapshot()
  const conversation = chatConversations.value.find(row => row.id === id)
  if (!conversation) return
  if (chatRunningId.value === id) stopChat()
  removed.add(id)
  if (!await persist(conversation, true)) { removed.delete(id); return }
  if (!state.current()) return
  chatConversations.value = chatConversations.value.filter(row => row.id !== id)
  if (chatActiveId.value === id) { chatActiveId.value = sortedChats.value[0]?.id || ''; if (!chatActiveId.value) newChat() }
}
export async function renameChat(id: string, title: string) {
  const conversation = chatConversations.value.find(row => row.id === id)
  if (!conversation || !title.trim()) return
  conversation.title = title.trim().slice(0, 80); conversation.updatedAt = Date.now()
  await persist(conversation)
}
export async function saveChatDraft() { if (activeChat.value && chatReady.value && !chatStorageError.value) await persist(activeChat.value) }
export async function retryChatSave() {
  const state = snapshot()
  if (!chatReady.value) { await reloadChatHistory(); return }
  chatStorageError.value = ''
  for (const conversation of chatConversations.value) {
    if (!state.current()) return
    if (!removed.has(conversation.id)) await persist(conversation)
  }
}

export async function sendChat(retry = false) {
  const conversation = activeChat.value, selected = chatKeys.value.find(key => key.id === chatKeyId.value)
  if (!conversation || !chatReady.value || chatBusy.value || chatStorageError.value || chatOptionsLoading.value || !selected || !chatModels.value.includes(chatModel.value)) return
  const state = snapshot(), model = chatModel.value
  const last = conversation.messages.at(-1)
  if (retry && (!last || last.role !== 'assistant' || !['failed', 'stopped'].includes(last.status))) return
  const prompt = conversation.draft.trim()
  if (!retry && (!prompt || prompt.length > 32000)) return
  const previous = retry ? conversation.messages.slice(0, -1) : [...conversation.messages]
  const context = previous.filter(message => message.role === 'user' || message.status !== 'streaming' && Boolean(message.content))
    .map(message => ({ role: message.role, content: message.content }))
  if (!retry) context.push({ role: 'user', content: prompt })
  if (context.length > 200 || context.some(message => message.content.length > 32000) || context.reduce((sum, message) => sum + message.content.length, 0) > 200000) {
    chatOptionsError.value = t('studioChat.contextTooLong'); return
  }
  const reply: StudioChatMessage = { id: studioId(), role: 'assistant', content: '', status: 'streaming', model }
  conversation.messages = retry ? previous : [...previous, { id: studioId(), role: 'user', content: prompt, status: 'done' }]
  conversation.messages.push(reply)
  // Use the reactive proxy for token updates after the plain object was inserted.
  const responseMessage = conversation.messages[conversation.messages.length - 1]
  if (!conversation.title) conversation.title = prompt.slice(0, 48)
  conversation.updatedAt = Date.now()
  if (!retry) conversation.draft = ''
  chatRunningId.value = conversation.id; stopped = false; chatOptionsError.value = ''
  const requestController = new AbortController(); controller = requestController
  let timedOut = false
  const timeout = window.setTimeout(() => { timedOut = true; requestController.abort() }, 300000)
  try {
    // Save the user message before starting a potentially billable request.
    if (!await persist(conversation) || !state.current() || removed.has(conversation.id) || requestController.signal.aborted) {
      responseMessage.status = 'stopped'; return
    }
    const response = await fetch(`${window.location.origin}/api/v1/studio/chat`, {
      method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_id: selected.id, model, messages: context }), signal: requestController.signal
    })
    await readStudioChatResponse(response, text => {
      if (!state.current() || removed.has(conversation.id) || requestController.signal.aborted) return
      if (responseMessage.content.length + text.length > 200000) throw new Error(t('studioChat.replyTooLong'))
      responseMessage.content += text
    }, requestController.signal)
    if (state.current() && !removed.has(conversation.id)) {
      if (!responseMessage.content) throw new Error(t('studioChat.emptyReply'))
      responseMessage.status = 'done'
    }
  } catch (error) {
    if (!state.current() || removed.has(conversation.id)) return
    responseMessage.status = stopped && !timedOut ? 'stopped' : 'failed'
    if (responseMessage.status === 'failed') responseMessage.error = timedOut ? t('studioChat.timeout') : errorMessage(error)
  } finally {
    window.clearTimeout(timeout)
    if (state.current()) {
      if (!removed.has(conversation.id)) await persist(conversation)
      if (controller === requestController) { controller = undefined; chatRunningId.value = '' }
    }
  }
}
export function resetStudioChat() {
  epoch++; optionSequence++; controller?.abort(); controller = undefined; initializing = undefined
  chatConversations.value = []; chatActiveId.value = ''; chatKeys.value = []; chatKeyId.value = null
  chatModels.value = []; chatModel.value = ''; chatRunningId.value = ''; chatReady.value = false
  chatOptionsLoading.value = false; chatOptionsError.value = ''; chatStorageError.value = ''
  owner = ''; removed.clear(); persistence = Promise.resolve()
}
window.addEventListener('studio-session-ended', resetStudioChat)
