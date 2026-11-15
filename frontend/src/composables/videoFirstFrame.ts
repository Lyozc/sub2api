import type { VideoCapabilities } from './videoModelCapabilities'

export class VideoFrameError extends Error {
  constructor(public reason: 'imageFormatError' | 'imageSizeError' | 'imageDimensionsError' | 'imageAspectError', public min = 0) { super(reason) }
}

function readBytes(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new VideoFrameError('imageFormatError'))
    reader.readAsArrayBuffer(file)
  })
}

export async function prepareVideoFirstFrame(file: File, caps: VideoCapabilities): Promise<File> {
  if (file.size > 32 * 1024 * 1024) throw new VideoFrameError('imageSizeError')
  const bytes = new Uint8Array(await readBytes(file.slice(0, 16)))
  const png = [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp = String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP'
  if (!png && !jpeg && !webp) throw new VideoFrameError('imageFormatError')
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve,reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new VideoFrameError('imageFormatError'))
      img.src = url
    })
    if (Math.min(image.naturalWidth,image.naturalHeight) < caps.image_min_edge) throw new VideoFrameError('imageDimensionsError',caps.image_min_edge)
    const ratio = image.naturalWidth / image.naturalHeight
    if ((caps.image_min_aspect && ratio < caps.image_min_aspect) || (caps.image_max_aspect && ratio > caps.image_max_aspect)) throw new VideoFrameError('imageAspectError')
    if (caps.image_max_edge && Math.max(image.naturalWidth,image.naturalHeight) > caps.image_max_edge) throw new VideoFrameError('imageSizeError')
    if (file.size <= caps.image_max_bytes) return new File([file], file.name, { type: png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp' })
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 4096 / Math.max(image.naturalWidth,image.naturalHeight))
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    if (Math.min(canvas.width,canvas.height) < caps.image_min_edge) throw new VideoFrameError('imageDimensionsError',caps.image_min_edge)
    const context = canvas.getContext('2d')
    if (!context) throw new VideoFrameError('imageFormatError')
    context.drawImage(image,0,0,canvas.width,canvas.height)
    for (const quality of [0.9,0.75,0.6]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve,'image/webp',quality))
      if (blob && blob.size <= caps.image_max_bytes) return new File([blob], 'first-frame.webp', { type: blob.type })
    }
    throw new VideoFrameError('imageSizeError')
  } finally { URL.revokeObjectURL(url) }
}
