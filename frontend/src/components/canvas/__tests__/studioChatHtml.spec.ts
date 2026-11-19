import { describe, expect, it } from 'vitest'
import { extractStudioChatHtml, studioChatHtmlDocument } from '../studioChatHtml'

describe('studio chat HTML output', () => {
  it('extracts a fenced complete HTML document', () => {
    const source = 'Here is the page:\n```html\n<!doctype html><html><body><h1>Hi</h1></body></html>\n```'
    expect(extractStudioChatHtml(source)).toContain('<!doctype html>')
  })

  it('preserves inline animation code while blocking external content and event attributes', () => {
    const source = '```html\n<!doctype html><html><head><style>body{color:red}</style></head><body><script>window.parent.stolen = true</script><iframe src="https://evil.example"></iframe><h1>Safe</h1></body></html>\n```'
    const document = studioChatHtmlDocument(source)
    expect(document).toContain('color:red')
    expect(document).toContain('<h1>Safe</h1>')
    expect(document).toContain('<script>window.parent.stolen = true</script>')
    expect(document).not.toContain('<iframe')
    expect(document).toContain('Content-Security-Policy')
    expect(document).toContain("connect-src 'none'")
    expect(document).toContain("script-src 'unsafe-inline'")
  })

  it('keeps script order, canvas selectors, CSS keyframes and SVG animation targets', () => {
    const html = studioChatHtmlDocument('```html\n<html><head><style>@keyframes spin{to{transform:rotate(360deg)}} .wheel{animation:spin 1s infinite}</style></head><body><canvas id="scene" data-speed="2"></canvas><svg><g class="wheel"><circle r="10"/></g></svg><script>document.getElementById("scene").getContext("2d")</script></body></html>\n```')
    expect(html).toContain('@keyframes spin')
    expect(html).toContain('class="wheel"')
    expect(html).toContain('data-speed="2"')
    expect(html.indexOf('<canvas')).toBeLessThan(html.indexOf('<script'))
  })

  it('removes policy overrides and remote scripts, and uses the parent nonce for inline code', () => {
    const trusted = document.createElement('script')
    trusted.nonce = 'parentNonce123'
    document.head.append(trusted)
    try {
      const html = studioChatHtmlDocument('```html\n<html><head><base href="https://evil.example"><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://evil.example"></head><body onload="alert(1)"><script src="https://evil.example/a.js"></script><script nonce="untrusted">requestAnimationFrame(draw)</script><h1 onclick="alert(1)">Hi</h1></body></html>\n```')
      expect(html).toContain('<script nonce="parentNonce123">requestAnimationFrame(draw)</script>')
      expect(html).not.toMatch(/evil\.example|untrusted|onload|onclick|http-equiv="refresh"/)
      expect(html).toContain("frame-src 'none'")
    } finally { trusted.remove() }
  })

  it('does not treat ordinary markdown as a previewable HTML document', () => {
    expect(extractStudioChatHtml('A <b>small</b> inline tag is not a page.')).toBeNull()
  })
})
