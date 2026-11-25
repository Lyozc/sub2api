import { computed, ref, toRaw, watch } from 'vue'
import { copyVideoReferences } from './videoReferences'
import { studioId } from './studioIdentity'
import { i18n } from '@/i18n'
import { notifyStudioChange, onStudioChange } from './studioBroadcast'
import { emptySnapshot, snapshotDelta, hasSnapshotChanges, videoSnapshotStorage, type Snapshot, type SnapshotDelta, type VideoConversation } from './videoSnapshot'
export type { VideoConversation } from './videoSnapshot'
import { sessionOwnerKey } from './studioSession'
import {
  tasks, history, prompt, model, modelGroupId, seconds, resolution, videoSize, klingSettings, defaultKlingSettings,
  clearKlingReferences, restoreKlingReferences, mode, refImages, removeRefImage, addRefImages, submitBatch, loadHistory, removeTask, archiveVideoTask, resumeVideoTask, registerVideoTaskPersistence,
  deletedVideoAssetIds, isVideoTaskRunning, type VideoTask,
} from './useVideoStudioEngine'

export const conversations = ref<VideoConversation[]>([])
export const activeConversationId = ref('')
export const conversationsReady = ref(false)
export const conversationStorageError = ref(false)
export const conversationInitError = ref('')
export const activeConversation = computed(() => conversations.value.find(c => c.id === activeConversationId.value))
export const conversationTasks = computed(() => tasks.value
  .filter(task => !task.archived && task.conversationId === activeConversationId.value)
  .sort((a, b) => a.submittedAt - b.submittedAt || a.taskId - b.taskId))
let epoch = 0
let loading: Promise<void> | null = null
let writes: Promise<unknown> = Promise.resolve()

let observed = emptySnapshot()
let failedWrites: SnapshotDelta[] = []
function captureSnapshot(): Snapshot {
  return {
    conversations: conversations.value.map(c => ({ ...c })),
    activeId: activeConversationId.value,
    tasks: tasks.value.filter(task => task.conversationId).map(task => {
      const { blob: _blob, videoUrl: _url, owner: _owner, sessionEpoch: _epoch, ...saved } = toRaw(task)
      return { ...saved, dreaminaAssetIds: saved.dreaminaAssetIds?.slice(), references: copyVideoReferences(saved.references), klingSettings: saved.klingSettings ? { ...toRaw(saved.klingSettings) } : undefined, refImage: saved.refImage ? toRaw(saved.refImage) : undefined }
    }),
  }
}

export function persistConversations() {
  if (!conversationsReady.value) return
  const owner = sessionOwnerKey()
  const version = epoch
  const snapshot = captureSnapshot()
  const delta = snapshotDelta(observed, snapshot)
  observed = snapshot
  writes = writes.catch(() => undefined).then(async () => {
    const current = () => version === epoch && owner === sessionOwnerKey()
    if (!current()) return
    const changes = [...failedWrites, ...(hasSnapshotChanges(delta) ? [delta] : [])]
    if (!changes.length) return
    try {
      await videoSnapshotStorage(owner, changes, current)
      if (!current()) return
      failedWrites = []
      conversationStorageError.value = false
      notifyStudioChange('video', owner)
    } catch {
      if (current()) { failedWrites = changes; conversationStorageError.value = true }
    }
  })
  return writes
}

watch([tasks, conversations, activeConversationId], () => { void persistConversations() }, { deep: true })
watch(prompt, value => {
  if (conversationsReady.value && activeConversation.value) activeConversation.value.draft = value
}, { flush: 'sync' })

export function newVideoConversation() {
  const conversation: VideoConversation = {
    id: studioId(),
    title: '', createdAt: Date.now(), draft: '',
  }
  conversations.value.unshift(conversation)
  selectVideoConversation(conversation.id)
  return conversation
}

export function selectVideoConversation(id: string) {
  const conversation = conversations.value.find(c => c.id === id)
  if (!conversation) return
  activeConversationId.value = id
  prompt.value = conversation.draft
  clearKlingReferences()
  while (refImages.value.length) removeRefImage(0)
}

export function deleteVideoConversation(id: string) {
  for (const task of tasks.value.filter(task => task.conversationId === id)) {
    if (task.status === 'done' || task.upstreamFailed) removeTask(task.taskId)
    else archiveVideoTask(task)
  }
  conversations.value = conversations.value.filter(c => c.id !== id)
  if (activeConversationId.value === id) {
    const next = conversations.value[0]
    if (next) selectVideoConversation(next.id)
    else newVideoConversation()
  }
}

export function sendVideoMessage(): boolean {
  if (!conversationsReady.value) return false
  const conversation = activeConversation.value || newVideoConversation()
  const created = submitBatch(conversation.id)
  if (!created.length) return false
  if (!conversation.title) conversation.title = created[0].prompt.slice(0, 48)
  prompt.value = ''
  clearKlingReferences()
  while (refImages.value.length) removeRefImage(0)
  return true
}

/** Restore the full request in the composer. Generating remains an explicit action. */
export async function reuseVideoTask(task: VideoTask) {
  prompt.value = task.prompt
  model.value = task.model
  modelGroupId.value = task.groupId ?? null
  klingSettings.value = { ...defaultKlingSettings(), ...task.klingSettings }
  seconds.value = task.seconds
  if (['480p', '720p', '1080p'].includes(task.resolution)) resolution.value = task.resolution as typeof resolution.value
  videoSize.value = task.videoSize || 'auto'
  clearKlingReferences()
  while (refImages.value.length) removeRefImage(0)
  if (task.refImage) await addRefImages([task.refImage])
  if (task.references) restoreKlingReferences(task.references)
  mode.value = task.refImage || task.references ? 'i2v' : 't2v'
}

export function initVideoConversations(): Promise<void> {
  if (conversationsReady.value) return Promise.resolve()
  if (loading) return loading
  const version = epoch
  const owner = sessionOwnerKey()
  conversationInitError.value = ''
  loading = (async () => {
    const current = () => version === epoch && owner === sessionOwnerKey()
    const saved = await videoSnapshotStorage(owner, [], current)
    await loadHistory(true)
    if (!current()) return
    const deletedAssets = await deletedVideoAssetIds(owner)
    if (version !== epoch || owner !== sessionOwnerKey()) return
    observed = { conversations: saved.conversations.map(c => ({ ...c })), tasks: saved.tasks.map(task => ({ ...task, klingSettings: task.klingSettings ? { ...task.klingSettings } : undefined })), activeId: saved.activeId }
    conversations.value = saved?.conversations || []
    const restored: VideoTask[] = (saved?.tasks || []).map(savedTask => {
      const task = { ...savedTask, assetDeleted: savedTask.assetDeleted || deletedAssets.has(savedTask.historyId || savedTask.taskId) }
      const video = history.value.find(item => item.id === task.historyId || item.taskId === task.taskId)
      return {
        ...task,
        submissionUnconfirmed: task.provider !== 'dreamina' && !video && !task.remoteId && (task.submissionUnconfirmed || !task.submissionKey || task.status === 'pending' || task.status === 'processing'),
        historyId: video?.id ?? task.historyId,
        status: video && !task.assetDeleted ? 'done' : task.status === 'awaiting_approval' ? 'awaiting_approval' : 'failed',
        archived: task.assetDeleted || task.archived,
        // Refresh resumes the original receipt/job and never creates a new one.
        error: video ? undefined : task.status === 'failed' || task.status === 'awaiting_approval' ? task.error
          : i18n.global.t(task.status === 'done' ? 'videoStudio.localVideoMissing' : 'videoStudio.resumeAfterReload'),
        videoUrl: video && !task.assetDeleted ? URL.createObjectURL(video.blob) : undefined,
        blob: task.assetDeleted ? undefined : video?.blob,
      }
    })
    tasks.value = [...tasks.value, ...restored.filter(task => !tasks.value.some(current => current.taskId === task.taskId))]
    importVideoHistory()
    const selected = conversations.value.find(c => c.id === saved?.activeId) || conversations.value[0]
    if (selected) selectVideoConversation(selected.id)
    else newVideoConversation()
    conversationsReady.value = true
    void persistConversations()
    for (const task of restored) {
      if (!task.archived && !task.assetDeleted && task.status === 'failed' && !task.upstreamFailed && (task.remoteId || task.submissionUnconfirmed && task.submissionKey)) resumeVideoTask(task)
    }
  })().catch(() => {
    if (version === epoch && owner === sessionOwnerKey()) {
      conversationStorageError.value = true
      conversationInitError.value = i18n.global.t('videoStudio.storageInitFailed')
    }
  }).finally(() => { if (version === epoch) loading = null })
  return loading
}

/** Bring previous video history into the UI without rewriting or deleting it. */
export function importVideoHistory() {
  for (const item of history.value) {
      if (tasks.value.some(task => task.historyId === item.id)) continue
      const id = item.conversationId || `history-${item.id}`
      // A deleted conversation's videos stay exclusively in the asset library.
      if (item.conversationId && !conversations.value.some(c => c.id === id)) continue
      if (!conversations.value.some(c => c.id === id)) {
        conversations.value.push({ id, title: item.prompt.slice(0, 48), createdAt: item.ts, draft: '' })
      }
      tasks.value.push({
        taskId: item.taskId || item.id, historyId: item.id, remoteId: '', conversationId: id,
        status: 'done', prompt: item.prompt, model: item.model, provider: item.provider, seconds: item.seconds,
        resolution: item.resolution, klingSettings: item.klingSettings, submittedAt: item.ts, videoUrl: URL.createObjectURL(item.blob),
        groupId: item.groupId, videoSize: item.videoSize, refImage: item.refImage, mode: item.mode, references: copyVideoReferences(item.references), billableDuration: item.billableDuration, billingNote: item.billingNote,
      })
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('studio-session-ended', () => {
    epoch++
    conversationsReady.value = false
    conversations.value = []
    activeConversationId.value = ''
    conversationStorageError.value = false
    conversationInitError.value = ''
    observed = emptySnapshot()
    failedWrites = []
    loading = null
  })
}

registerVideoTaskPersistence(async () => {
  if (!conversationsReady.value) throw new Error(i18n.global.t('videoStudio.storageInitFailed'))
  await persistConversations()
  if (conversationStorageError.value) throw new Error(i18n.global.t('videoStudio.conversationSaveFailed'))
})

/** Explicit handoff waits for drafts to initialize, rather than racing a mount. */
export async function applyVideoPrompt(value: string, acceptDraft?: (current: string) => boolean) {
  const version = epoch, owner = sessionOwnerKey()
  await initVideoConversations()
  if (version !== epoch || owner !== sessionOwnerKey() || !conversationsReady.value) return false
  if (acceptDraft && !acceptDraft(prompt.value)) return false
  if (!activeConversation.value) newVideoConversation()
  prompt.value = value.slice(0, 4000)
  await persistConversations()
  return version === epoch && owner === sessionOwnerKey()
}

let syncing = false
onStudioChange('video', () => { void syncVideoWindows() })
async function syncVideoWindows() {
  if (syncing || !conversationsReady.value) return
  const version = epoch, owner = sessionOwnerKey()
  const current = () => version === epoch && owner === sessionOwnerKey()
  syncing = true
  try {
    await persistConversations()
    if (!current() || conversationStorageError.value) return
    const saved = await videoSnapshotStorage(owner, [], current)
    await loadHistory(true)
    const deletedAssets = await deletedVideoAssetIds(owner)
    if (!current()) return
    const deletedTasks = new Set(saved.deletedTasks || [])
    const deletedConversations = new Set(saved.deletedConversations || [])
    for (const task of [...tasks.value]) if (deletedTasks.has(task.taskId)) removeTask(task.taskId)
    conversations.value = saved.conversations.filter(c => !deletedConversations.has(c.id))
    for (const remote of saved.tasks) {
      let local = tasks.value.find(task => task.taskId === remote.taskId)
      const video = history.value.find(item => item.id === remote.historyId || item.taskId === remote.taskId)
      if (!local) {
        local = { ...remote, videoUrl: video ? URL.createObjectURL(video.blob) : undefined, blob: video?.blob }
        tasks.value.push(local)
      } else if (!isVideoTaskRunning(local.taskId)) {
        Object.assign(local, remote)
        if (video && !local.blob) { local.blob = video.blob; local.videoUrl = URL.createObjectURL(video.blob) }
      }
      if (remote.archived) local.archived = true
      if (remote.assetDeleted || deletedAssets.has(remote.historyId || remote.taskId)) {
        local.assetDeleted = true; local.archived = true
        if (local.videoUrl) URL.revokeObjectURL(local.videoUrl)
        local.videoUrl = undefined; local.blob = undefined
      }
    }
    if (activeConversationId.value && !conversations.value.some(c => c.id === activeConversationId.value)) {
      activeConversationId.value = conversations.value[0]?.id || ''
    }
    // Remote changes are observations, not local edits to write back.
    observed = captureSnapshot()
  } catch {
    if (current()) conversationStorageError.value = true
  } finally { syncing = false }
}
