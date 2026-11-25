export interface StudioChatAttachment {
  name: string
  type: string
  data: string
}

const fileTypes: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf'
}
const textExtensions = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'log', 'xml', 'yaml', 'yml', 'html', 'css', 'js', 'ts', 'py', 'sql']
const images = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
export const studioChatAttachmentAccept = [...new Set(Object.values(fileTypes)), ...[...Object.keys(fileTypes), ...textExtensions].map(ext => `.${ext}`), 'text/plain'].join(',')
export const studioChatAttachmentLimit = 5
export const studioChatAttachmentTotalBytes = 12 * 1024 * 1024

export const studioChatAttachmentBytes = ({ data }: StudioChatAttachment) =>
  data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)

export function studioChatAttachmentImage({ data, type }: StudioChatAttachment): string | undefined {
  if (images.has(type)) return `data:${type};base64,${data}`
}

export async function readStudioChatAttachment(file: File): Promise<StudioChatAttachment> {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  const mime = file.type.toLowerCase()
  const type = images.has(mime) || mime === 'application/pdf' ? mime
    : Object.prototype.hasOwnProperty.call(fileTypes, extension) ? fileTypes[extension]
    : textExtensions.includes(extension) || mime === 'text/plain' ? 'text/plain' : ''
  if (!type) throw new Error('attachmentType')
  if (!file.size || file.size > (type === 'text/plain' ? 256 * 1024 : 4 * 1024 * 1024)) throw new Error('attachmentSize')

  const name = file.name.trim().replace(/[\\/\p{Cc}]/gu, '_')
  if (!name || name === '.' || name === '..' || new TextEncoder().encode(name).length > 255) throw new Error('attachmentName')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1])
    reader.onerror = () => reject(new Error('attachmentRead'))
    reader.onabort = reader.onerror
    reader.readAsDataURL(file)
  })
  if (!data) throw new Error('attachmentRead')
  if (type === 'text/plain') {
    let text: string
    try {
      const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0))
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new Error('attachmentEncoding')
    }
    if (!text.trim() || /\p{Cc}/u.test(text.replace(/[\t\r\n\f]/g, ''))) throw new Error('attachmentEncoding')
  }
  return { name, type, data }
}
