import DOMPurify from 'dompurify'

/** HTML outputs stay opt-in and separate from the parent application's DOM. */
export function extractStudioChatHtml(text: string): string | null {
  const fenced = text.match(/```html?\s*\r?\n([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) return fenced[1].trim()
  const source = text.trim()
  return /^(?:<!doctype\s+html|<html[\s>])/i.test(source) ? source : null
}

export function studioChatHtmlDocument(text: string): string {
  const source = extractStudioChatHtml(text)
  if (!source) return ''
  const sanitized = DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['base', 'embed', 'form', 'iframe', 'link', 'meta', 'object', 'script'],
    FORBID_ATTR: ['srcdoc'],
    ALLOW_DATA_ATTR: false
  })
  const document = new DOMParser().parseFromString(sanitized, 'text/html')
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'"
  document.head.prepend(policy)
  const viewport = document.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  document.head.append(viewport)
  return '<!doctype html>\n' + document.documentElement.outerHTML
}
