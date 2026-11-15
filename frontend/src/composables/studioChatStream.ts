function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map(item => typeof item?.text === 'string' ? item.text : '').join('')
}

function errorText(body: { error?: { message?: string } | string; message?: string }): string {
  return typeof body.error === 'string' ? body.error : body.error?.message || body.message || 'Chat request failed'
}

/** Parse SSE across arbitrary UTF-8 chunks, including CRLF and multiline data. */
export async function readStudioChatResponse(response: Response, append: (text: string) => void, signal: AbortSignal): Promise<void> {
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body ? errorText(body) : `HTTP ${response.status}`)
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const body = await response.json()
    if (body.error) throw new Error(errorText(body))
    const text = textContent(body.choices?.[0]?.message?.content)
    if (!text) throw new Error('No text returned by the model')
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    append(text)
    return
  }
  if (!response.body) throw new Error('Empty response stream')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = '', data: string[] = [], finished = false, terminal = false
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  function event() {
    if (!data.length) return
    const raw = data.join('\n'); data = []
    if (raw.trim() === '[DONE]') { finished = true; terminal = true; return }
    const body = JSON.parse(raw)
    if (body.error) throw new Error(errorText(body))
    const choice = body.choices?.[0]
    const text = textContent(choice?.delta?.content)
    if (text) append(text)
    if (choice?.finish_reason) finished = true
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
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
