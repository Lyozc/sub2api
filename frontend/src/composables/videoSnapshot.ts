import { openStudioHistoryDb } from './studioHistory'
import { StudioSessionChangedError } from './studioSession'
import type { VideoTask } from './useVideoStudioEngine'

export interface VideoConversation { id: string; title: string; createdAt: number; draft: string }
export type SavedTask = Omit<VideoTask, 'blob' | 'videoUrl' | 'owner' | 'sessionEpoch'>
export interface Snapshot {
  conversations: VideoConversation[]
  activeId: string
  tasks: SavedTask[]
  deletedTasks?: number[]
  deletedConversations?: string[]
}
type RecordPatch<T> = { id: string | number; fields: Partial<T>; unset: string[] }
export interface SnapshotDelta {
  conversations: RecordPatch<VideoConversation>[]
  tasks: RecordPatch<SavedTask>[]
  deletedTasks: number[]
  deletedConversations: string[]
  activeId?: string
}
const KEY = 'video-conversations-v2'
const LEGACY_KEY = 'video-conversations-v1'
export const emptySnapshot = (): Snapshot => ({ conversations: [], tasks: [], activeId: '' })
function fingerprint(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item: unknown) => item instanceof Blob
    ? { size: item.size, type: item.type, ...(item instanceof File ? { name: item.name, lastModified: item.lastModified } : {}) }
    : item)
}
function changes<T extends object>(before: T[], after: T[], id: (record: T) => string | number): RecordPatch<T>[] {
  const previous = new Map(before.map(record => [id(record), record]))
  return after.flatMap(record => {
    const old = previous.get(id(record)) as Record<string, unknown> | undefined
    const fields: Record<string, unknown> = {}, unset: string[] = []
    for (const [key, value] of Object.entries(record)) {
      if (!old || fingerprint(old[key]) !== fingerprint(value)) {
        if (value === undefined) unset.push(key)
        else fields[key] = value
      }
    }
    for (const key of Object.keys(old || {})) if (!(key in record)) unset.push(key)
    return Object.keys(fields).length || unset.length ? [{ id: id(record), fields: fields as Partial<T>, unset }] : []
  })
}
export function snapshotDelta(before: Snapshot, after: Snapshot): SnapshotDelta {
  return {
    conversations: changes(before.conversations, after.conversations, item => item.id),
    tasks: changes(before.tasks, after.tasks, item => item.taskId),
    deletedTasks: before.tasks.filter(old => !after.tasks.some(item => item.taskId === old.taskId)).map(item => item.taskId),
    deletedConversations: before.conversations.filter(old => !after.conversations.some(item => item.id === old.id)).map(item => item.id),
    ...(before.activeId === after.activeId ? {} : { activeId: after.activeId }),
  }
}
export function hasSnapshotChanges(delta: SnapshotDelta) {
  return delta.tasks.length || delta.conversations.length || delta.deletedTasks.length || delta.deletedConversations.length || delta.activeId !== undefined
}
export function mergeSnapshot(current: Snapshot, delta: SnapshotDelta): Snapshot {
  const deletedTasks = new Set([...current.deletedTasks || [], ...delta.deletedTasks])
  const deletedConversations = new Set([...current.deletedConversations || [], ...delta.deletedConversations])
  function apply<T extends object>(records: T[], patches: RecordPatch<T>[], deleted: Set<string | number>, id: (item: T) => string | number) {
    const merged = new Map<string | number, T>(records.map(item => [id(item), { ...item }]))
    for (const patch of patches) {
      if (deleted.has(patch.id)) continue
      const item = { ...merged.get(patch.id), ...patch.fields } as Record<string, unknown>
      for (const key of patch.unset) delete item[key]
      merged.set(patch.id, item as T)
    }
    return [...merged.values()].filter(item => !deleted.has(id(item)))
  }
  return {
    conversations: apply(current.conversations, delta.conversations, deletedConversations, item => item.id),
    tasks: apply(current.tasks, delta.tasks, deletedTasks, item => item.taskId),
    activeId: delta.activeId ?? current.activeId,
    deletedTasks: [...deletedTasks], deletedConversations: [...deletedConversations],
  }
}

// IndexedDB serializes overlapping readwrite transactions across windows. Read
// the latest document and apply only locally changed fields inside that transaction.
// Migrate once to v2 so an older open window cannot overwrite merged records.
export async function videoSnapshotStorage(owner: string, deltas: SnapshotDelta[] = [], current = () => true): Promise<Snapshot> {
  const db = await openStudioHistoryDb('video', owner)
  try {
    if (!current()) throw new StudioSessionChangedError()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('metadata', 'readwrite')
      const store = tx.objectStore('metadata'), request = store.get(KEY)
      const legacy = store.get(LEGACY_KEY)
      let result = emptySnapshot()
      const abort = () => { if (!current()) tx.abort() }
      window.addEventListener('studio-session-ended', abort)
      const cleanup = () => window.removeEventListener('studio-session-ended', abort)
      legacy.onsuccess = () => {
        if (!current()) { tx.abort(); return }
        result = request.result || legacy.result || emptySnapshot()
        for (const delta of deltas) result = mergeSnapshot(result, delta)
        if (deltas.length || !request.result) store.put(result, KEY)
      }
      tx.oncomplete = () => { cleanup(); resolve(result) }
      tx.onabort = () => { cleanup(); reject(tx.error || new StudioSessionChangedError()) }
      tx.onerror = () => { /* onabort settles the operation */ }
    })
  } finally { db.close() }
}
