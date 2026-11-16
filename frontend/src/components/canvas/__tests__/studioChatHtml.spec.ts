import { describe, expect, it } from 'vitest'
import { extractStudioChatHtml, studioChatHtmlDocument } from '../studioChatHtml'

describe('studio chat HTML output', () => {
  it('extracts a fenced complete HTML document', () => {
    const source = 'Here is the page:\n```html\n<!doctype html><html><body><h1>Hi</h1></body></html>\n```'
    expect(extractStudioChatHtml(source)).toContain('<!doctype html>')
  })

  it('renders full HTML in an isolated document without executable or embedded content', () => {
    const source = '```html\n<!doctype html><html><head><style>body{color:red}</style></head><body><script>window.parent.stolen = true</script><iframe src="https://evil.example"></iframe><h1>Safe</h1></body></html>\n```'
    const document = studioChatHtmlDocument(source)
    expect(document).toContain('color:red')
    expect(document).toContain('<h1>Safe</h1>')
    expect(document).not.toContain('<script')
    expect(document).not.toContain('<iframe')
    expect(document).toContain('Content-Security-Policy')
  })

  it('does not treat ordinary markdown as a previewable HTML document', () => {
    expect(extractStudioChatHtml('A <b>small</b> inline tag is not a page.')).toBeNull()
  })
})
