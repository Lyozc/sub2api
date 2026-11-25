import type { VideoReferenceLimits } from './videoModelCapabilities'

export interface VideoReferenceAsset { name: string; url: string; file?: File }
export interface VideoReferences {
  mode: 'frames' | 'reference'
  images: VideoReferenceAsset[]
  media: VideoReferenceAsset[]
  keepOriginalSound: boolean
  preferMultiShots?: boolean
}
export interface VideoReferenceDraft {
  mode: 'frames' | 'reference'
  frames: VideoReferenceAsset[]
  images: VideoReferenceAsset[]
  media: VideoReferenceAsset[]
  keepOriginalSound: boolean
  preferMultiShots: boolean
}
export const emptyVideoReferences = (): VideoReferenceDraft => ({ mode: 'frames', frames: [], images: [], media: [], keepOriginalSound: false, preferMultiShots: true })
export function publicReferenceURL(raw: string): boolean {
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !url.hash
      && !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[::1\])/i.test(url.hostname)
      && !/\.(local|localhost)$/i.test(url.hostname)
  } catch { return false }
}
export function referenceImageLimit(limits: VideoReferenceLimits, media: VideoReferenceAsset[]) {
  return media.some(item => item.name.startsWith('video_')) && limits.max_images_with_video > 0
    ? Math.min(limits.max_images, limits.max_images_with_video) : limits.max_images
}
export function validateVideoReferences(refs: VideoReferences, limits?: VideoReferenceLimits, sound = ''): string {
  if (!limits) return 'referenceUnsupported'
  const all = [...refs.images, ...refs.media]
  if (!all.length) return 'referencesRequired'
  if (new Set(all.map(item => item.name)).size !== all.length) return 'referenceSlotUnsupported'
  if (refs.images.some(item => !limits.image_slots.includes(item.name)) || refs.media.some(item => ![...limits.video_slots, ...limits.audio_slots].includes(item.name))) return 'referenceSlotUnsupported'
  if (refs.images.length > referenceImageLimit(limits, refs.media) || all.length > limits.max_total) return 'referenceLimitExceeded'
  if (limits.required_slots.some(name => !all.some(item => item.name === name))) return 'referencesRequired'
  if (all.some(item => !item.file && !publicReferenceURL(item.url))) return 'referenceInvalidURL'
  if (refs.keepOriginalSound && !limits.keep_original_sound) return 'referenceOriginalUnsupported'
  if (refs.keepOriginalSound && !refs.media.some(item => limits.video_slots.includes(item.name))) return 'referenceOriginalNeedsVideo'
  if (sound === 'on' && (refs.keepOriginalSound || limits.disable_generated_audio_with_video && refs.media.some(item => item.name.startsWith('video_')))) return 'referenceAudioConflict'
  if (limits.multi_shots_required && refs.preferMultiShots === false) return 'referenceMultiShotsRequired'
  return ''
}

export function copyVideoReferences(refs?: VideoReferences): VideoReferences | undefined {
  const copyAsset = ({ name, url, file }: VideoReferenceAsset) => file ? { name, url: '', file } : { name, url }
  return refs ? { ...refs, images: refs.images.map(copyAsset), media: refs.media.map(copyAsset) } : undefined
}
