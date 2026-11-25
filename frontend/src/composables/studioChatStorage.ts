import { StudioSessionChangedError } from './studioSession'

export interface StudioChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: 'done' | 'streaming' | 'stopped' | 'failed'
  model?: string
  startedAt?: number
  error?: string
  clientRequestId?: string
}
export interface StudioChatConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  revision: number
  draft: string
  messages: StudioChatMessage[]
}
export class StudioChatConflictError extends Error {
  constructor() { super('Chat changed in another window'); this.name = 'StudioChatConflictError' }
}

function open(owner: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`studio-text-chat-db-${owner}`, 1)
    let blocked = false
    req.onupgradeneeded = () => req.result.createObjectStore('conversations', { keyPath: 'id' })
    req.onsuccess = () => {
      if (blocked) { req.result.close(); return }
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => { blocked = true; reject(new Error('Browser storage is blocked')) }
  })
}

export async function loadStudioChatHistory(owner: string, current: () => boolean): Promise<StudioChatConversation[]> {
  const db = await open(owner)
  try {
    if (!current()) throw new StudioSessionChangedError()
    const rows = await new Promise<Array<StudioChatConversation & { deleted?: boolean }>>((resolve, reject) => {
      const req = db.transaction('conversations').objectStore('conversations').getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    if (!current()) throw new StudioSessionChangedError()
    return rows.filter(row => !row.deleted && typeof row.id === 'string' && Array.isArray(row.messages))
      .map(row => ({ ...row, draft: row.draft || '', messages: row.messages.map(message => message.status === 'streaming' ? { ...message, status: 'stopped' as const } : message) }))
  } finally { db.close() }
}

/** Compare and write one conversation atomically. Tombstones prevent revival. */
export async function saveStudioChatConversation(owner: string, conversation: StudioChatConversation, current: () => boolean, deleted = false): Promise<number> {
  // Use plain structured data, not Vue proxies. API keys are never part of this type.
  const value = JSON.parse(JSON.stringify(conversation)) as StudioChatConversation
  const db = await open(owner)
  try {
    if (!current()) throw new StudioSessionChangedError()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readwrite'), store = tx.objectStore('conversations')
      let failure: Error | undefined
      const abort = () => { failure = new StudioSessionChangedError(); tx.abort() }
      window.addEventListener('studio-session-ended', abort)
      const request = store.get(value.id)
      request.onsuccess = () => {
        if (!current()) { abort(); return }
        if (request.result?.deleted || (request.result?.revision || 0) !== value.revision) {
          failure = new StudioChatConflictError(); tx.abort(); return
        }
        store.put(deleted
          ? { id: value.id, revision: value.revision + 1, deleted: true }
          : { ...value, revision: value.revision + 1 })
      }
      tx.oncomplete = () => { window.removeEventListener('studio-session-ended', abort); resolve(value.revision + 1) }
      tx.onabort = () => { window.removeEventListener('studio-session-ended', abort); reject(failure || tx.error || new Error('Unable to save chat')) }
      tx.onerror = () => { /* onabort settles */ }
    })
  } finally { db.close() }
}
