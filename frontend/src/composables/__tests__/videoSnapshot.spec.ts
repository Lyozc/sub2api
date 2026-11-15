import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { emptySnapshot, snapshotDelta, videoSnapshotStorage, type Snapshot } from '../videoSnapshot'

const conversation = (id: string) => ({ id, title: '', draft: '', createdAt: 1 })
const task = (id: number, conversationId: string) => ({ taskId: id, conversationId, remoteId: `job-${id}`, status: 'processing' as const, prompt: 'ocean', model: 'grok-imagine-video', seconds: 6, resolution: '720p', submittedAt: id })
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(() => vi.unstubAllGlobals())

describe('video persistence across independent windows', () => {
  it('migrates old tasks once and protects them from an old window’s replacement snapshot', async () => {
    const { openStudioHistoryDb } = await import('../studioHistory')
    const db = await openStudioHistoryDb('video', 'user-1')
    const initial: Snapshot = { activeId: 'a', conversations: [conversation('a')], tasks: [task(1, 'a')] }
    const writeLegacy = (value: Snapshot) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction('metadata', 'readwrite')
      tx.objectStore('metadata').put(value, 'video-conversations-v1')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
    await writeLegacy(initial)
    expect((await videoSnapshotStorage('user-1')).tasks).toHaveLength(1)
    await writeLegacy(emptySnapshot())
    expect((await videoSnapshotStorage('user-1')).tasks[0].remoteId).toBe('job-1')
    db.close()
  })

  it('preserves both submitted jobs when empty windows commit concurrently', async () => {
    const a: Snapshot = { activeId: 'a', conversations: [conversation('a')], tasks: [task(1, 'a')] }
    const b: Snapshot = { activeId: 'b', conversations: [conversation('b')], tasks: [task(2, 'b')] }
    await Promise.all([videoSnapshotStorage('user-1', [snapshotDelta(emptySnapshot(), a)]), videoSnapshotStorage('user-1', [snapshotDelta(emptySnapshot(), b)])])
    const saved = await videoSnapshotStorage('user-1')
    expect(saved.tasks.map(task => task.remoteId).sort()).toEqual(['job-1', 'job-2'])
    expect(saved.conversations).toHaveLength(2)
  })

  it('retains a completion receipt when a stale window edits a different field', async () => {
    const initial: Snapshot = { activeId: 'a', conversations: [conversation('a')], tasks: [task(1, 'a')] }
    await videoSnapshotStorage('user-1', [snapshotDelta(emptySnapshot(), initial)])
    const completed: Snapshot = { ...initial, tasks: [{ ...initial.tasks[0], status: 'done', historyId: 5, upstreamDone: true }] }
    const stale: Snapshot = { ...initial, tasks: [{ ...initial.tasks[0], archived: true }] }
    await videoSnapshotStorage('user-1', [snapshotDelta(initial, completed)])
    await videoSnapshotStorage('user-1', [snapshotDelta(initial, stale)])
    expect((await videoSnapshotStorage('user-1')).tasks[0]).toMatchObject({ status: 'done', historyId: 5, upstreamDone: true, archived: true })
  })

  it('does not recreate a deleted task from another window’s late edit', async () => {
    const initial: Snapshot = { activeId: 'a', conversations: [conversation('a')], tasks: [task(1, 'a')] }
    await videoSnapshotStorage('user-1', [snapshotDelta(emptySnapshot(), initial)])
    await videoSnapshotStorage('user-1', [snapshotDelta(initial, { ...initial, tasks: [] })])
    await videoSnapshotStorage('user-1', [snapshotDelta(initial, { ...initial, tasks: [{ ...initial.tasks[0], status: 'done' }] })])
    expect((await videoSnapshotStorage('user-1')).tasks).toEqual([])
  })
})
