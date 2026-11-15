/**
 * 在线提示词模板库:从 GitHub 公开 awesome 仓库(yukkcat/image-prompts 聚合)懒加载,
 * 每源独立拉取,IndexedDB 缓存 7 天。与富贵SUP 同款数据源。
 */
import { computed, ref } from 'vue'
import { openCanvasDb } from './canvasStorage'
import { sessionOwnerKey } from './studioSession'
import { i18n } from '@/i18n'

const t = i18n.global.t

export interface OnlinePrompt {
  id: string
  sourceId: string
  title: string
  prompt: string
  coverUrl?: string
}

export interface OnlineSource {
  id: string
  file: string
  name: string
  items: OnlinePrompt[]
  loading: boolean
  error: string
  loadedAt: number
}

const BASE = 'https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000

export const SOURCES: Array<{ id: string; file: string; name: string }> = [
  { id: 'banana-prompt-quicker', file: 'banana-prompt-quicker.json', name: 'Banana Prompt Quicker' },
  { id: 'youmind-gpt-image-2', file: 'youmind-gpt-image-2.json', name: 'YouMind GPT-Image' },
  { id: 'youmind-nano-banana-pro', file: 'youmind-nano-banana-pro.json', name: 'YouMind Nano Banana' },
  { id: 'awesome-gpt-image', file: 'awesome-gpt-image.json', name: 'Awesome GPT-Image' },
  { id: 'awesome-gpt4o-image-prompts', file: 'awesome-gpt4o-image-prompts.json', name: 'Awesome GPT4o Prompts' },
  { id: 'davidwu-gpt-image2-prompts', file: 'davidwu-gpt-image2-prompts.json', name: 'Davidwu GPT-Image2' },
  { id: 'freestylefly-gpt-image-2', file: 'freestylefly-gpt-image-2.json', name: 'Freestylefly GPT-Image' },
]

export const sources = ref<OnlineSource[]>(SOURCES.map(s => ({ ...s, items: [], loading: false, error: '', loadedAt: 0 })))
export const activeSourceId = ref<string>('')
export const onlineSearch = ref('')

export const activeSource = computed(() => sources.value.find(s => s.id === activeSourceId.value) || null)

export const filteredOnline = computed(() => {
  const src = activeSource.value
  if (!src) return []
  const kw = onlineSearch.value.trim().toLowerCase()
  if (!kw) return src.items
  return src.items.filter(p => p.title.toLowerCase().includes(kw) || p.prompt.toLowerCase().includes(kw))
})

// ===== IndexedDB 缓存(复用 canvas-db) =====
async function cacheGet(key: string, owner: string): Promise<{ items: OnlinePrompt[]; at: number } | null> {
  try {
    const db = await openCanvasDb(owner)
    const rec = await new Promise<any>((resolve, reject) => {
      if (!db.objectStoreNames.contains('online-prompts')) { resolve(null); return }
      const tx = db.transaction('online-prompts', 'readonly')
      const r = tx.objectStore('online-prompts').get(key)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    db.close()
    return rec || null
  } catch { return null }
}

async function cacheSet(key: string, items: OnlinePrompt[], at: number, owner: string) {
  try {
    const db = await openCanvasDb(owner)
    await new Promise<void>((resolve, reject) => {
      if (!db.objectStoreNames.contains('online-prompts')) { resolve(); return }
      const tx = db.transaction('online-prompts', 'readwrite')
      tx.objectStore('online-prompts').put({ id: key, items, at })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch { /* 缓存失败不影响功能 */ }
}

// 封面外链白名单:仅放行 https 且限定 GitHub 系静态 CDN 域,避免模板源注入任意外链
function allowedCover(u: unknown): string {
  if (typeof u !== 'string' || !u.startsWith('https://')) return ''
  try {
    const h = new URL(u).hostname
    if (h === 'raw.githubusercontent.com' || h === 'cdn.jsdelivr.net' || h === 'avatars.githubusercontent.com' || h.endsWith('.githubusercontent.com')) return u
  } catch { /* 无效 URL */ }
  return ''
}

/** 加载一个源(带 7 天缓存);带 force 时强制刷新 */
let epoch = 0
export async function loadSource(id: string, force = false) {
  const version = epoch, owner = sessionOwnerKey()
  const current = () => version === epoch && owner === sessionOwnerKey()
  const src = sources.value.find(s => s.id === id)
  if (!src) return
  // Select before loading so the first request exposes its progress and errors.
  // Pending responses may update their source, but must not change the selection.
  activeSourceId.value = id
  if (src.loading) return
  if (!force && src.items.length && Date.now() - src.loadedAt < CACHE_TTL) {
    return
  }
  if (!force) {
    const cached = await cacheGet(`online:${id}`, owner)
    if (!current()) return
    if (cached && Date.now() - cached.at < CACHE_TTL && cached.items?.length) {
      src.items = cached.items
      src.loadedAt = cached.at
      return
    }
  }
  src.loading = true
  src.error = ''
  try {
    const res = await fetch(`${BASE}/${src.file}`, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as Array<Partial<OnlinePrompt>>
    if (!current()) return
    const items = (data || [])
      .filter(p => p && p.title && p.prompt)
      .map(p => ({ id: p.id || `${id}:${p.title}`, sourceId: id, title: p.title!, prompt: p.prompt!, coverUrl: allowedCover(p.coverUrl) }))
    src.items = items
    src.loadedAt = Date.now()
    // IndexedDB cannot clone the reactive proxy exposed through src.items.
    void cacheSet(`online:${id}`, items, src.loadedAt, owner)
  } catch (e) {
    if (!current()) return
    src.error = e instanceof Error ? e.message : t('canvas.onlineLoadFailed')
  } finally {
    if (current()) src.loading = false
  }
}

export function rememberOnlinePrompt(p: OnlinePrompt): { name: string; category: string; content: string } {
  return { name: p.title.slice(0, 60), category: '在线收藏', content: p.prompt }
}

window.addEventListener('studio-session-ended', () => {
  epoch++
  sources.value = SOURCES.map(source => ({ ...source, items: [], loading: false, error: '', loadedAt: 0 }))
  activeSourceId.value = ''
  onlineSearch.value = ''
})
