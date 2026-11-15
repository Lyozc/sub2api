import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('indexedDB', new IDBFactory())
  localStorage.clear()
  localStorage.setItem('auth_user', JSON.stringify({ id: 1 }))
})
afterEach(() => {
  window.dispatchEvent(new Event('studio-session-ended'))
  vi.unstubAllGlobals()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

const response = (title: string) => ({ ok: true, json: async () => [{ title, prompt: `${title} prompt` }] })

describe('online prompt source selection', () => {
  it('exposes the first loading failure and recovers with a retry', async () => {
    const pending = deferred<{ ok: boolean; status: number }>()
    const fetcher = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response('recovered'))
    vi.stubGlobal('fetch', fetcher)
    const online = await import('../useOnlinePrompts')
    const id = online.SOURCES[0].id
    const loading = online.loadSource(id, true)
    expect(online.activeSource.value?.id).toBe(id)
    expect(online.activeSource.value?.loading).toBe(true)
    pending.resolve({ ok: false, status: 503 })
    await loading
    expect(online.activeSource.value?.error).toBe('HTTP 503')
    expect(online.activeSource.value?.loading).toBe(false)
    await online.loadSource(id, true)
    expect(online.activeSource.value?.error).toBe('')
    expect(online.filteredOnline.value[0].title).toBe('recovered')
  })

  it('keeps the selected source when an earlier network response arrives late', async () => {
    const first = deferred<ReturnType<typeof response>>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(response('second')))
    const online = await import('../useOnlinePrompts')
    const loading = online.loadSource(online.SOURCES[0].id, true)
    await online.loadSource(online.SOURCES[1].id, true)
    first.resolve(response('first'))
    await loading
    expect(online.activeSourceId.value).toBe(online.SOURCES[1].id)
    expect(online.filteredOnline.value[0].title).toBe('second')
    expect(online.sources.value[0].items[0].title).toBe('first')
  })

  it('can return to a source that is still loading without sending another request', async () => {
    const first = deferred<ReturnType<typeof response>>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(response('second')))
    const online = await import('../useOnlinePrompts')
    const loading = online.loadSource(online.SOURCES[0].id, true)
    await online.loadSource(online.SOURCES[1].id, true)
    await online.loadSource(online.SOURCES[0].id, true)
    expect(online.activeSource.value?.id).toBe(online.SOURCES[0].id)
    expect(online.activeSource.value?.loading).toBe(true)
    first.resolve(response('first'))
    await loading
    expect(online.filteredOnline.value[0].title).toBe('first')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('discards a response when the account changes during loading', async () => {
    const pending = deferred<ReturnType<typeof response>>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise))
    const online = await import('../useOnlinePrompts')
    const loading = online.loadSource(online.SOURCES[0].id, true)
    localStorage.setItem('auth_user', JSON.stringify({ id: 2 }))
    window.dispatchEvent(new Event('studio-session-ended'))
    pending.resolve(response('private to old account'))
    await loading
    expect(online.activeSource.value).toBe(null)
    expect(online.sources.value.every(source => !source.items.length && !source.loading)).toBe(true)
  })

  it('stores cloneable templates and reuses the cache after memory is cleared', async () => {
    const fetcher = vi.fn().mockResolvedValue(response('cached'))
    vi.stubGlobal('fetch', fetcher)
    const online = await import('../useOnlinePrompts')
    const { openCanvasDb } = await import('../canvasStorage')
    const id = online.SOURCES[0].id
    await online.loadSource(id, true)
    await expect.poll(async () => {
      const db = await openCanvasDb()
      try {
        return await new Promise<number>((resolve, reject) => {
          const request = db.transaction('online-prompts').objectStore('online-prompts').count()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      } finally { db.close() }
    }).toBe(1)
    online.sources.value[0].items = []
    online.sources.value[0].loadedAt = 0
    await online.loadSource(id)
    expect(online.filteredOnline.value[0].title).toBe('cached')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
