import { Blob as NodeBlob } from 'node:buffer'
import { IDBFactory } from 'fake-indexeddb'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../videoFirstFrame', () => ({ prepareVideoFirstFrame: vi.fn(async (file: File) => file), VideoFrameError: class extends Error {} }))
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }))

async function write(store: 'metadata' | 'history', value: unknown, key?: string) {
  const { openStudioHistoryDb } = await import('../studioHistory')
  const db = await openStudioHistoryDb('video', 'user-1')
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}

const task = (extra = {}) => ({
  taskId: 123, remoteId: 'existing-job', status: 'processing' as const,
  prompt: 'a quiet ocean', model: 'kling-v2-6', groupId: 20, seconds: 5,
  resolution: '720p', videoSize: '720x1280', mode: 't2v' as const,
  submittedAt: 1234, conversationId: 'chat-1', ...extra,
})
const snapshot = (tasks: unknown[]) => ({
  conversations: [{ id: 'chat-1', title: 'Ocean', draft: 'make it sunset', createdAt: 1234 }],
  activeId: 'chat-1', tasks,
})

describe('video conversations', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    localStorage.setItem('auth_user', JSON.stringify({ id: 1 }))
    localStorage.setItem('auth_token', 'test-token')
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('Blob', NodeBlob)
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn().mockReturnValue('blob:local-video')
      static revokeObjectURL = vi.fn()
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  })
  afterEach(() => {
    window.dispatchEvent(new Event('studio-session-ended'))
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows storage failure without an unhandled rejection, then retries initialization', async () => {
    const chats = await import('../useVideoStudioConversations')
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('Storage disabled', 'SecurityError') })
    await expect(chats.initVideoConversations()).resolves.toBeUndefined()
    expect(chats.conversationsReady.value).toBe(false)
    expect(chats.conversationInitError.value).toBe('videoStudio.storageInitFailed')
    expect(fetch).not.toHaveBeenCalled()
    open.mockRestore()
    await chats.initVideoConversations()
    expect(chats.conversationsReady.value).toBe(true)
    expect(chats.conversationInitError.value).toBe('')
  })

  it('retries unsaved edits after a storage write fails', async () => {
    const chats = await import('../useVideoStudioConversations')
    const engine = await import('../useVideoStudioEngine')
    await chats.initVideoConversations()
    await chats.persistConversations()
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('Storage temporarily blocked', 'SecurityError') })
    engine.prompt.value = 'draft must survive retry'
    await nextTick()
    await chats.persistConversations()
    expect(chats.conversationStorageError.value).toBe(true)
    open.mockRestore()
    await chats.persistConversations()
    expect(chats.conversationStorageError.value).toBe(false)
    window.dispatchEvent(new Event('studio-session-ended'))
    await chats.initVideoConversations()
    expect(engine.prompt.value).toBe('draft must survive retry')
  })

  it('delivers a library prompt after first conversation restoration', async () => {
    await write('metadata', snapshot([]), 'video-conversations-v1')
    const chats = await import('../useVideoStudioConversations')
    const engine = await import('../useVideoStudioEngine')
    expect(await chats.applyVideoPrompt('library prompt')).toBe(true)
    expect(engine.prompt.value).toBe('library prompt')
    expect(chats.activeConversation.value?.draft).toBe('library prompt')
  })

  it('does not download an intentionally deleted asset even if a stale snapshot restores it', async () => {
    await write('metadata', snapshot([task({ status: 'done', historyId: 123 })]), 'video-conversations-v1')
    await write('metadata', true, 'deleted-asset:123')
    const chats = await import('../useVideoStudioConversations')
    const engine = await import('../useVideoStudioEngine')
    await chats.initVideoConversations()
    expect(engine.tasks.value[0].assetDeleted).toBe(true)
    expect(engine.tasks.value[0].archived).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps independent drafts and restores them after reload', async () => {
    const chats = await import('../useVideoStudioConversations')
    const engine = await import('../useVideoStudioEngine')
    await chats.initVideoConversations()
    const first = chats.activeConversationId.value
    engine.prompt.value = 'first draft'
    const second = chats.newVideoConversation().id
    engine.prompt.value = 'second draft'
    chats.selectVideoConversation(first)
    expect(engine.prompt.value).toBe('first draft')
    await nextTick()
    await chats.persistConversations()

    window.dispatchEvent(new Event('studio-session-ended'))
    await chats.initVideoConversations()
    expect(chats.activeConversationId.value).toBe(first)
    expect(engine.prompt.value).toBe('first draft')
    chats.selectVideoConversation(second)
    expect(engine.prompt.value).toBe('second draft')
  })

  it('restores a pending job without submitting and resumes its original group', async () => {
    await write('metadata', snapshot([task()]), 'video-conversations-v1')
    const chats = await import('../useVideoStudioConversations')
    await chats.initVideoConversations()
    expect(chats.conversationTasks.value[0].remoteId).toBe('existing-job')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    const calls = vi.mocked(fetch).mock.calls
    expect(calls.every(([, options]) => options?.method !== 'POST')).toBe(true)
    expect(calls[0][1]?.headers).toMatchObject({ 'X-Video-Studio-Group': '20' })
  })

  it.each([true, false])('restores completed videos without copying bytes when metadata has history ID: %s', async hasHistoryId => {
    await write('history', {
      id: 456, ts: 1234, model: 'kling-v2-6', prompt: 'a quiet ocean',
      seconds: 5, resolution: '720p', sizeMB: 1, starred: false,
      blob: new Blob(['video'], { type: 'video/mp4' }), conversationId: 'chat-1', taskId: 123,
    })
    await write('metadata', snapshot([task({ status: 'done', historyId: hasHistoryId ? 456 : undefined })]), 'video-conversations-v1')
    const chats = await import('../useVideoStudioConversations')
    await chats.initVideoConversations()
    expect(chats.conversationTasks.value).toHaveLength(1)
    expect(chats.conversationTasks.value[0]).toMatchObject({ status: 'done', historyId: 456, videoUrl: 'blob:local-video' })
    await chats.persistConversations()
    const { openStudioHistoryDb } = await import('../studioHistory')
    const db = await openStudioHistoryDb('video', 'user-1')
    const saved = await new Promise<{ tasks: Record<string, unknown>[] }>(resolve => {
      const req = db.transaction('metadata').objectStore('metadata').get('video-conversations-v2')
      req.onsuccess = () => resolve(req.result)
    })
    db.close()
    expect(saved.tasks[0]).not.toHaveProperty('blob')
    expect(saved.tasks[0]).not.toHaveProperty('videoUrl')
    expect(saved.tasks[0].historyId).toBe(456)
  })

  it('sends one message with the chosen group and clears only an accepted draft', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'invalid request' }) } as Response)
    const chats = await import('../useVideoStudioConversations')
    const engine = await import('../useVideoStudioEngine')
    await chats.initVideoConversations()
    engine.models.value = [10, 20].map(group_id => ({ id: 'kling-v2-6', group_id, group_name: String(group_id) }))
    engine.model.value = 'kling-v2-6'
    engine.modelGroupId.value = 20
    engine.seconds.value = 5
    engine.prompt.value = 'a quiet ocean'
    expect(chats.sendVideoMessage()).toBe(true)
    expect(engine.prompt.value).toBe('')
    expect(chats.activeConversation.value?.title).toBe('a quiet ocean')
    expect(chats.conversationTasks.value[0]).toMatchObject({ groupId: 20, prompt: 'a quiet ocean' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    const options = vi.mocked(fetch).mock.calls[0][1]
    expect(options?.headers).toMatchObject({ 'X-Video-Studio-Group': '20' })
    await vi.waitFor(() => expect(engine.generating.value).toBe(false))
    engine.prompt.value = 'keep this draft'
    engine.modelGroupId.value = 999
    expect(chats.sendVideoMessage()).toBe(false)
    expect(engine.prompt.value).toBe('keep this draft')
    expect(chats.conversationTasks.value).toHaveLength(1)
  })

  it('filters unsupported Kling parameters and keeps the accepted task snapshot', async () => {
    const chats = await import('../useVideoStudioConversations')
    const engine = await import('../useVideoStudioEngine')
    await chats.initVideoConversations()
    engine.models.value = [{ id: 'kling-v4', group_id: 20, group_name: 'Kling' }]
    engine.model.value = 'kling-v4'
    engine.modelGroupId.value = 20
    engine.seconds.value = 23
    engine.prompt.value = 'a quiet ocean'
    engine.klingSettings.value = { mode: 'pro', resolution: '1080p', sound: 'on', negativePrompt: 'blur', cfgScale: 0 }
    engine.videoSize.value = '2520x1080'
    expect(chats.sendVideoMessage()).toBe(true)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(payload).toMatchObject({ duration: 23, aspect_ratio: '21:9', resolution: '1080p' })
    for (const key of ['mode','sound','negative_prompt','cfg_scale']) expect(payload).not.toHaveProperty(key)
    engine.klingSettings.value.mode = 'std'
    expect(chats.conversationTasks.value[0].klingSettings?.mode).toBe('std')
    await nextTick()
    await chats.persistConversations()
    window.dispatchEvent(new Event('studio-session-ended'))
    await chats.initVideoConversations()
    expect(chats.conversationTasks.value[0].klingSettings).toMatchObject({ mode: 'std', resolution: '1080p', cfgScale: null })
    expect(chats.conversationTasks.value[0].seconds).toBe(23)
  })

  it.each([
    ['grok-imagine-video', '1080p'],
    ['kling-v4', '4k'],
    ['kling-v4-flash', '1080p'],
  ] as const)('blocks unsupported %s resolution %s before creating or sending tasks', async (model, selectedResolution) => {
    const engine = await import('../useVideoStudioEngine')
    const chats = await import('../useVideoStudioConversations')
    await chats.initVideoConversations()
    engine.models.value = [{ id: model, group_id: 20, group_name: 'Video' }]
    engine.model.value = model
    engine.modelGroupId.value = 20
    engine.prompt.value = 'preserve this draft'
    if (model.startsWith('kling')) engine.klingSettings.value.resolution = selectedResolution as '1080p' | '4k'
    else engine.resolution.value = selectedResolution as '1080p'
    expect(chats.sendVideoMessage()).toBe(false)
    expect(engine.prompt.value).toBe('preserve this draft')
    expect(engine.tasks.value).toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts custom seconds and preserves the draft when seconds are invalid', async () => {
    const engine = await import('../useVideoStudioEngine')
    expect(engine.validVideoDuration(7)).toBe(true)
    for (const seconds of [0, -1, 1.5, NaN, Infinity, '']) expect(engine.validVideoDuration(seconds)).toBe(false)
    for (const seconds of [6, 7, 15, 23, 30]) expect(engine.validVideoDuration(seconds)).toBe(true)
    const chats = await import('../useVideoStudioConversations')
    await chats.initVideoConversations()
    engine.model.value = 'kling-v4'
    engine.seconds.value = 1.5
    engine.prompt.value = 'preserve this draft'
    expect(chats.sendVideoMessage()).toBe(false)
    expect(engine.prompt.value).toBe('preserve this draft')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('creates the chosen number of independent tasks and rejects invalid counts', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'invalid request' }) } as Response)
    const engine = await import('../useVideoStudioEngine')
    const chats = await import('../useVideoStudioConversations')
    await chats.initVideoConversations()
    engine.models.value = [{ id: 'kling-v4', group_id: 20, group_name: 'Kling' }]
    engine.model.value = 'kling-v4'
    engine.modelGroupId.value = 20
    engine.seconds.value = 23
    engine.prompt.value = 'three shots'
    for (const count of [0, -1, 1.5, 5, NaN, Infinity]) {
      engine.quantity.value = count
      expect(chats.sendVideoMessage()).toBe(false)
      expect(engine.prompt.value).toBe('three shots')
    }
    expect(fetch).not.toHaveBeenCalled()
    engine.quantity.value = 3
    expect(chats.sendVideoMessage()).toBe(true)
    expect(chats.conversationTasks.value).toHaveLength(3)
    expect(new Set(chats.conversationTasks.value.map(task => task.taskId)).size).toBe(3)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(JSON.parse(String(call[1]?.body))).toMatchObject({ duration: 23, model: 'kling-v4' })
    }
  })

  it('reuses request parameters without generating until the user submits', async () => {
    const chats = await import('../useVideoStudioConversations')
    const engine = await import('../useVideoStudioEngine')
    await chats.initVideoConversations()
    const reference = new File(['image'], 'frame.png', { type: 'image/png' })
    await chats.reuseVideoTask(task({ refImage: reference, mode: 'i2v', klingSettings: { mode: 'pro', resolution: '4k', sound: 'on', negativePrompt: 'blur', cfgScale: 0 } }))
    expect(engine.prompt.value).toBe('a quiet ocean')
    expect(engine.modelGroupId.value).toBe(20)
    expect(engine.videoSize.value).toBe('720x1280')
    expect(engine.seconds.value).toBe(5)
    expect(engine.klingSettings.value).toEqual({ mode: 'pro', resolution: '4k', sound: 'on', negativePrompt: 'blur', cfgScale: 0 })
    expect(engine.refImages.value[0].file).toBe(reference)
    expect(engine.mode.value).toBe('i2v')
    expect(fetch).not.toHaveBeenCalled()
    engine.removeRefImage(0)
    expect(engine.mode.value).toBe('t2v')
  })

  it('preserves an unavailable original group when refreshing model choices', async () => {
    const engine = await import('../useVideoStudioEngine')
    engine.model.value = 'kling-v2-6'
    engine.modelGroupId.value = 20
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ data: [
      { id: 'kling-v2-6', group_id: 10, group_name: 'other group' },
    ] }) } as Response)
    await engine.loadModels()
    expect(engine.modelGroupId.value).toBe(20)
    engine.prompt.value = 'keep the original routing'
    expect(engine.submitBatch()).toEqual([])
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
  })

  it('removes a conversation while retaining its completed video in the library', async () => {
    const chats = await import('../useVideoStudioConversations')
    const engine = await import('../useVideoStudioEngine')
    await chats.initVideoConversations()
    const id = chats.activeConversationId.value
    engine.history.value = [{ id: 456, conversationId: id, taskId: 123, ts: 1, model: 'kling', prompt: 'ocean', seconds: 5, resolution: '720p', blob: new Blob(['video']), sizeMB: 1, starred: false }]
    chats.importVideoHistory()
    chats.deleteVideoConversation(id)
    chats.importVideoHistory()
    expect(engine.history.value).toHaveLength(1)
    expect(engine.tasks.value).toHaveLength(0)
    expect(chats.conversations.value.some(c => c.id === id)).toBe(false)
  })

  it('does not expose another account’s conversations', async () => {
    const chats = await import('../useVideoStudioConversations')
    const engine = await import('../useVideoStudioEngine')
    await chats.initVideoConversations()
    engine.prompt.value = 'private draft'
    await nextTick()
    await chats.persistConversations()
    window.dispatchEvent(new Event('studio-session-ended'))
    localStorage.setItem('auth_user', JSON.stringify({ id: 2 }))
    await chats.initVideoConversations()
    expect(engine.prompt.value).toBe('')
    expect(chats.conversationTasks.value).toEqual([])
    expect(chats.conversations.value).toHaveLength(1)
    expect(chats.conversations.value[0].draft).toBe('')
  })

  it('recovers a lost acknowledgement using only the original receipt after reload', async () => {
    await write('metadata', snapshot([task({ remoteId: '', status: 'pending', submissionKey: '123-original' })]), 'video-conversations-v1')
    const fetcher = vi.fn(async (url: string) => url.includes('/submissions/')
      ? { ok: true, json: async () => ({ id: 'recovered-job' }) }
      : { ok: true, json: async () => ({ status: 'failed', error: 'mock terminal failure' }) })
    vi.stubGlobal('fetch', fetcher)
    const chats = await import('../useVideoStudioConversations')
    await chats.initVideoConversations()
    await vi.waitFor(() => expect(chats.conversationTasks.value[0].remoteId).toBe('recovered-job'))
    expect(fetcher.mock.calls[0][0]).toContain('/submissions/123-original')
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true)
  })

  it('keeps tracking an archived conversation until the original video reaches the library', async () => {
    const chats = await import('../useVideoStudioConversations')
    const engine = await import('../useVideoStudioEngine')
    await chats.initVideoConversations()
    const id = chats.activeConversationId.value
    engine.tasks.value = [task({ status: 'failed', conversationId: id })]
    const fetcher = vi.fn(async (url: string) => url.endsWith('/content')
      ? { ok: true, blob: async () => new Blob(['video'], { type: 'video/mp4' }) }
      : { ok: true, json: async () => ({ status: 'completed' }) })
    vi.stubGlobal('fetch', fetcher)
    engine.retryTask(123)
    chats.deleteVideoConversation(id)
    expect(engine.tasks.value[0].archived).toBe(true)
    expect(chats.conversationTasks.value).toHaveLength(0)
    await vi.waitFor(() => expect(engine.history.value).toHaveLength(1))
    expect(engine.history.value[0].conversationId).toBe(id)
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true)
  })

})
