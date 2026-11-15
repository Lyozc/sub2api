/**
 * 创作中心数据层(模块级单例)。
 *
 * IndexedDB `canvas-db`:
 *   - prompts: { id, name, category, content, builtin?, updatedAt }  提示词库
 */
import { ref } from 'vue'
import { openCanvasDb } from './canvasStorage'
import { sessionOwnerKey, StudioSessionChangedError } from './studioSession'
import { i18n } from '@/i18n'
import { useAppStore } from '@/stores/app'

const t = i18n.global.t

// ===== 类型 =====
export interface PromptItem {
  id: string
  name: string
  category: string
  content: string
  builtin?: boolean
  updatedAt: number
}

// ===== 状态 =====
export const activeTab = ref<'conversation' | 'chat' | 'video' | 'prompts' | 'assets' | 'config'>('chat')

export const prompts = ref<PromptItem[]>([])

function appStore() {
  return useAppStore()
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ===== IndexedDB =====
let epoch = 0
function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const owner = sessionOwnerKey(), version = epoch
  return openCanvasDb(owner).then(db => new Promise<T>((resolve, reject) => {
    if (owner !== sessionOwnerKey() || version !== epoch) { db.close(); reject(new StudioSessionChangedError()); return }
    const transaction = db.transaction(store, mode)
    const req = run(transaction.objectStore(store))
    const abort = () => transaction.abort()
    window.addEventListener('studio-session-ended', abort)
    const cleanup = () => { db.close(); window.removeEventListener('studio-session-ended', abort) }
    transaction.oncomplete = () => { cleanup(); resolve(req.result) }
    transaction.onabort = () => { cleanup(); reject(transaction.error || new StudioSessionChangedError()) }
    transaction.onerror = () => { /* onabort settles the operation */ }
  }))
}

// ===== 提示词库 =====
const BUILTIN_PROMPTS: PromptItem[] = [
  { id: 'b1', name: t('canvas.p.applePosterName'), category: t('canvas.p.work'), builtin: true, updatedAt: 0, content: t('canvas.p.applePoster') },
  { id: 'b2', name: t('canvas.p.cityIslandName'), category: t('canvas.p.art'), builtin: true, updatedAt: 0, content: t('canvas.p.cityIsland') },
  { id: 'b3', name: t('canvas.p.stickerName'), category: t('canvas.p.fun'), builtin: true, updatedAt: 0, content: t('canvas.p.sticker') },
  { id: 'b4', name: t('canvas.p.doodleInfographicName'), category: t('canvas.p.study'), builtin: true, updatedAt: 0, content: t('canvas.p.doodleInfographic') },
  { id: 'b5', name: t('canvas.p.mindMapName'), category: t('canvas.p.study'), builtin: true, updatedAt: 0, content: t('canvas.p.mindMap') },
  { id: 'b6', name: t('canvas.p.nokiaName'), category: t('canvas.p.fun'), builtin: true, updatedAt: 0, content: t('canvas.p.nokia') },
  { id: 'b7', name: t('canvas.p.recipeName'), category: t('canvas.p.life'), builtin: true, updatedAt: 0, content: t('canvas.p.recipe') },
  { id: 'b8', name: t('canvas.p.roastName'), category: t('canvas.p.fun'), builtin: true, updatedAt: 0, content: t('canvas.p.roast') },
  { id: 'b9', name: t('canvas.p.glassPptName'), category: t('canvas.p.work'), builtin: true, updatedAt: 0, content: t('canvas.p.glassPpt') },
  { id: 'b10', name: t('canvas.p.videoCamName'), category: t('canvas.p.video'), builtin: true, updatedAt: 0, content: t('canvas.p.videoCam') }
]

export async function loadPrompts() {
  const version = epoch, owner = sessionOwnerKey()
  try {
    const items = await tx<PromptItem[]>('prompts', 'readonly', s => s.getAll() as IDBRequest<PromptItem[]>)
    if (version !== epoch || owner !== sessionOwnerKey()) return
    prompts.value = [...BUILTIN_PROMPTS, ...items].sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    if (version !== epoch || owner !== sessionOwnerKey()) return
    prompts.value = [...BUILTIN_PROMPTS]
  }
}

export async function addPrompt(name: string, category: string, content: string) {
  const item: PromptItem = { id: uid(), name, category: category || t('canvas.p.uncategorized'), content, updatedAt: Date.now() }
  await tx('prompts', 'readwrite', s => s.put(item))
  await loadPrompts()
  appStore().showSuccess(t('canvas.promptSaved'))
}
export async function updatePrompt(item: PromptItem) {
  if (item.builtin) return
  item.updatedAt = Date.now()
  await tx('prompts', 'readwrite', s => s.put(item))
  await loadPrompts()
}
export async function deletePrompt(id: string) {
  await tx('prompts', 'readwrite', s => s.delete(id))
  await loadPrompts()
}

window.addEventListener('studio-session-ended', () => { epoch++; prompts.value = [] })

// Unowned legacy data remains untouched until the person using the device
// explicitly claims it for their current account. Never auto-import on login.
export async function recoverLegacyPrompts() {
  const owner = sessionOwnerKey(), version = epoch
  const legacy = await new Promise<IDBDatabase | null>((resolve, reject) => {
    let missing = false
    const req = indexedDB.open('canvas-db')
    req.onupgradeneeded = () => { missing = true; req.transaction?.abort() }
    req.onerror = () => missing ? resolve(null) : reject(req.error)
    req.onsuccess = () => resolve(req.result)
  })
  if (!legacy) return 0
  let records: PromptItem[]
  try {
    if (!legacy.objectStoreNames.contains('prompts')) return 0
    records = await new Promise((resolve, reject) => {
      const req = legacy.transaction('prompts').objectStore('prompts').getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally { legacy.close() }
  const db = await openCanvasDb(owner)
  try {
    if (version !== epoch || owner !== sessionOwnerKey()) throw new StudioSessionChangedError()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('prompts', 'readwrite')
      const abort = () => transaction.abort()
      window.addEventListener('studio-session-ended', abort)
      const cleanup = () => window.removeEventListener('studio-session-ended', abort)
      for (const item of records) {
        if (!item || typeof item.id !== 'string' || typeof item.content !== 'string' || typeof item.name !== 'string') continue
        const key = `legacy:${item.id}`
        const store = transaction.objectStore('prompts'), req = store.get(key)
        req.onsuccess = () => { if (!req.result) store.put({ ...item, id: key }) }
      }
      transaction.oncomplete = () => { cleanup(); resolve() }
      transaction.onabort = () => { cleanup(); reject(transaction.error || new StudioSessionChangedError()) }
    })
  } finally { db.close() }
  if (version !== epoch || owner !== sessionOwnerKey()) return 0
  await loadPrompts()
  return records.length
}
