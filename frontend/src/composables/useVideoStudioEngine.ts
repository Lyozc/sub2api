/**
 * 视频工作台引擎(模块级单例)。
 *
 * 与 useImageStudioEngine 同一模式:任务队列、历史、草稿常驻 SPA 生命周期,
 * 切换页面不丢进度。视频生成为异步任务:提交(POST generations)拿 task id,
 * 轮询状态(GET tasks/:id),done 后取内容(GET tasks/:id/content)存 Blob。
 */
import { computed, reactive, ref, toRaw } from 'vue'
import { videoSubmissionKey, studioId } from './studioIdentity'
import { i18n } from '@/i18n'
import { useAppStore } from '@/stores/app'
import { sessionOwnerKey, StudioSessionChangedError } from './studioSession'
import { isGrokImageModel } from './studioModels'
import { openStudioHistoryDb } from './studioHistory'
import { GROK_VIDEO_RESOLUTIONS, videoCapabilities, videoDurationAllowed, videoAspectRatio, videoAudioAllowed, type VideoCapabilitySet } from './videoModelCapabilities'
import { prepareVideoFirstFrame, VideoFrameError } from './videoFirstFrame'

import { emptyVideoReferences, copyVideoReferences, validateVideoReferences, publicReferenceURL, type VideoReferenceAsset, type VideoReferences } from './videoReferences'

const t = i18n.global.t

// ===== 常量 =====
export const MODES = [
  { value: 't2v' as const, label: 'videoStudio.modeText2Video' },
  { value: 'i2v' as const, label: 'videoStudio.modeImage2Video' }
]
export const RESOLUTIONS = GROK_VIDEO_RESOLUTIONS
export const SECONDS = [6, 10, 12, 15]
export const SIZE_PRESETS = [
  { value: 'auto', label: 'auto' },
  { value: '1280x720', label: 'videoStudio.sizeLandscape' },
  { value: '720x1280', label: 'videoStudio.sizePortrait' },
  { value: '1024x1024', label: 'videoStudio.sizeSquare' },
  { value: '1792x1024', label: 'videoStudio.sizeWide' },
  { value: '1024x1792', label: 'videoStudio.sizeTall' }
]
export const QUANTITIES = [1, 2, 3, 4]
export const FALLBACK_VIDEO_MODELS = ['grok-imagine-video-1.5', 'grok-imagine-video']
const VIDEO_MODEL_PATTERN = /(video|imagine|seedance|veo|sora|kling)/i
const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 45 * 60 * 1000
// 连续轮询错误容忍次数(网络抖动不立即判死)
const MAX_POLL_ERRORS = 3
const SUBMISSION_RECOVERY_TIMEOUT_MS = 5 * 60 * 1000
const SUBMISSION_RECEIPT_TIMEOUT_MS = 15000

// ===== 类型 =====
// 模型选项带所属分组:工作台密钥按分组各一把(多个 grok/composite 视频分组同台),
// 生成时经 X-Video-Studio-Group 头路由到对应分组。
export interface VideoModelOption { id: string; group_id: number; group_name: string; platform?: string; capabilities?: VideoCapabilitySet; unit_prices?: Record<string, number> }

function toOptions(ids: string[]): VideoModelOption[] {
  return ids.map(id => ({ id, group_id: 0, group_name: '' }))
}

export interface KlingVideoSettings {
  mode: 'std' | 'pro'
  resolution: '' | '720p' | '1080p' | '4k'
  sound: '' | 'on' | 'off'
  negativePrompt: string
  cfgScale: number | null
}
export const defaultKlingSettings = (): KlingVideoSettings => ({ mode: 'std', resolution: '', sound: '', negativePrompt: '', cfgScale: null })
export const klingSettings = ref<KlingVideoSettings>(defaultKlingSettings())
export function validVideoDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
export function validVideoQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4
}

export interface VideoTask {
  taskId: number
  remoteId: string
  submissionKey?: string
  submissionUnconfirmed?: boolean
  submissionRecovering?: boolean
  failureKind?: 'submission' | 'polling' | 'download' | 'upstream'
  archived?: boolean
  assetDeleted?: boolean
  billableDuration?: number
  actualDuration?: number
  actualWidth?: number
  actualHeight?: number
  status: 'pending' | 'processing' | 'done' | 'failed'
  prompt: string
  model: string
  seconds: number
  resolution: string
  klingSettings?: KlingVideoSettings
  references?: VideoReferences
  submittedAt: number
  finishedAt?: number
  videoUrl?: string
  blob?: Blob
  error?: string
  billingNote?: string
  groupId?: number
  upstreamDone?: boolean
  upstreamFailed?: boolean
  videoSize?: string
  mode?: 't2v' | 'i2v'
  refImage?: File
  owner?: string
  sessionEpoch?: number
  conversationId?: string
  historyId?: number
}
export interface VideoHistoryItem {
  billableDuration?: number
  billingNote?: string
  id: number
  ts: number
  model: string
  prompt: string
  seconds: number
  resolution: string
  klingSettings?: KlingVideoSettings
  references?: VideoReferences
  blob: Blob
  sizeMB: number
  starred: boolean
  conversationId?: string
  taskId?: number
  groupId?: number
  videoSize?: string
  mode?: 't2v' | 'i2v'
  refImage?: File
}
export interface RefImage { file: File; url: string }

// ===== 设置状态 =====
export const models = ref<VideoModelOption[]>(toOptions(FALLBACK_VIDEO_MODELS))
export const modelsReady = ref(false)
export const model = ref(FALLBACK_VIDEO_MODELS[0])
export const modelGroupId = ref<number | null>(null)
export const initError = ref('')
export const mode = ref<'t2v' | 'i2v'>('t2v')
export const resolution = ref<'' | '480p' | '720p' | '1080p'>('720p')
export const videoSize = ref('auto')
export const seconds = ref(6)
export const quantity = ref(1)
export const prompt = ref('')

// ===== 参考图(图生视频首帧,v1 单张) =====
export const refImages = ref<RefImage[]>([])
export const klingReferences = ref(emptyVideoReferences())
function selectedOption() { return models.value.find(o => o.id === model.value && (modelGroupId.value == null || o.group_id === modelGroupId.value)) }
export function klingReferenceCapabilities() {
  const supplied = selectedOption()?.capabilities
  return { frames: videoCapabilities(model.value,'i2v',supplied), reference: videoCapabilities(model.value,'reference',supplied) }
}
export function hasKlingReferenceControls() {
  if (!/^kling/i.test(model.value)) return false
  const caps = klingReferenceCapabilities()
  return !!(caps.frames.references || caps.reference.references)
}
export function activeKlingReferences(): VideoReferences {
  const draft = klingReferences.value
  const limits = klingReferenceCapabilities()[draft.mode].references
  return {
    mode: draft.mode,
    images: (draft.mode === 'frames' ? draft.frames : draft.images).map(item => ({ name: item.name, url: item.file ? '' : item.url, ...(item.file ? { file: toRaw(item.file) } : {}) })),
    media: draft.mode === 'reference' ? draft.media.map(item => ({ ...toRaw(item) })) : [],
    keepOriginalSound: draft.mode === 'reference' && draft.keepOriginalSound,
    ...(draft.mode === 'reference' && limits?.prefer_multi_shots ? { preferMultiShots: draft.preferMultiShots } : {})
  }
}
export function clearKlingReferences() {
  imagePreparationVersion++
  preparingFirstFrame.value = false
  const draft = klingReferences.value
  for (const item of [...draft.frames,...draft.images]) if (item.file) URL.revokeObjectURL(item.url)
  klingReferences.value = emptyVideoReferences()
}
export function restoreKlingReferences(saved: VideoReferences) {
  clearKlingReferences()
  const draft = klingReferences.value
  draft.mode = saved.mode
  draft[saved.mode === 'frames' ? 'frames' : 'images'] = saved.images.map(item => ({ ...item, url: item.file ? URL.createObjectURL(item.file) : item.url }))
  draft.media = saved.media.map(item => ({ ...item }))
  draft.keepOriginalSound = saved.keepOriginalSound
  draft.preferMultiShots = saved.preferMultiShots ?? true
}
export function removeKlingReference(name: string) {
  const draft = klingReferences.value
  const key = draft.mode === 'frames' ? 'frames' : 'images'
  const item = draft[key].find(item => item.name === name)
  if (item?.file) URL.revokeObjectURL(item.url)
  draft[key] = draft[key].filter(item => item.name !== name)
  draft.media = draft.media.filter(item => item.name !== name)
  renumberReferences()
}
function renumberReferences() {
  const draft = klingReferences.value
  let n=0
  for (const item of draft.frames) if (item.name.startsWith('keyframe_')) item.name = `keyframe_${++n}`
  draft.images.forEach((item,index) => { item.name = `image_${index+1}` })
  for (const prefix of ['video','audio']) draft.media.filter(item => item.name.startsWith(`${prefix}_`)).forEach((item,index) => { item.name = `${prefix}_${index+1}` })
}
export function moveKlingKeyframe(name: string, delta: number) {
  const entries = klingReferences.value.frames
  const keyframes = entries.filter(item=>item.name.startsWith('keyframe_'))
  const index=keyframes.findIndex(item=>item.name === name), next=index+delta
  if (index < 0 || next < 0 || next >= keyframes.length) return
  const from=entries.indexOf(keyframes[index]), to=entries.indexOf(keyframes[next])
  ;[entries[from], entries[to]] = [entries[to], entries[from]]
  renumberReferences()
}
function nextReferenceSlot(kind: string) {
  const draft = klingReferences.value, caps = klingReferenceCapabilities()[draft.mode]
  const list = kind === 'video' ? caps.references?.video_slots : kind === 'audio' ? caps.references?.audio_slots : caps.references?.image_slots
  const used = [...draft[draft.mode === 'frames' ? 'frames' : 'images'],...draft.media]
  return list?.find(name => (kind === 'image' ? name.startsWith('image_') : kind === 'keyframe' ? name.startsWith('keyframe_') : kind === 'input' || kind === 'tail_image' ? name === kind : true) && !used.some(item => item.name === name))
}
export function addKlingReferenceURL(raw: string, kind: 'image' | 'video' | 'audio' | 'input' | 'tail_image' | 'keyframe') {
  if (!publicReferenceURL(raw.trim())) { appStore().showError(t('videoStudio.referenceInvalidURL')); return false }
  const name = nextReferenceSlot(kind)
  if (!name) { appStore().showError(t('videoStudio.referenceSlotUnsupported')); return false }
  const draft = klingReferences.value
  const entry = { name, url: raw.trim() }
  const list = kind === 'video' || kind === 'audio' ? draft.media : draft[draft.mode === 'frames' ? 'frames' : 'images']
  list.push(entry)
  const refs = activeKlingReferences(), limits = klingReferenceCapabilities()[draft.mode].references
  const error = validateVideoReferences(refs,limits,'')
  if (error && error !== 'referencesRequired') { list.pop(); appStore().showError(t(`videoStudio.${error}`)); return false }
  mode.value = 'i2v'
  return true
}
export async function addKlingReferenceFiles(files: File[], kind = 'image', replace = false) {
  if (preparingFirstFrame.value || !files.length) return false
  const session=currentSession(), version=++imagePreparationVersion
  const selectedModel=model.value, referenceMode=klingReferences.value.mode
  const caps=klingReferenceCapabilities()[referenceMode]
  if (!caps.references) { appStore().showError(t('videoStudio.referenceUnsupported')); return false }
  preparingFirstFrame.value=true
  const added: VideoReferenceAsset[]=[]
  try {
    const existing=activeKlingReferences()
    if (replace && ['input','tail_image'].includes(kind)) existing.images=existing.images.filter(item=>item.name !== kind)
    const names=new Set(existing.images.map(item=>item.name))
    for (const file of files) {
      const slot=caps.references.image_slots.find(name => !names.has(name) && (kind === 'image' ? name.startsWith('image_') : kind === 'keyframe' ? name.startsWith('keyframe_') : name === kind))
      if (!slot) throw new Error('referenceLimitExceeded')
      names.add(slot)
      const accepted=await prepareVideoFirstFrame(file,caps)
      added.push({ name:slot,file:accepted,url:'' })
    }
    const error=validateVideoReferences({ ...existing,images:[...existing.images,...added] },caps.references)
    if (error && error !== 'referencesRequired') throw new Error(error)
    if (version !== imagePreparationVersion || !isCurrentSession(session) || selectedModel !== model.value || referenceMode !== klingReferences.value.mode) return false
    if (replace && ['input','tail_image'].includes(kind)) removeKlingReference(kind)
    for (const entry of added) entry.url=URL.createObjectURL(entry.file!)
    klingReferences.value[referenceMode === 'frames' ? 'frames' : 'images'].push(...added)
    mode.value='i2v'
    return true
  } catch(error) {
    if (version === imagePreparationVersion && isCurrentSession(session)) appStore().showError(t(`videoStudio.${error instanceof VideoFrameError ? error.reason : error instanceof Error ? error.message : 'imageFormatError'}`,{ min:error instanceof VideoFrameError ? error.min : 0 }))
    return false
  } finally { if (version === imagePreparationVersion) preparingFirstFrame.value=false }
}


// ===== 任务与历史 =====
export const tasks = ref<VideoTask[]>([])
export const generating = ref(false)
export const history = ref<VideoHistoryItem[]>([])
export const historySearch = ref('')
export const storageUsed = ref(0)
export const storageQuota = ref(0)
let sessionEpoch = 0
const objectUrlCache = new Map<number, string>()

function appStore() {
  return useAppStore()
}
interface StudioSession { owner?: string; sessionEpoch?: number }

function currentSession(): StudioSession {
  return { owner: sessionOwnerKey(), sessionEpoch }
}

function isCurrentSession(session: StudioSession): boolean {
  return session.sessionEpoch === sessionEpoch && session.owner === sessionOwnerKey()
}

function sessionAuthHeader(session: StudioSession): { Authorization: string } {
  if (!isCurrentSession(session)) throw new StudioSessionChangedError()
  return { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` }
}
function api(path: string) {
  return `${window.location.origin}${path}`
}

export const filteredHistory = computed(() => {
  const kw = historySearch.value.trim().toLowerCase()
  if (!kw) return history.value
  return history.value.filter(it => it.prompt.toLowerCase().includes(kw) || it.model.toLowerCase().includes(kw))
})
export const starredItems = computed(() => history.value.filter(it => it.starred))
export const storagePercent = computed(() => (storageQuota.value > 0 ? Math.min(100, (storageUsed.value / storageQuota.value) * 100) : 0))
export function fmtMB(n: number): string {
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ===== 模型列表 =====
export function retryInit() {
  initError.value = ''
  void loadModels()
}
export async function loadModels() {
  const session = currentSession()
  modelsReady.value = false
  initError.value = ''
  try {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15000)
    const res = await fetch(api('/api/v1/video-studio/models'), {
      headers: sessionAuthHeader(session),
      signal: controller.signal
    })
    window.clearTimeout(timer)
    const body = await res.json().catch(() => null) as { message?: string; error?: { message?: string }; data?: VideoModelOption[] } | null
    if (!isCurrentSession(session)) return
    if (!res.ok) {
      throw new Error(body?.message || body?.error?.message || `HTTP ${res.status}`)
    }
    const options = (body?.data || []).filter(o => o && o.id && VIDEO_MODEL_PATTERN.test(o.id) && !/image/i.test(o.id) && !isGrokImageModel(o.id))
    if (!options.length) throw new Error(t('videoStudio.noModels'))
    models.value = options
    if (modelGroupId.value == null) {
      if (!models.value.some(o => o.id === model.value)) model.value = models.value[0].id
      modelGroupId.value = models.value.find(o => o.id === model.value)?.group_id ?? null
    }
    modelsReady.value = true
  } catch (err: unknown) {
    if (!isCurrentSession(session)) return
    const msg = err instanceof DOMException && err.name === 'AbortError'
      ? t('imageStudio.timeout')
      : (err instanceof Error ? err.message : t('videoStudio.initFailed'))
    initError.value = msg
  }
}

// The generation endpoint accepts one first frame. Never silently discard extras.
const MAX_REF_IMAGES = 1
export const preparingFirstFrame = ref(false)
let imagePreparationVersion = 0
export function selectedVideoCapabilities() {
  const option = models.value.find(o => o.id === model.value && (modelGroupId.value == null || o.group_id === modelGroupId.value))
  return videoCapabilities(model.value, mode.value === 'i2v' && hasKlingReferenceControls() && klingReferences.value.mode === 'reference' ? 'reference' : mode.value, option?.capabilities)
}
export async function addRefImages(incoming: File[], replace = false) {
  if (hasKlingReferenceControls()) return addKlingReferenceFiles(incoming, klingReferences.value.mode === 'reference' ? 'image' : 'input', replace)
  const file = incoming.find(f => f.type.startsWith('image/'))
  if (!file) return false
  if (!replace && refImages.value.length >= MAX_REF_IMAGES) { appStore().showError(t('videoStudio.maxRefImages')); return false }
  const version = ++imagePreparationVersion, session = currentSession()
  preparingFirstFrame.value = true
  try {
    const option = models.value.find(o => o.id === model.value && (modelGroupId.value == null || o.group_id === modelGroupId.value))
    const accepted = await prepareVideoFirstFrame(file, videoCapabilities(model.value, 'i2v', option?.capabilities))
    if (version !== imagePreparationVersion || !isCurrentSession(session)) return false
    refImages.value.forEach(item => URL.revokeObjectURL(item.url))
    refImages.value = [{ file: accepted, url: URL.createObjectURL(accepted) }]
    mode.value = 'i2v'
    if (incoming.length > 1) appStore().showError(t('videoStudio.maxRefImages'))
    return true
  } catch (error) {
    if (version === imagePreparationVersion && isCurrentSession(session)) appStore().showError(t(`videoStudio.${error instanceof VideoFrameError ? error.reason : 'imageFormatError'}`, { min: error instanceof VideoFrameError ? error.min : 0 }))
    return false
  } finally { if (version === imagePreparationVersion) preparingFirstFrame.value = false }
}

export function removeRefImage(index = 0) {
  imagePreparationVersion++
  preparingFirstFrame.value = false
  const item = refImages.value[index]
  if (!item) return
  URL.revokeObjectURL(item.url)
  refImages.value = refImages.value.filter((_, i) => i !== index)
  if (!refImages.value.length) mode.value = 't2v'
}

// ===== 提交 / 轮询 / 内容 =====
async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function submitTask(task: VideoTask): Promise<{ remoteId: string }> {
  const option = models.value.find(o => o.id === task.model && (task.groupId == null || o.group_id === task.groupId))
  const caps = videoCapabilities(task.model, task.references?.mode === 'reference' ? 'reference' : task.mode, option?.capabilities)
  const selectedResolution = /^kling/i.test(task.model) ? task.klingSettings?.resolution || '' : task.resolution
  if (!caps.resolutions.includes(selectedResolution)) throw new Error(t('videoStudio.unsupportedResolution'))
  if (!videoDurationAllowed(task.seconds, caps)) throw new Error(t('videoStudio.invalidModelDuration'))
  const payload: Record<string, unknown> = {
    model: task.model,
    prompt: task.prompt,
    duration: task.seconds
  }
  if (/^kling/i.test(task.model)) {
    const settings = task.klingSettings || defaultKlingSettings()
    payload.resolution = settings.resolution || caps.default_resolution
    if (caps.modes.includes(settings.mode)) payload.mode = settings.mode
    if (caps.sound && settings.sound) payload.sound = settings.sound === 'on' && !videoAudioAllowed(caps,selectedResolution) ? 'off' : settings.sound
    if (caps.negative_prompt && settings.negativePrompt) payload.negative_prompt = settings.negativePrompt
    if (caps.cfg_scale && settings.cfgScale !== null) payload.cfg_scale = settings.cfgScale
  } else if (task.resolution) payload.resolution = task.resolution
  const ratio = videoAspectRatio(task.videoSize || 'auto', /^kling/i.test(task.model))
  if (ratio !== 'auto' && caps.ratios.includes(ratio)) payload.aspect_ratio = ratio
  if (task.references) {
    const error = validateVideoReferences(task.references,caps.references,task.klingSettings?.sound)
    if (error) throw new Error(t(`videoStudio.${error}`))
    if (task.references.mode === 'reference' && ratio === 'auto') payload.aspect_ratio = caps.ratios.includes('auto') && (task.references.images.length || task.references.media.some(item=>item.name.startsWith('video_'))) ? 'auto' : '16:9'
    if (caps.sound && (task.references.keepOriginalSound || caps.references?.disable_generated_audio_with_video && task.references.media.some(item=>item.name.startsWith('video_')))) payload.sound = 'off'
    payload.video_mode = task.references.mode
    payload.reference_images = await Promise.all(task.references.images.map(async item => ({ name:item.name, url:item.file ? await fileToDataUrl(await prepareVideoFirstFrame(item.file,caps)) : item.url })))
    payload.reference_media = task.references.media.map(item=>({ name:item.name,url:item.url }))
    if (caps.references?.keep_original_sound) payload.keep_original_sound=task.references.keepOriginalSound
    if (task.references.preferMultiShots !== undefined) payload.prefer_multi_shots=task.references.preferMultiShots
  }
  if (!task.references && task.mode === 'i2v' && task.refImage) {
    task.refImage = await prepareVideoFirstFrame(task.refImage, caps)
    payload.image = { url: await fileToDataUrl(task.refImage) }
  }
  // 按模型所属分组路由:工作台密钥每分组一把,X 头让 relay 选对应密钥/分组
  const headers: Record<string, string> = { ...sessionAuthHeader(task), 'Content-Type': 'application/json', 'Idempotency-Key': task.submissionKey || '' }
  if (task.groupId && task.groupId > 0) headers['X-Video-Studio-Group'] = String(task.groupId)
  const controller = new AbortController()
  submissionControllers.set(task.taskId, controller)
  const timer = window.setTimeout(() => controller.abort(), 120000)
  try {
    const encoded = JSON.stringify(payload)
    if (new Blob([encoded]).size > 60 * 1024 * 1024) throw new Error(t('videoStudio.referenceRequestTooLarge'))
    task.submissionUnconfirmed = true
    // Persist the uncertainty flag before the paid request can leave the browser.
    // A reload must recover this key, even if no response was received.
    try { await taskPersister?.() } catch (error) { task.submissionUnconfirmed = false; throw error }
    if (!isCurrentSession(task)) throw new StudioSessionChangedError()
    if (stoppedTasks.has(task.taskId)) { task.submissionUnconfirmed = false; throw new Error(t('videoStudio.stoppedWaiting')) }
    const res = await fetch(api('/api/v1/video-studio/generations'), {
      method: 'POST',
      headers,
      body: encoded,
      signal: controller.signal
    })
    const body = await res.json().catch(() => null) as { error?: { message?: string }; message?: string; id?: string; request_id?: string; task_id?: string; billable_duration_seconds?: number } | null
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500 && ![408,409,429].includes(res.status)) task.submissionUnconfirmed = false
      throw new Error(body?.error?.message || body?.message || t('videoStudio.submitFailed'))
    }
    // 网关/中转的响应 id 字段不统一:xAI 原生为 id,sub2api 链路为 request_id
    const remoteId = body?.id || body?.request_id || body?.task_id
    if (!remoteId) throw new Error(t('videoStudio.submitFailed'))
    task.submissionUnconfirmed = false
    if (body?.billable_duration_seconds && task.references?.media.some(item=>item.name.startsWith('video_'))) { task.billableDuration=body.billable_duration_seconds; task.billingNote=t('videoStudio.referenceBillableDuration',{ seconds:body.billable_duration_seconds }) }
    return { remoteId }
  } finally {
    window.clearTimeout(timer)
    if (submissionControllers.get(task.taskId) === controller) submissionControllers.delete(task.taskId)
  }
}

interface TaskStatus {
  status?: string
  state?: string
  progress?: number
  error?: string | { message?: string }
  video?: { url?: string }
}

function taskPhase(st: TaskStatus): 'pending' | 'processing' | 'done' | 'failed' {
  const s = String(st.status || st.state || '').toLowerCase()
  if (s === 'done' || s === 'succeeded' || s === 'completed' || s === 'success') return 'done'
  if (s === 'failed' || s === 'error' || s === 'expired' || s === 'cancelled') return 'failed'
  if (s === 'processing' || s === 'running' || s === 'generating') return 'processing'
  return 'pending'
}

function taskGroupHeaders(task: VideoTask): Record<string, string> {
  // 多视频分组:状态/内容查询必须回到创建时的分组密钥,否则归属绑定解析失败
  return task.groupId && task.groupId > 0 ? { 'X-Video-Studio-Group': String(task.groupId) } : {}
}

async function pollTask(task: VideoTask): Promise<{ phase: VideoTask['status']; statusRaw: TaskStatus }> {
  const controller = new AbortController()
  pollControllers.set(task.taskId, controller)
  const timer = window.setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(api(`/api/v1/video-studio/tasks/${encodeURIComponent(task.remoteId)}`), {
      headers: { ...sessionAuthHeader(task), ...taskGroupHeaders(task) }, signal: controller.signal,
    })
    const body = await res.json().catch(() => null) as (TaskStatus & { message?: string }) | null
    if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : body?.error?.message || body?.message || `HTTP ${res.status}`)
    return { phase: taskPhase(body || {}), statusRaw: body || {} }
  } finally { window.clearTimeout(timer); pollControllers.delete(task.taskId) }

}

async function fetchVideoBlob(task: VideoTask): Promise<Blob> {
  // 大视频(15s/1080p 可达数十 MB)经网关转发较慢:单次 10 分钟,失败自动重试 3 次
  let lastErr: unknown = new Error(t('videoStudio.contentFailed'))
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!isCurrentSession(task)) throw new StudioSessionChangedError()
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 10000))
    if (!isCurrentSession(task)) throw new StudioSessionChangedError()
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 600000)
    try {
      const res = await fetch(api(`/api/v1/video-studio/tasks/${encodeURIComponent(task.remoteId)}/content`), {
        headers: { ...sessionAuthHeader(task), ...taskGroupHeaders(task) },
        signal: controller.signal
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string }; message?: string } | null
        throw new Error(body?.error?.message || body?.message || t('videoStudio.contentFailed'))
      }
      return await res.blob()
    } catch (err) {
      if (!isCurrentSession(task)) throw new StudioSessionChangedError()
      lastErr = err instanceof DOMException && err.name === 'AbortError'
        ? new Error(t('videoStudio.downloadTimeout'))
        : err
    } finally {
      window.clearTimeout(timer)
    }
  }
  throw lastErr
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : t('videoStudio.submitFailed')
}

// 手动停止等待的任务:runTask 轮询中检测到即退出
const stoppedTasks = new Set<number>()
const pollControllers = new Map<number, AbortController>()
const submissionControllers = new Map<number, AbortController>()
const runningTasks = new Set<number>()
let taskPersister: (() => Promise<unknown> | undefined) | undefined
export function registerVideoTaskPersistence(persist: typeof taskPersister) { taskPersister = persist }
interface SubmissionReceipt {
  id?: string
  request_id?: string
  task_id?: string
  billable_duration_seconds?: number
  error?: string | { message?: string }
  message?: string
}

function submissionMessage(body: SubmissionReceipt | null, fallback: string): string {
  return (typeof body?.error === 'string' ? body.error : body?.error?.message) || body?.message || fallback
}

/** Wait only for the original receipt. This path never creates another job. */
export async function recoverVideoSubmission(task: VideoTask) {
  if (!task.submissionKey) throw new Error(t('videoStudio.submissionUnknown'))
  const controller = new AbortController()
  submissionControllers.set(task.taskId, controller)
  const deadline = Date.now() + SUBMISSION_RECOVERY_TIMEOUT_MS
  const recoveryTimer = window.setTimeout(() => controller.abort(), SUBMISSION_RECOVERY_TIMEOUT_MS)
  let lastError: Error | undefined
  let attempt = 0
  task.submissionRecovering = true
  const assertCurrent = () => {
    if (!isCurrentSession(task)) throw new StudioSessionChangedError()
    if (stoppedTasks.has(task.taskId)) throw new Error(t('videoStudio.stoppedWaiting'))
    if (controller.signal.aborted) throw lastError || new Error(t('videoStudio.submissionUnknown'))
  }
  try {
    while (Date.now() < deadline) {
      assertCurrent()
      const requestController = new AbortController()
      const abortRequest = () => requestController.abort()
      controller.signal.addEventListener('abort', abortRequest, { once: true })
      const timer = window.setTimeout(() => requestController.abort(), Math.min(SUBMISSION_RECEIPT_TIMEOUT_MS, deadline - Date.now()))
      let terminal = false
      try {
        const res = await fetch(api(`/api/v1/video-studio/submissions/${encodeURIComponent(task.submissionKey)}`), { headers: sessionAuthHeader(task), signal: requestController.signal })
        const body = await res.json().catch(() => null) as SubmissionReceipt | null
        assertCurrent()
        const id = body?.id || body?.request_id || body?.task_id
        if (res.ok && id) {
          task.remoteId = id
          task.submissionUnconfirmed = false
          task.submissionRecovering = false
          task.error = undefined
          tasks.value = [...tasks.value]
          if (body?.billable_duration_seconds) task.billableDuration = body.billable_duration_seconds
          // Keep the known task ID durable before starting status/content calls.
          await Promise.resolve(taskPersister?.()).catch(() => {
            if (isCurrentSession(task)) appStore().showError(t('videoStudio.saveFailed'))
          })
          return
        }
        lastError = new Error(submissionMessage(body, t('videoStudio.submissionUnknown')))
        // A replayed error is the saved final HTTP result, not a temporary
        // receipt lookup failure. Keep 5xx uncertain and preserve its detail.
        const replayed = res.headers?.get('X-Idempotency-Replayed') === 'true'
        terminal = replayed || (!res.ok && res.status >= 400 && res.status < 500 && ![404, 408, 409, 429].includes(res.status))
        if (replayed && res.status >= 400 && res.status < 500 && ![408, 409, 429].includes(res.status)) task.submissionUnconfirmed = false
      } catch (error) {
        if (error instanceof StudioSessionChangedError) throw error
        lastError = error instanceof Error ? error : new Error(errText(error))
      } finally {
        window.clearTimeout(timer)
        controller.signal.removeEventListener('abort', abortRequest)
      }
      assertCurrent()
      if (terminal) throw lastError
      const delay = Math.min(15000, 5000 * ++attempt, deadline - Date.now())
      await new Promise<void>((resolve, reject) => {
        const finish = () => { controller.signal.removeEventListener('abort', abort); resolve() }
        const timer = window.setTimeout(finish, Math.max(0, delay))
        const abort = () => { window.clearTimeout(timer); controller.signal.removeEventListener('abort', abort); reject(lastError || new Error(t('videoStudio.submissionUnknown'))) }
        controller.signal.addEventListener('abort', abort, { once: true })
        if (controller.signal.aborted) abort()
      })
    }
    throw lastError || new Error(t('videoStudio.submissionUnknown'))
  } finally {
    window.clearTimeout(recoveryTimer)
    if (submissionControllers.get(task.taskId) === controller) submissionControllers.delete(task.taskId)
    task.submissionRecovering = false
  }
}

// runTask:提交 + 轮询 + 取内容 + 入库。独立 async,不阻塞批量循环。
async function runTask(task: VideoTask) {
  if (runningTasks.has(task.taskId)) return
  runningTasks.add(task.taskId)
  let pollErrors = 0
  try {
    let pollImmediately = Boolean(task.remoteId)
    if (!task.remoteId && task.submissionUnconfirmed) {
      await recoverVideoSubmission(task)
      pollImmediately = Boolean(task.remoteId)
    }
    if (!isCurrentSession(task)) return
    if (!task.remoteId) {
      task.submissionKey ||= videoSubmissionKey()
      await taskPersister?.()
      if (!isCurrentSession(task)) return
      let remoteId: string
      try {
        const submitted = await submitTask(task)
        remoteId = submitted.remoteId
      } catch (error) {
        if (!isCurrentSession(task)) return
        if (!task.submissionUnconfirmed || stoppedTasks.has(task.taskId)) throw error
        // The acknowledgement may arrive after the browser/CDN gave up. Use
        // its existing idempotency key instead of posting another generation.
        task.error = errText(error)
        await recoverVideoSubmission(task)
        remoteId = task.remoteId
        pollImmediately = true
      }
      if (!isCurrentSession(task)) return
      task.remoteId = remoteId
      task.error = undefined
      tasks.value = [...tasks.value]
    }
    const deadline = Date.now() + POLL_TIMEOUT_MS
    for (;;) {
      if (!isCurrentSession(task)) return
      if (stoppedTasks.has(task.taskId)) throw new Error(t('videoStudio.stoppedWaiting'))
      if (Date.now() > deadline) throw new Error(t('videoStudio.pollTimeout'))
      if (!pollImmediately) await new Promise(r => setTimeout(r, Math.min(30000, POLL_INTERVAL_MS * 2 ** pollErrors)))
      pollImmediately = false
      if (!isCurrentSession(task)) return
      if (stoppedTasks.has(task.taskId)) throw new Error(t('videoStudio.stoppedWaiting'))
      let phase: VideoTask['status']
      let statusRaw: TaskStatus
      try {
        const polled = await pollTask(task)
        if (!isCurrentSession(task)) return
        if (stoppedTasks.has(task.taskId)) throw new Error(t('videoStudio.stoppedWaiting'))
        phase = polled.phase
        statusRaw = polled.statusRaw
        pollErrors = 0
      } catch (pollErr) {
        if (!isCurrentSession(task)) return
        // 网络抖动容错:连续多次失败才判死
        pollErrors++
        if (pollErrors >= MAX_POLL_ERRORS) throw pollErr
        continue
      }
      if (statusRaw.status === 'submission_unknown' || statusRaw.state === 'submission_unknown') {
        task.submissionUnconfirmed = true
        const raw = statusRaw.error
        throw new Error(typeof raw === 'string' ? raw : raw?.message || t('videoStudio.submissionUnknown'))
      }
      task.submissionUnconfirmed = false
      if (phase === 'done') {
        // 视频已生成并计费:下载失败只影响取片,不把上游任务整个判死
        task.upstreamDone = true
        tasks.value = [...tasks.value]
        await finishDownload(task)
        return
      }
      if (phase === 'failed') {
        task.upstreamFailed = true
        task.failureKind = 'upstream'
        const raw = statusRaw.error
        task.error = typeof raw === 'string' ? raw : (raw?.message || t('videoStudio.generateFailed'))
        task.status = 'failed'
        tasks.value = [...tasks.value]
        return
      }
      task.status = phase
      tasks.value = [...tasks.value]
    }
  } catch (e) {
    if (!isCurrentSession(task)) return
    task.status = 'failed'
    task.failureKind = task.remoteId ? 'polling' : 'submission'
    const detail = stoppedTasks.has(task.taskId) ? t('videoStudio.stoppedWaiting') : errText(e)
    // Temporary receipt errors must not hide the original upstream response.
    const details = task.submissionUnconfirmed
      ? [task.error, detail, t('videoStudio.submissionUnknown')]
      : [detail]
    task.error = [...new Set(details.flatMap(value => value?.split('\n') || []).filter(Boolean))].join('\n')
    tasks.value = [...tasks.value]
  } finally {
    stoppedTasks.delete(task.taskId)
    runningTasks.delete(task.taskId)
  }
}

/** 手动停止等待:轮询循环在 5 秒内退出并把任务标记为失败 */
export function stopWaiting(taskId: number) {
  const task = tasks.value.find(tk => tk.taskId === taskId)
  if (!task || (task.status !== 'pending' && task.status !== 'processing')) return
  stoppedTasks.add(taskId)
  pollControllers.get(taskId)?.abort()
  submissionControllers.get(taskId)?.abort()
  pruneStoppedTasks()
}

/** 修剪 stoppedTasks 中已不在任务列表里的 id,防长期驻留泄漏 */
function pruneStoppedTasks() {
  if (stoppedTasks.size < 64) return
  const alive = new Set(tasks.value.map(tk => tk.taskId))
  for (const id of stoppedTasks) {
    if (!alive.has(id)) stoppedTasks.delete(id)
  }
}

export function cancelPending() {
  // 前端标记取消:仅停止后续轮询提示;已提交的上游任务无法撤销,完成后照常入库
  tasks.value.forEach(tk => {
    if (tk.status === 'pending') {
      tk.status = 'failed'
      tk.error = t('videoStudio.cancelled')
    }
  })
  tasks.value = [...tasks.value]
}

export function submitBatch(conversationId?: string): VideoTask[] {
  if (initError.value || !prompt.value.trim() || generating.value || preparingFirstFrame.value) return []
  const caps = selectedVideoCapabilities()
  if (!videoDurationAllowed(seconds.value, caps)) {
    appStore().showError(t('videoStudio.invalidModelDuration'))
    return []
  }
  if (!validVideoQuantity(quantity.value)) {
    appStore().showError(t('videoStudio.outputHint'))
    return []
  }
  if (!caps.resolutions.includes(/^kling/i.test(model.value) ? klingSettings.value.resolution : resolution.value)) {
    appStore().showError(t('videoStudio.unsupportedResolution'))
    return []
  }
  const selectedOption = models.value.find(o => o.id === model.value && o.group_id === modelGroupId.value)
    || (modelGroupId.value == null ? models.value.find(o => o.id === model.value) : undefined)
  if (modelGroupId.value != null && !selectedOption) return []
  if (prompt.value.trim().length > caps.prompt_max) { appStore().showError(t('videoStudio.promptTooLong',{ max: caps.prompt_max })); return [] }
  const references = mode.value === 'i2v' && hasKlingReferenceControls() ? activeKlingReferences() : undefined
  if (references) {
    const error=validateVideoReferences(references,caps.references,klingSettings.value.sound)
    if (error) { appStore().showError(t(`videoStudio.${error}`)); return [] }
  }
  const promptText = prompt.value.trim()
  const n = quantity.value
  let submissionKeys: string[]
  try { submissionKeys = Array.from({ length: n }, videoSubmissionKey) }
  catch (error) { appStore().showError(errText(error)); return [] }
  const created: VideoTask[] = []
  const owner = sessionOwnerKey()
  const batchEpoch = sessionEpoch
  const refImage = mode.value === 'i2v' ? refImages.value[0]?.file : undefined
  for (let i = 0; i < n; i++) {
    const task = reactive<VideoTask>({
      taskId: Number.parseInt(studioId().replace(/-/g, '').slice(0, 13), 16),
      remoteId: '',
      submissionKey: submissionKeys[i],
      status: 'pending',
      prompt: promptText,
      model: model.value,
      seconds: seconds.value,
      resolution: /^kling/i.test(model.value) ? klingSettings.value.resolution : resolution.value,
      klingSettings: /^kling/i.test(model.value) ? {
        mode: caps.modes.includes(klingSettings.value.mode) ? klingSettings.value.mode : 'std',
        resolution: klingSettings.value.resolution,
        sound: caps.sound ? klingSettings.value.sound : '',
        negativePrompt: caps.negative_prompt ? klingSettings.value.negativePrompt : '',
        cfgScale: caps.cfg_scale ? klingSettings.value.cfgScale : null,
      } : undefined,
      submittedAt: Date.now(),
      groupId: selectedOption && selectedOption.group_id > 0 ? selectedOption.group_id : undefined,
      videoSize: videoSize.value,
      mode: mode.value,
      refImage,
      references: references ? { ...references,images: references.images.map(item=>({...item})),media:references.media.map(item=>({...item})) } : undefined,
      owner,
      sessionEpoch: batchEpoch,
      conversationId
    })
    created.push(task)
  }
  generating.value = true
  tasks.value = [...created, ...tasks.value]
  // 并发提交:每张独立异步跑,引擎单例保证切页继续
  void Promise.all(created.map(tk => runTask(tk))).finally(() => {
    if (!isCurrentSession({ owner, sessionEpoch: batchEpoch })) return
    generating.value = false
    const ok = created.filter(tk => tk.status === 'done').length
    if (ok > 0) appStore().showSuccess(t('videoStudio.batchDone', { ok, total: n }))
  })
  return created
}

/** 上游已完成任务的下载+入库;下载失败仅标记失败,不影响已计费的生成结果 */
async function finishDownload(task: VideoTask) {
  try {
    const blob = await fetchVideoBlob(task)
    if (!isCurrentSession(task)) return
    task.blob = blob
    task.videoUrl = URL.createObjectURL(blob)
    task.status = 'done'
    task.finishedAt = Date.now()
    tasks.value = [...tasks.value]
    await saveHistory(task)
  } catch (e) {
    if (!isCurrentSession(task)) return
    task.status = 'failed'
    task.failureKind = 'download'
    task.error = errText(e)
    tasks.value = [...tasks.value]
  }
}

export function retryTask(taskId: number) {
  const task = tasks.value.find(tk => tk.taskId === taskId)
  if (!task || task.assetDeleted || task.status !== 'failed') return
  // Tasks created by older builds do not have session snapshot fields.
  task.sessionEpoch ??= sessionEpoch
  task.owner ||= sessionOwnerKey()
  if (!isCurrentSession(task)) return
  task.videoSize ||= 'auto'
  task.mode ||= 't2v'
  // Only a confirmed upstream terminal failure requires a new generation.
  // Polling/network failures retain the remote task to avoid duplicate billing.
  if (task.upstreamFailed) {
    task.remoteId = ''
    task.submissionKey = videoSubmissionKey()
    task.submissionUnconfirmed = false
    task.upstreamDone = false
    task.upstreamFailed = false
  }
  // 上游已生成(已计费)的任务:重试仅重新下载,不会重复提交计费
  if (task.upstreamDone && task.remoteId) {
    task.status = 'processing'
    task.error = undefined
    tasks.value = [...tasks.value]
    void finishDownload(task)
    return
  }
  if (!task.remoteId && !task.submissionUnconfirmed) task.submissionKey = videoSubmissionKey()
  task.status = 'pending'
  task.error = undefined
  tasks.value = [...tasks.value]
  void runTask(task)
}

export function resumeVideoTask(task: VideoTask) {
  if (task.remoteId && !task.upstreamFailed || task.submissionUnconfirmed && task.submissionKey) retryTask(task.taskId)
}
export function archiveVideoTask(task: VideoTask) {
  task.archived = true
  tasks.value = [...tasks.value]
}
export function removeTask(taskId: number) {
  const task = tasks.value.find(tk => tk.taskId !== undefined && tk.taskId === taskId)
  if (task?.videoUrl) URL.revokeObjectURL(task.videoUrl)
  // 未完成任务被移除时同步停止其后台轮询
  if (task && (task.status === 'pending' || task.status === 'processing')) stoppedTasks.add(taskId)
  tasks.value = tasks.value.filter(tk => tk.taskId !== taskId)
}

export function clearFailed() {
  tasks.value = tasks.value.filter(tk => tk.status !== 'failed')
}

// ===== IndexedDB(视频库) =====
function openIdb(owner = sessionOwnerKey()): Promise<IDBDatabase> {
  return openStudioHistoryDb('video', owner)
}
async function idbPut(item: VideoHistoryItem, owner = sessionOwnerKey()) {
  const db = await openIdb(owner)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['history', 'metadata'], 'readwrite')
    const deleted = tx.objectStore('metadata').get(`deleted-asset:${item.id}`)
    deleted.onsuccess = () => { if (!deleted.result) tx.objectStore('history').put(item) }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
async function idbAll(owner = sessionOwnerKey()): Promise<VideoHistoryItem[]> {
  const db = await openIdb(owner)
  const items = await new Promise<VideoHistoryItem[]>((resolve, reject) => {
    const req = db.transaction('history', 'readonly').objectStore('history').getAll()
    req.onsuccess = () => resolve(req.result as VideoHistoryItem[])
    req.onerror = () => reject(req.error)
  })
  db.close()
  return items
}
async function idbDelete(id: number, owner = sessionOwnerKey()) {
  const db = await openIdb(owner)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['history', 'metadata'], 'readwrite')
    tx.objectStore('metadata').put(true, `deleted-asset:${id}`)
    tx.objectStore('history').delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function saveHistory(task: VideoTask) {
  if (!task.blob || !isCurrentSession(task)) return
  const item: VideoHistoryItem = {
    id: task.historyId || task.taskId,
    ts: Date.now(),
    model: task.model,
    prompt: task.prompt,
    seconds: task.seconds,
    resolution: task.resolution,
    klingSettings: task.klingSettings ? { ...task.klingSettings } : undefined,
    blob: task.blob,
    sizeMB: Number((task.blob.size / 1024 / 1024).toFixed(1)),
    starred: false,
    conversationId: task.conversationId,
    taskId: task.taskId,
    groupId: task.groupId,
    videoSize: task.videoSize,
    mode: task.mode,
    refImage: task.refImage,
    references: copyVideoReferences(task.references),
    billableDuration: task.billableDuration,
    billingNote: task.billingNote
  }
  const owner = task.owner || sessionOwnerKey()
  await idbPut(item, owner).catch(() => {
    if (isCurrentSession(task)) appStore().showError(t('videoStudio.saveFailed'))
  })
  if (!isCurrentSession(task)) return
  const deletedAssets = await deletedVideoAssetIds(owner)
  if (!isCurrentSession(task)) return
  if (task.assetDeleted || deletedAssets.has(item.id)) {
    task.assetDeleted = true; task.archived = true
    if (task.videoUrl) URL.revokeObjectURL(task.videoUrl)
    task.videoUrl = undefined; task.blob = undefined
    return
  }
  task.historyId = item.id
  history.value = [item, ...history.value.filter(it => it.id !== item.id)]
  tasks.value = [...tasks.value]
  updateStorageMeter()
}

export async function loadHistory(strict = false) {
  const session = currentSession()
  try {
    const items = await idbAll(session.owner)
    if (!isCurrentSession(session)) return
    history.value = items
      .filter(it => it && it.blob instanceof Blob)
      .sort((a, b) => b.ts - a.ts)
  } catch (error) {
    if (isCurrentSession(session)) history.value = []
    if (strict) throw error
  }
}

export function updateStorageMeter() {
  const session = currentSession()
  if (navigator.storage?.estimate) {
    void navigator.storage.estimate().then(est => {
      if (!isCurrentSession(session)) return
      storageUsed.value = est.usage ?? 0
      storageQuota.value = est.quota ?? 0
    })
  }
}

export function historyVideoUrl(item: VideoHistoryItem): string {
  const cached = objectUrlCache.get(item.id)
  if (cached) return cached
  const url = URL.createObjectURL(item.blob)
  objectUrlCache.set(item.id, url)
  return url
}

export async function toggleHistoryStar(item: VideoHistoryItem) {
  item.starred = !item.starred
  await idbPut(item).catch(() => undefined)
}

export async function deleteHistory(id: number) {
  const session = currentSession()
  const item = history.value.find(it => it.id === id)
  const matching = tasks.value.filter(task => task.historyId === id || task.taskId === item?.taskId)
  // Durable tombstones also protect against stale snapshots in another tab.
  await idbDelete(id, session.owner)
  if (!isCurrentSession(session)) return
  for (const task of matching) task.assetDeleted = true
  await Promise.resolve(taskPersister?.()).catch(() => { if (isCurrentSession(session)) appStore().showError(t('videoStudio.saveFailed')) })
  if (!isCurrentSession(session)) return
  for (const task of matching) {
    if (task.videoUrl) URL.revokeObjectURL(task.videoUrl)
    task.videoUrl = undefined
    task.blob = undefined
    task.archived = true
  }
  tasks.value = [...tasks.value]
  await Promise.resolve(taskPersister?.()).catch(() => { if (isCurrentSession(session)) appStore().showError(t('videoStudio.saveFailed')) })
  const cached = objectUrlCache.get(id)
  if (cached) {
    URL.revokeObjectURL(cached)
    objectUrlCache.delete(id)
  }
  history.value = history.value.filter(it => it.id !== id)
  updateStorageMeter()
}

export async function clearAllHistory() {
  if (!window.confirm(t('videoStudio.clearAllConfirm'))) return
  const session = currentSession()
  for (const item of [...history.value]) {
    if (!isCurrentSession(session)) return
    await deleteHistory(item.id)
  }
  if (isCurrentSession(session)) updateStorageMeter()
}

/** Stop the old user's polling and remove all in-memory studio data. */
export function resetVideoStudioSession() {
  sessionEpoch++
  imagePreparationVersion++
  preparingFirstFrame.value = false
  pollControllers.forEach(controller => controller.abort())
  pollControllers.clear()
  submissionControllers.forEach(controller => controller.abort())
  submissionControllers.clear()
  runningTasks.clear()
  klingSettings.value = defaultKlingSettings()
  clearKlingReferences()
  quantity.value = 1
  tasks.value.forEach(task => stoppedTasks.add(task.taskId))
  tasks.value.forEach(task => { if (task.videoUrl) URL.revokeObjectURL(task.videoUrl) })
  tasks.value = []
  generating.value = false
  storageUsed.value = 0
  storageQuota.value = 0
  refImages.value.forEach(item => URL.revokeObjectURL(item.url))
  refImages.value = []
  objectUrlCache.forEach(url => URL.revokeObjectURL(url))
  objectUrlCache.clear()
  history.value = []
  historySearch.value = ''
  prompt.value = ''
  initError.value = ''
  models.value = toOptions(FALLBACK_VIDEO_MODELS)
  modelsReady.value = false
  model.value = FALLBACK_VIDEO_MODELS[0]
  modelGroupId.value = null
  mode.value = 't2v'
  pruneStoppedTasks()
}

if (typeof window !== 'undefined') {
  window.addEventListener('studio-session-ended', resetVideoStudioSession)
}

export function recordVideoMetadata(taskId: number, duration: number, width: number, height: number) {
  const task = tasks.value.find(task => task.taskId === taskId)
  if (!task) return
  if (Number.isFinite(duration) && duration > 0) task.actualDuration = duration
  if (width > 0 && height > 0) { task.actualWidth = width; task.actualHeight = height }
}

export async function deletedVideoAssetIds(owner = sessionOwnerKey()): Promise<Set<number>> {
  const db = await openIdb(owner)
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('metadata').objectStore('metadata').getAllKeys()
      req.onsuccess = () => resolve(new Set(req.result.flatMap(key => typeof key === 'string' && key.startsWith('deleted-asset:') ? [Number(key.slice(14))] : [])))
      req.onerror = () => reject(req.error)
    })
  } finally { db.close() }
}

export function isVideoTaskRunning(taskId: number) { return runningTasks.has(taskId) }
