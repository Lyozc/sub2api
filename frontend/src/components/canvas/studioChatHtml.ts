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
  // Keep inline animation code in place so scripts see the same DOM/order as
  // the generated page. This document must ONLY run in an opaque-origin iframe
  // with allow-scripts, never with allow-same-origin or in the application's DOM.
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  parsed.querySelectorAll('script[src]').forEach(script => script.remove())
  const sanitized = DOMPurify.sanitize(parsed.documentElement.outerHTML, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['script'],
    FORBID_TAGS: ['base', 'embed', 'form', 'iframe', 'link', 'meta', 'object'],
    FORBID_ATTR: ['srcdoc'],
    ALLOW_DATA_ATTR: true
  })
  const preview = new DOMParser().parseFromString(sanitized, 'text/html')
  // srcdoc also inherits the parent's CSP. Use the page's trusted nonce to
  // satisfy that policy while the preview's own policy blocks external scripts,
  // even when generated code tries to attach a nonce to a remote script.
  const nonce = Array.from(document.scripts).find(script => script.nonce)?.nonce || ''
  preview.querySelectorAll('script').forEach(script => {
    script.removeAttribute('nonce')
    // Set the attribute on this inert document so serialization retains it.
    if (nonce) script.setAttribute('nonce', nonce)
  })
  const policy = preview.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; script-src 'unsafe-inline'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'"
  preview.head.prepend(policy)
  const viewport = preview.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  preview.head.append(viewport)
  return '<!doctype html>\n' + preview.documentElement.outerHTML
}
