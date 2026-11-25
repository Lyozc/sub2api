import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { reactive } from 'vue'
import { readStudioChatResponse } from '../studioChatStream'
import { loadStudioChatHistory, saveStudioChatConversation, StudioChatConflictError, type StudioChatConversation } from '../studioChatStorage'

vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))
const h = vi.hoisted(() => ({ keys: vi.fn(), models: vi.fn() }))
vi.mock('../useAIPrompt', () => ({ listStudioKeys: h.keys, listChatModelsForKey: h.models }))
function conversation(id = 'one'): StudioChatConversation {
  return { id, title: 'Test', createdAt: 1, updatedAt: 1, draft: '', revision: 0, messages: [{ id: 'm', role: 'user', content: 'private content', status: 'done' }] }
}
function stream(text: string, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize)); controller.close() } }), { headers: { 'content-type': 'text/event-stream' } })
}
function openChatStream() {
  const encoder = new TextEncoder()
  let sink: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { sink = controller }, cancel
  }), { headers: { 'content-type': 'text/event-stream' } })
  return { response, cancel, write: (text: string) => sink.enqueue(encoder.encode(text)) }
}
const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
const jsonReply = (content = 'Reply') => Response.json({ choices: [{ message: { content } }] })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }

beforeEach(() => {
  vi.resetModules(); localStorage.clear(); localStorage.setItem('auth_user', JSON.stringify({ id: 1 })); localStorage.setItem('auth_token', 'jwt-user-one')
  vi.stubGlobal('indexedDB', new IDBFactory())
  h.keys.mockReset().mockResolvedValue([{ id: 7, name: 'My key', key: 'never-save-this-key' }, { id: 8, name: 'Other key', key: 'second-secret' }])
  h.models.mockReset().mockResolvedValue(['chat-model', 'other-model'])
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonReply()))
})
afterEach(() => { window.dispatchEvent(new Event('studio-session-ended')); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('chat response parsing', () => {
  it('joins split UTF-8, CRLF, comments and multiple data lines', async () => {
    const text = ': heartbeat\r\n\r\n' + delta('你好🌱').replace(/\n/g, '\r\n') + 'data: {"choices":\ndata: [{"delta":{"content":" world"}}]}\n\ndata: [DONE]'
    let output = ''
    await readStudioChatResponse(stream(text), value => { output += value }, new AbortController().signal)
    expect(output).toBe('你好🌱 world')
  })
  it('accepts a finish reason without a DONE event', async () => {
    let output = ''
    await readStudioChatResponse(stream(delta('Hello') + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'), value => { output += value }, new AbortController().signal)
    expect(output).toBe('Hello')
  })
  it('reads usage frames after the finish reason through to DONE', async () => {
    const chunks = [delta('Hello'), 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', 'data: {"choices":[],"usage":{"total_tokens":12}}\n\n', 'data: [DONE]\n\n']
    let reads = 0
    const response = new Response(new ReadableStream({ pull(controller) { reads++; const text = chunks.shift(); if (text) controller.enqueue(new TextEncoder().encode(text)); else controller.close() } }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream' } })
    await readStudioChatResponse(response, vi.fn(), new AbortController().signal)
    expect(reads).toBe(4)
  })
  it('accepts JSON completion fallbacks and text content arrays', async () => {
    const append = vi.fn()
    await readStudioChatResponse(Response.json({ choices: [{ message: { content: [{ type: 'text', text: 'Hello' }] } }] }), append, new AbortController().signal)
    expect(append).toHaveBeenCalledWith('Hello')
  })
  it('accepts a complete chat response after SSE keepalives without duplicating streamed text', async () => {
    const snapshot = `data: ${JSON.stringify({ choices: [{ message: { content: '完整答案' } }] })}\n\n`
    for (const preceding of [': waiting\n\n', delta('完整答案')]) {
      const append = vi.fn()
      await readStudioChatResponse(stream(preceding + snapshot + 'data: [DONE]\n\n'), append, new AbortController().signal)
      expect(append.mock.calls).toEqual([['完整答案']])
    }
  })
  it('finishes a completed choice even when the provider keeps its connection open', async () => {
    vi.useFakeTimers()
    const upstream = openChatStream()
    const pending = readStudioChatResponse(upstream.response, vi.fn(), new AbortController().signal)
    upstream.write(delta('answer') + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')
    await vi.advanceTimersByTimeAsync(6000)
    await pending
    expect(upstream.cancel).toHaveBeenCalledOnce()
  })
  it('surfaces refusal text from streaming deltas, final messages, and JSON content parts', async () => {
    const responses = [
      stream('data: {"choices":[{"delta":{"refusal":"Unavailable"}}]}\n\ndata: [DONE]\n\n'),
      stream('data: {"choices":[{"message":{"content":null,"refusal":"Unavailable"}}]}\n\ndata: [DONE]\n\n'),
      Response.json({ choices: [{ message: { refusal: 'Unavailable' } }] }),
      Response.json({ choices: [{ message: { content: [{ type: 'refusal', refusal: 'Unavailable' }] } }] })
    ]
    for (const response of responses) {
      const append = vi.fn()
      await readStudioChatResponse(response, append, new AbortController().signal)
      expect(append.mock.calls).toEqual([['Unavailable']])
    }
  })
  it('retains partial text but rejects an incomplete stream', async () => {
    const append = vi.fn()
    await expect(readStudioChatResponse(stream(delta('partial')), append, new AbortController().signal)).rejects.toThrow('before completion')
    expect(append).toHaveBeenCalledWith('partial')
  })
  it('surfaces HTTP and streamed model errors without retrying', async () => {
    await expect(readStudioChatResponse(Response.json({ error: { message: 'No quota' } }, { status: 429 }), vi.fn(), new AbortController().signal)).rejects.toThrow('No quota')
    await expect(readStudioChatResponse(stream('data: {"error":{"message":"Upstream failed"}}\n\n'), vi.fn(), new AbortController().signal)).rejects.toThrow('Upstream failed')
  })
  it('cancels pending reads when stopped', async () => {
    const controller = new AbortController(), cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } })
    const pending = readStudioChatResponse(response, vi.fn(), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
  })
})

describe('chat history persistence', () => {
  it('stores reactive records as plain data and isolates account histories', async () => {
    const row = reactive(conversation())
    row.revision = await saveStudioChatConversation('user-1', row, () => true)
    expect((await loadStudioChatHistory('user-1', () => true))[0].messages[0].content).toBe('private content')
    expect(await loadStudioChatHistory('user-2', () => true)).toEqual([])
  })
  it('refuses stale updates from another window without losing the saved version', async () => {
    const first = conversation(), stale = conversation()
    first.revision = await saveStudioChatConversation('user-1', first, () => true)
    stale.title = 'Overwrite attempt'
    await expect(saveStudioChatConversation('user-1', stale, () => true)).rejects.toBeInstanceOf(StudioChatConflictError)
    expect((await loadStudioChatHistory('user-1', () => true))[0].title).toBe('Test')
  })
  it('keeps concurrent writes to different conversations', async () => {
    await Promise.all([saveStudioChatConversation('user-1', conversation('one'), () => true), saveStudioChatConversation('user-1', conversation('two'), () => true)])
    expect(await loadStudioChatHistory('user-1', () => true)).toHaveLength(2)
  })
  it('keeps deletion markers so a delayed save cannot restore a deleted chat', async () => {
    const row = conversation(); row.revision = await saveStudioChatConversation('user-1', row, () => true)
    await saveStudioChatConversation('user-1', row, () => true, true)
    await expect(saveStudioChatConversation('user-1', row, () => true)).rejects.toBeInstanceOf(StudioChatConflictError)
    expect(await loadStudioChatHistory('user-1', () => true)).toEqual([])
  })
  it('restores an interrupted streaming message as stopped', async () => {
    const row = conversation(); row.messages.push({ id: 'a', role: 'assistant', content: 'partial', status: 'streaming' })
    await saveStudioChatConversation('user-1', row, () => true)
    expect((await loadStudioChatHistory('user-1', () => true))[0].messages[1].status).toBe('stopped')
  })
  it('rejects writes after the authenticated session changes', async () => {
    await expect(saveStudioChatConversation('user-1', conversation(), () => false)).rejects.toMatchObject({ name: 'StudioSessionChangedError' })
    expect(await loadStudioChatHistory('user-1', () => true)).toHaveLength(0)
  })
})

describe('studio chat workflow', () => {
  it('sends continuous context and only key IDs, and saves messages without key material', async () => {
    const engine = await import('../useStudioChat'); await engine.initStudioChat()
    engine.activeChat.value!.draft = 'Hello'; await engine.sendChat()
    engine.activeChat.value!.draft = 'Follow up'; await engine.sendChat()
    expect(fetch).toHaveBeenCalledTimes(2)
    const body = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)
    expect(body).toEqual({ key_id: 7, model: 'chat-model', messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Reply' }, { role: 'user', content: 'Follow up' }] })
    const saved = await loadStudioChatHistory('user-1', () => true)
    expect(saved[0].messages).toHaveLength(4)
    expect(JSON.stringify(saved)).not.toContain('never-save-this-key')
  })
  it('keeps the request model and conversation when selections change during a reply', async () => {
    const pending = deferred<Response>(); vi.mocked(fetch).mockReturnValue(pending.promise)
    const engine = await import('../useStudioChat'); await engine.initStudioChat()
    engine.activeChat.value!.draft = 'First'; const id = engine.chatActiveId.value
    const sending = engine.sendChat(); await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    engine.newChat(); engine.selectChatModel('other-model'); pending.resolve(jsonReply('Original reply')); await sending
    expect(engine.activeChat.value!.messages).toHaveLength(0)
    expect(engine.chatConversations.value.find(row => row.id === id)!.messages[1]).toMatchObject({ content: 'Original reply', model: 'chat-model' })
  })
  it('runs replies for different conversations concurrently', async () => {
    const first = deferred<Response>(), second = deferred<Response>()
    let request = 0
    vi.mocked(fetch).mockImplementation(() => (++request === 1 ? first.promise : second.promise) as Promise<Response>)
    const engine = await import('../useStudioChat'); await engine.initStudioChat()
    const firstConversation = engine.activeChat.value!
    firstConversation.draft = 'First'
    const firstSending = engine.sendChat()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    engine.newChat()
    const secondConversation = engine.activeChat.value!
    secondConversation.draft = 'Second'
    const secondSending = engine.sendChat()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(engine.chatBusy.value).toBe(true)
    expect(engine.chatRunningIds.value).toEqual(expect.arrayContaining([firstConversation.id, secondConversation.id]))

    second.resolve(jsonReply('Reply two')); first.resolve(jsonReply('Reply one'))
    await Promise.all([firstSending, secondSending])
    expect(firstConversation.messages.at(-1)).toMatchObject({ content: 'Reply one', status: 'done' })
    expect(secondConversation.messages.at(-1)).toMatchObject({ content: 'Reply two', status: 'done' })
    expect(engine.chatBusy.value).toBe(false)
  })
  it('stops only the selected conversation while another reply continues', async () => {
    const second = deferred<Response>()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(delta('Partial first')))
    } }), { headers: { 'content-type': 'text/event-stream' } })).mockReturnValueOnce(second.promise)
    const engine = await import('../useStudioChat'); await engine.initStudioChat()
    const firstConversation = engine.activeChat.value!
    firstConversation.draft = 'First'; const firstSending = engine.sendChat()
    await vi.waitFor(() => expect(firstConversation.messages.at(-1)?.content).toBe('Partial first'))
    // A second submission in the same conversation must still be rejected.
    firstConversation.draft = 'Duplicate'; await engine.sendChat()
    expect(fetch).toHaveBeenCalledOnce()

    engine.newChat(); const secondConversation = engine.activeChat.value!
    secondConversation.draft = 'Second'; const secondSending = engine.sendChat()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    engine.selectChat(firstConversation.id); engine.stopChat(); await firstSending
    expect(firstConversation.messages.at(-1)).toMatchObject({ content: 'Partial first', status: 'stopped' })
    expect(engine.chatActiveBusy.value).toBe(false)
    expect(engine.isChatRunning(secondConversation.id)).toBe(true)

    second.resolve(jsonReply('Second completed')); await secondSending
    expect(secondConversation.messages.at(-1)).toMatchObject({ content: 'Second completed', status: 'done' })
    expect(engine.chatBusy.value).toBe(false)
  })
  it('stops streaming and retains partial text across a reload', async () => {
    const engine = await import('../useStudioChat'); await engine.initStudioChat()
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(delta('Partial reply'))) } }), { headers: { 'content-type': 'text/event-stream' } }))
    engine.activeChat.value!.draft = 'Hello'; const sending = engine.sendChat()
    await vi.waitFor(() => expect(engine.activeChat.value!.messages[1].content).toBe('Partial reply'))
    engine.stopChat(); await sending
    expect(engine.activeChat.value!.messages[1]).toMatchObject({ content: 'Partial reply', status: 'stopped' })
    await engine.reloadChatHistory(); expect(engine.activeChat.value!.messages[1].status).toBe('stopped')
    vi.mocked(fetch).mockResolvedValue(jsonReply('Continued'))
    engine.activeChat.value!.draft = 'Continue'; await engine.sendChat()
    const body = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'Partial reply' })
  })
  it('continues past five minutes during reasoning and coalesces rapid text deltas', async () => {
    const engine = await import('../useStudioChat')
    await engine.initStudioChat()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const upstream = openChatStream()
    vi.mocked(fetch).mockResolvedValue(upstream.response)
    engine.activeChat.value!.draft = 'A complex question'
    const sending = engine.sendChat()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const reply = engine.activeChat.value!.messages.at(-1)!
    const minute = 60_000
    // Longer than both timeout windows in total, but reasoning is progressing.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(4 * minute)
      upstream.write('data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\n\n')
      await vi.advanceTimersByTimeAsync(1)
    }
    expect(reply).toMatchObject({ content: '', status: 'streaming' })
    upstream.write(delta('第一'))
    await vi.advanceTimersByTimeAsync(1)
    expect(reply.content).toBe('第一')
    upstream.write(delta('段') + delta('文字'))
    await vi.advanceTimersByTimeAsync(1)
    expect(reply.content).toBe('第一')
    upstream.write('data: [DONE]\n\n')
    await sending
    expect(reply).toMatchObject({ content: '第一段文字', status: 'done' })
    expect(engine.chatBusy.value).toBe(false)
    expect(JSON.stringify(await loadStudioChatHistory('user-1', () => true))).not.toContain('private')
  })
  it('releases a stalled run and keeps partial text even if heartbeats continue', async () => {
    const engine = await import('../useStudioChat')
    await engine.initStudioChat()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const upstream = openChatStream()
    vi.mocked(fetch).mockResolvedValue(upstream.response)
    engine.activeChat.value!.draft = 'Heartbeat-only stall'
    const sending = engine.sendChat()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    upstream.write(delta('partial'))
    await vi.advanceTimersByTimeAsync(1)
    for (let i = 0; i < 5; i++) {
      upstream.write(': ping\n\n')
      await vi.advanceTimersByTimeAsync(3 * 60_000)
    }
    await sending
    expect(engine.activeChat.value!.messages.at(-1)).toMatchObject({ status: 'failed', content: 'partial', error: 'studioChat.modelTimeout' })
    expect(engine.chatBusy.value).toBe(false)
    expect(upstream.cancel).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('times out a silent connection independently of a concurrent chat', async () => {
    const engine = await import('../useStudioChat')
    await engine.initStudioChat()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const silent = openChatStream(), live = openChatStream()
    vi.mocked(fetch).mockResolvedValueOnce(silent.response).mockResolvedValueOnce(live.response)
    const first = engine.activeChat.value!
    first.draft = 'Stalled request'
    const stalled = engine.sendChat()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    engine.newChat()
    const second = engine.activeChat.value!
    second.draft = 'Healthy request'
    const healthy = engine.sendChat()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    live.write(': still working\n\n')
    await vi.advanceTimersByTimeAsync(60_001)
    await stalled
    expect(first.messages.at(-1)).toMatchObject({ status: 'failed', error: 'studioChat.timeout' })
    expect(engine.isChatRunning(second.id)).toBe(true)
    live.write(delta('done') + 'data: [DONE]\n\n')
    await healthy
    expect(second.messages.at(-1)).toMatchObject({ status: 'done', content: 'done' })
  })
  it.each(['stream', 'json'])('explains an exhausted output budget and keeps the partial reply for %s', async type => {
    const choice = { content: 'partial' }
    const response = type === 'json'
      ? Response.json({ choices: [{ message: choice, finish_reason: 'length' }] })
      : stream(delta('par') + delta('tial') + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n')
    vi.mocked(fetch).mockResolvedValue(response)
    const engine = await import('../useStudioChat')
    await engine.initStudioChat()
    engine.activeChat.value!.draft = 'Complex question'
    await engine.sendChat()
    expect(engine.activeChat.value!.messages.at(-1)).toMatchObject({ status: 'failed', content: 'partial', error: 'studioChat.outputLimit' })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('requires an explicit retry and does not duplicate the user message', async () => {
    const engine = await import('../useStudioChat'); await engine.initStudioChat()
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { message: 'Unavailable' } }, { status: 503 }))
    engine.activeChat.value!.draft = 'Hello'; await engine.sendChat()
    expect(fetch).toHaveBeenCalledOnce(); expect(engine.activeChat.value!.messages[1].status).toBe('failed')
    await engine.sendChat(true)
    expect(fetch).toHaveBeenCalledTimes(2); expect(engine.activeChat.value!.messages).toHaveLength(2)
    expect(engine.activeChat.value!.messages[1].content).toBe('Reply')
  })
  it('does not send a paid request when the initial history save fails', async () => {
    const engine = await import('../useStudioChat'); await engine.initStudioChat()
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    engine.activeChat.value!.draft = 'Hello'; await engine.sendChat()
    expect(fetch).not.toHaveBeenCalled(); expect(engine.chatStorageError.value).toBe('studioChat.saveFailed')
  })
  it('keeps sending disabled when history cannot be read', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    const engine = await import('../useStudioChat'); await engine.initStudioChat(); await engine.sendChat()
    expect(engine.chatReady.value).toBe(false); expect(engine.chatStorageError.value).toBe('studioChat.loadFailed'); expect(fetch).not.toHaveBeenCalled()
  })
  it('clears key material and drops a delayed reply after switching accounts', async () => {
    const pending = deferred<Response>(); vi.mocked(fetch).mockReturnValue(pending.promise)
    const engine = await import('../useStudioChat'); await engine.initStudioChat()
    engine.activeChat.value!.draft = 'Private to user one'; const sending = engine.sendChat()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    localStorage.setItem('auth_user', JSON.stringify({ id: 2 })); window.dispatchEvent(new Event('studio-session-ended'))
    expect(engine.chatKeys.value).toHaveLength(0); await engine.initStudioChat()
    pending.resolve(jsonReply('Private reply')); await sending
    expect(JSON.stringify(engine.chatConversations.value)).not.toContain('Private')
    expect(await loadStudioChatHistory('user-2', () => true)).toHaveLength(0)
  })
  it('does not restore a deleted conversation when its request finishes late', async () => {
    const pending = deferred<Response>(); vi.mocked(fetch).mockReturnValue(pending.promise)
    const engine = await import('../useStudioChat'); await engine.initStudioChat()
    engine.activeChat.value!.draft = 'Delete me'; const id = engine.chatActiveId.value, sending = engine.sendChat()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); await engine.deleteChat(id)
    pending.resolve(jsonReply('Late reply')); await sending
    expect(engine.chatConversations.value.some(row => row.id === id)).toBe(false)
    expect(await loadStudioChatHistory('user-1', () => true)).toHaveLength(0)
  })
  it('discards a slow model list when a different key is selected', async () => {
    const engine = await import('../useStudioChat'); await engine.initStudioChat()
    const slow = deferred<string[]>(); h.models.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce(['new-key-model'])
    const first = engine.selectChatKey(7); await engine.selectChatKey(8); slow.resolve(['old-key-model']); await first
    expect(engine.chatKeyId.value).toBe(8); expect(engine.chatModels.value).toEqual(['new-key-model'])
  })
  it('does not send an overlong conversation', async () => {
    const engine = await import('../useStudioChat'); await engine.initStudioChat()
    engine.activeChat.value!.draft = 'Hello'; engine.activeChat.value!.messages = Array.from({ length: 200 }, (_, id) => ({ id: String(id), role: 'user', content: 'x', status: 'done' }))
    await engine.sendChat(); expect(fetch).not.toHaveBeenCalled(); expect(engine.chatOptionsError.value).toBe('studioChat.contextTooLong')
  })
})
