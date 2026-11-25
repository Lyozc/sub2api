import DOMPurify from 'dompurify'

// These SVG elements are safe to render inside the same isolated frame as
// animation scripts. Restrict reuse and animation targets to local fragments.
const animatedSvgTags = ['use', 'animate', 'set']
const fragmentReference = /^#[^\s]+$/
const fitPreview = `
(() => {
  const root = document.documentElement;
  const body = document.body;
  const originalZoom = body.style.zoom;
  const fit = () => {
    body.style.zoom = originalZoom;
    const width = root.clientWidth;
    const contentWidth = Math.max(root.scrollWidth, body.scrollWidth);
    const height = root.clientHeight;
    const contentHeight = Math.max(root.scrollHeight, body.scrollHeight);
    const clipsHeight = [root, body].some(element => /^(hidden|clip)$/.test(getComputedStyle(element).overflowY));
    if (width > 0 && height > 0) {
      // Generated canvases that deliberately hide overflow should fit in both
      // dimensions. A normal long page still scrolls inside its preview.
      const scale = Math.min(1, width / contentWidth, clipsHeight ? height / contentHeight : 1);
      if (scale < 1) body.style.zoom = String(scale);
    }
  };
  addEventListener('load', fit, { once: true });
  addEventListener('resize', fit);
  fit();
})();
`

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
    ADD_TAGS: ['script', ...animatedSvgTags],
    FORBID_TAGS: ['base', 'embed', 'form', 'iframe', 'link', 'meta', 'object'],
    FORBID_ATTR: ['srcdoc'],
    ALLOW_DATA_ATTR: true
  })
  const preview = new DOMParser().parseFromString(sanitized, 'text/html')
  for (const element of preview.querySelectorAll('svg :is(use, animate, animateMotion, animateTransform, animateColor, set, mpath)')) {
    for (const attribute of ['href', 'xlink:href']) {
      const target = element.getAttribute(attribute)
      if (target && !fragmentReference.test(target)) element.removeAttribute(attribute)
    }
  }
  // srcdoc also inherits the parent's CSP. Use the page's trusted nonce to
  // satisfy that policy while the preview's own policy blocks external scripts,
  // even when generated code tries to attach a nonce to a remote script.
  const nonce = Array.from(document.scripts).find(script => script.nonce)?.nonce || ''
  preview.querySelectorAll('script').forEach(script => {
    script.removeAttribute('nonce')
    // Set the attribute on this inert document so serialization retains it.
    if (nonce) script.setAttribute('nonce', nonce)
  })
  const fit = preview.createElement('script')
  if (nonce) fit.setAttribute('nonce', nonce)
  fit.textContent = fitPreview
  preview.body.append(fit)
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
