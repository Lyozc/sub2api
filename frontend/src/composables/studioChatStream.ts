function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map(part => {
    if (part?.type === 'refusal' && typeof part.refusal === 'string') return part.refusal
    return typeof part?.text === 'string' ? part.text : ''
  }).join('')
}

function messageText(message?: { content?: unknown; refusal?: unknown }): string {
  return textContent(message?.content) || textContent(message?.refusal)
}

function errorText(body: { error?: { message?: string } | string; message?: string }): string {
  return typeof body.error === 'string' ? body.error : body.error?.message || body.message || 'Chat request failed'
}

/** Parse SSE across arbitrary UTF-8 chunks, including CRLF and multiline data. */
export async function readStudioChatResponse(
  response: Response,
  append: (text: string) => void,
  signal: AbortSignal,
  onActivity?: (modelProgress: boolean) => void
): Promise<string | undefined> {
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body ? errorText(body) : `HTTP ${response.status}`)
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const body = await response.json()
    if (body.error) throw new Error(errorText(body))
    const choice = body.choices?.[0]
    const text = messageText(choice?.message)
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (text) append(text)
    return choice?.finish_reason
  }
  if (!response.body) throw new Error('Empty response stream')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = '', data: string[] = [], finished = false, terminal = false, hasText = false
  let finishReason: string | undefined
  let drainTimer: number | undefined
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  function event() {
    if (!data.length) return
    const raw = data.join('\n'); data = []
    if (raw.trim() === '[DONE]') { finished = true; terminal = true; return }
    const body = JSON.parse(raw)
    if (body.error) throw new Error(errorText(body))
    const choice = body.choices?.[0]
    const delta = choice?.delta
    const text = messageText(delta) || (!hasText ? messageText(choice?.message) : '')
    if (text) {
      append(text)
      hasText = true
    }
    // Reasoning can precede the visible answer by minutes. Count its arrival
    // as model progress without surfacing or persisting the reasoning itself.
    if (text || delta?.reasoning_content || delta?.reasoning || delta?.reasoning_details?.length) onActivity?.(true)
    if (choice?.finish_reason && !finished) {
      finished = true
      finishReason = choice.finish_reason
      // Give usage and DONE time to arrive, even when the provider leaves its
      // connection open after the terminal choice. No more text is expected.
      drainTimer = window.setTimeout(abort, 5000)
    }
  }
  function line(value: string) {
    if (!value) event()
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''))
  }
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const { value, done } = await reader.read()
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      if (value?.byteLength) onActivity?.(false)
      pending += decoder.decode(value, { stream: !done })
      let index: number
      while ((index = pending.indexOf('\n')) >= 0) {
        line(pending.slice(0, index).replace(/\r$/, ''))
        pending = pending.slice(index + 1)
      }
      if (done) { if (pending) line(pending.replace(/\r$/, '')); event(); break }
      // Usage frames can follow finish_reason. Read through DONE or EOF so
      // the gateway can finish its normal usage accounting.
      if (terminal) break
    }
    if (!finished) throw new Error('The reply connection ended before completion')
    return finishReason
  } finally {
    signal.removeEventListener('abort', abort)
    window.clearTimeout(drainTimer)
    // A custom stream can leave its cancellation promise pending indefinitely.
    // Cancel the transport, but allow the completed reply to be finalized now.
    abort()
    reader.releaseLock()
  }
}
