import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }))

function reply(body: unknown, status = 200, replayed = false) {
  return { ok: status >= 200 && status < 300, status, json: async () => body,
    headers: new Headers(replayed ? { 'X-Idempotency-Replayed': 'true' } : {}) }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

describe('video submission acknowledgement recovery', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    localStorage.clear()
    localStorage.setItem('auth_user', JSON.stringify({ id: 1 }))
    localStorage.setItem('auth_token', 'session-a')
  })
  afterEach(() => {
    window.dispatchEvent(new Event('studio-session-ended'))
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('automatically checks the same key until a delayed receipt appears, then polls the original job', async () => {
    let lookups = 0
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') throw new TypeError('Network connection lost')
      if (url.includes('/submissions/')) {
        lookups++
        if (lookups === 1) return reply({ message: 'still processing' }, 409)
        if (lookups === 2) return reply({ message: 'not visible yet' }, 404)
        if (lookups === 3) return reply({ message: 'gateway temporarily unavailable' }, 503)
        return reply({ id: 'original-job', billable_duration_seconds: 10 }, 200, true)
      }
      return reply({ status: 'failed', error: 'original upstream terminal status' })
    })
    vi.stubGlobal('fetch', fetcher)
    const engine = await import('../useVideoStudioEngine')
    engine.prompt.value = 'one generation'
    const [task] = engine.submitBatch()
    await vi.advanceTimersByTimeAsync(0)
    expect(task.submissionRecovering).toBe(true)
    expect(task.status).toBe('pending')
    await vi.advanceTimersByTimeAsync(30000)
    expect(task.remoteId).toBe('original-job')
    expect(task.submissionUnconfirmed).toBe(false)
    expect(task.submissionRecovering).toBe(false)
    expect(task.billableDuration).toBe(10)
    const posts = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')
    expect(posts).toHaveLength(1)
    const key = (posts[0][1]?.headers as Record<string, string>)['Idempotency-Key']
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/submissions/')).every(([url]) => url.endsWith(`/submissions/${key}`))).toBe(true)
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/tasks/original-job'))).toBe(true)
  })

  it('preserves a saved 502 error and never creates another generation on retry', async () => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => reply({ error: { message: 'Official CLI submission failed' } }, 502, options?.method !== 'POST'))
    vi.stubGlobal('fetch', fetcher)
    const engine = await import('../useVideoStudioEngine')
    engine.prompt.value = 'one generation'
    const [task] = engine.submitBatch()
    await vi.advanceTimersByTimeAsync(0)
    expect(task.status).toBe('failed')
    expect(task.submissionUnconfirmed).toBe(true)
    expect(task.error).toContain('Official CLI submission failed')
    expect(task.error).toContain('videoStudio.submissionUnknown')
    engine.retryTask(task.taskId)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    expect(fetcher.mock.calls).toHaveLength(3)
  })

  it('saves the unknown-submission marker before the first POST', async () => {
    const fetcher = vi.fn(async () => reply({ error: { message: 'invalid request' } }, 400))
    vi.stubGlobal('fetch', fetcher)
    const engine = await import('../useVideoStudioEngine')
    const markers: boolean[] = []
    engine.registerVideoTaskPersistence(async () => { markers.push(Boolean(engine.tasks.value[0]?.submissionUnconfirmed)); expect(fetcher).not.toHaveBeenCalled() })
    engine.prompt.value = 'one generation'
    const [task] = engine.submitBatch()
    await vi.advanceTimersByTimeAsync(0)
    expect(markers).toEqual([false, true])
    expect(task.submissionUnconfirmed).toBe(false)
    expect(task.error).toBe('invalid request')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('recovers a receipt after the creation request exceeds 120 seconds', async () => {
    const fetcher = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return new Promise<ReturnType<typeof reply>>((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError'))))
      if (url.includes('/submissions/')) return Promise.resolve(reply({ id: 'late-job' }, 200, true))
      return Promise.resolve(reply({ status: 'failed', error: 'terminal' }))
    })
    vi.stubGlobal('fetch', fetcher)
    const engine = await import('../useVideoStudioEngine')
    engine.prompt.value = 'one generation'
    const [task] = engine.submitBatch()
    await vi.advanceTimersByTimeAsync(120000)
    expect(task.remoteId).toBe('late-job')
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })

  it('does not send a generation if the uncertainty marker cannot be saved', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const engine = await import('../useVideoStudioEngine')
    engine.registerVideoTaskPersistence(async () => {
      if (engine.tasks.value[0]?.submissionUnconfirmed) throw new Error('Browser storage unavailable')
    })
    engine.prompt.value = 'one generation'
    const [task] = engine.submitBatch()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).not.toHaveBeenCalled()
    expect(task.submissionUnconfirmed).toBe(false)
    expect(task.error).toBe('Browser storage unavailable')
  })

  it('stops acknowledgement checks when the user stops waiting', async () => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') throw new TypeError('Network error')
      return reply({ message: 'processing' }, 409)
    })
    vi.stubGlobal('fetch', fetcher)
    const engine = await import('../useVideoStudioEngine')
    engine.prompt.value = 'one generation'
    const [task] = engine.submitBatch()
    await vi.advanceTimersByTimeAsync(0)
    engine.stopWaiting(task.taskId)
    await vi.advanceTimersByTimeAsync(30000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(task.status).toBe('failed')
    expect(task.submissionUnconfirmed).toBe(true)
    expect(task.submissionRecovering).toBe(false)
  })

  it('discards a delayed receipt after the authenticated session ends', async () => {
    const receipt = deferred<ReturnType<typeof reply>>()
    const fetcher = vi.fn((_url: string, options?: RequestInit) => options?.method === 'POST' ? Promise.reject(new TypeError('Network error')) : receipt.promise)
    vi.stubGlobal('fetch', fetcher)
    const engine = await import('../useVideoStudioEngine')
    engine.prompt.value = 'one generation'
    const [task] = engine.submitBatch()
    await vi.advanceTimersByTimeAsync(0)
    window.dispatchEvent(new Event('studio-session-ended'))
    receipt.resolve(reply({ id: 'old-account-job' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.tasks.value).toEqual([])
    expect(task.remoteId).toBe('')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('bounds repeated lookup failures and retains uncertainty for a later manual check', async () => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') throw new TypeError('Network error')
      return reply({ message: 'processing' }, 409)
    })
    vi.stubGlobal('fetch', fetcher)
    const engine = await import('../useVideoStudioEngine')
    engine.prompt.value = 'one generation'
    const [task] = engine.submitBatch()
    await vi.advanceTimersByTimeAsync(300001)
    expect(task.status).toBe('failed')
    expect(task.submissionUnconfirmed).toBe(true)
    expect(task.submissionRecovering).toBe(false)
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    const calls = fetcher.mock.calls.length
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetcher).toHaveBeenCalledTimes(calls)
  })
  it('shows an uncertain upstream task without treating it as terminal failure or resubmitting', async () => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
      ? reply({ id: 'original-job' })
      : reply({ status: 'submission_unknown', error: { message: 'Official submission needs reconciliation' } }))
    vi.stubGlobal('fetch', fetcher)
    const engine = await import('../useVideoStudioEngine')
    engine.prompt.value = 'one generation'
    const [task] = engine.submitBatch()
    await vi.advanceTimersByTimeAsync(5000)
    expect(task.status).toBe('failed')
    expect(task.remoteId).toBe('original-job')
    expect(task.submissionUnconfirmed).toBe(true)
    expect(task.upstreamFailed).not.toBe(true)
    expect(task.error).toContain('Official submission needs reconciliation')
    engine.retryTask(task.taskId)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })

  it('resumes a Seedance quote with its original key and checks a lost approval without reapproving', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    const createObjectURL = vi.fn(() => 'blob:seedance-video')
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }))
    let quoteAttempts = 0
    let approvalAttempts = 0
    const fetcher = vi.fn(async (url: string, _options?: RequestInit) => {
      if (url.includes('/quotes?')) {
        if (++quoteAttempts === 1) throw new TypeError('quote connection lost')
        return reply({ id: 'seedance-task', status: 'queued', price_estimate: 0.25, relay: { phase: 'awaiting_approval', max_credits: 84 } })
      }
      if (url.includes('/approve?')) {
        ++approvalAttempts
        if (approvalAttempts === 1) throw new TypeError('approval connection lost')
        return reply({ id: 'seedance-task', status: 'running' })
      }
      if (url.includes('/content?')) return { ok: true, blob: async () => new Blob(['mp4'], { type: 'video/mp4' }) }
      return approvalAttempts < 2
        ? reply({ id: 'seedance-task', status: 'queued', relay: { phase: 'awaiting_approval', max_credits: 91 } })
        : reply({ id: 'seedance-task', status: 'succeeded' })
    })
    vi.stubGlobal('fetch', fetcher)
    const engine = await import('../useVideoStudioEngine')
    engine.model.value = 'seedance_2.5_flash'
    engine.modelGroupId.value = 42
    engine.models.value = [{
      id: engine.model.value, group_id: 42, group_name: 'Dreamina', provider: 'dreamina',
      capabilities: { t2v: {
        durations: [4], resolutions: ['480p'], default_resolution: '480p', ratios: ['16:9'], modes: [],
        sound: false, audio_resolutions: [], negative_prompt: false, cfg_scale: false,
        prompt_max: 12000, image_max_bytes: 32 << 20, image_min_edge: 0
      } }
    }]
    engine.prompt.value = 'paper boat'
    engine.seconds.value = 4
    engine.resolution.value = '480p'
    const [task] = engine.submitBatch()
    await vi.advanceTimersByTimeAsync(0)
    expect(task.status).toBe('failed')
    engine.retryTask(task.taskId)
    await vi.advanceTimersByTimeAsync(0)
    expect(task.status).toBe('awaiting_approval')
    expect(task.dreaminaQuoteCredits).toBe(84)
    expect(task.dreaminaPriceEstimate).toBe(0.25)
    const quotes = fetcher.mock.calls.filter(([url]) => url.includes('/quotes?'))
    expect(quotes).toHaveLength(2)
    expect(quotes[1][1]?.body).toBe(quotes[0][1]?.body)
    expect((quotes[1][1]?.headers as Record<string,string>)['Idempotency-Key']).toBe(task.submissionKey)
    expect(quotes[1][0]).toContain('group_id=42')
    expect(approvalAttempts).toBe(0)

    void engine.approveDreaminaVideo(task.taskId)
    await vi.advanceTimersByTimeAsync(100)
    expect(task.status).toBe('awaiting_approval')
    expect(task.dreaminaQuoteCredits).toBe(91)
    expect(approvalAttempts).toBe(1)
    void engine.approveDreaminaVideo(task.taskId)
    await vi.advanceTimersByTimeAsync(100)
    expect(approvalAttempts).toBe(2)
    expect(fetcher.mock.calls.findLast(([url]) => url.includes('/approve?'))?.[1]?.body).toBe(JSON.stringify({ approved_credit_ceiling: 91 }))
    expect(task.status, task.error).toBe('done')
    expect(task.blob?.type).toBe('video/mp4')
  })

})
