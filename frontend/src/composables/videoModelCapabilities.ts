import catalog from '../../../backend/internal/service/video_capabilities.json'

// Verified against xAI's video generation docs and the Kling relay's paid
// text/image-to-video schemas. A newer model does not imply a higher resolution.
export const GROK_VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const
export const KLING_VIDEO_RESOLUTIONS = ['', '720p', '1080p', '4k'] as const
export type VideoResolution = typeof GROK_VIDEO_RESOLUTIONS[number] | typeof KLING_VIDEO_RESOLUTIONS[number]

export function videoModelResolutions(model: string): readonly VideoResolution[] {
  const id = model.trim().toLowerCase().replace(/_/g, '-')
  if (/^grok-imagine-video-1\.5(?:-preview|-lite)?$/.test(id)) return GROK_VIDEO_RESOLUTIONS
  if (id === 'grok-imagine-video') return ['480p', '720p']
  if (/^kling-(?:video-)?v?4(?:[.-]0)?-flash$/.test(id)) return ['', '720p']
  if (/^kling-(?:video-)?v?4(?:[.-]0)?$/.test(id)) return ['', '720p', '1080p']
  if (/^kling-(?:video-)?v?3(?:[.-]0)?(?:-omni)?$/.test(id)) return KLING_VIDEO_RESOLUTIONS
  if (/^kling-(?:video-)?(?:v?2[.-][56](?:-turbo)?|v?3(?:[.-]0)?-turbo|o1)$/.test(id)) return ['', '720p', '1080p']
  // Unrecognised models use their upstream default instead of advertising
  // unverified capabilities.
  return ['']
}

export function validVideoResolution(model: string, resolution: string): boolean {
  return (videoModelResolutions(model) as readonly string[]).includes(resolution)
}

export function compatibleVideoResolution(model: string, resolution: VideoResolution): VideoResolution {
  const supported = videoModelResolutions(model)
  return supported.includes(resolution) ? resolution : supported.includes('720p') ? '720p' : supported[0]
}

export interface VideoReferenceLimits {
  image_slots: string[]
  video_slots: string[]
  audio_slots: string[]
  required_slots: string[]
  max_images: number
  max_total: number
  max_images_with_video: number
  keep_original_sound: boolean
  disable_generated_audio_with_video: boolean
  prefer_multi_shots?: boolean
  multi_shots_required?: boolean
}
export interface VideoCapabilities {
  durations: number[]
  resolutions: string[]
  default_resolution: string
  ratios: string[]
  modes: string[]
  sound: boolean
  audio_resolutions: string[]
  negative_prompt: boolean
  cfg_scale: boolean
  prompt_max: number
  image_max_bytes: number
  image_min_edge: number
  image_min_aspect?: number
  image_max_aspect?: number
  image_max_edge?: number
  min_references?: number
  requires_image_or_video?: boolean
  reference_counts?: number[]
  references?: VideoReferenceLimits
}
export type VideoCapabilitySet = Partial<Record<'t2v' | 'i2v' | 'reference', VideoCapabilities>>
function capabilityID(model: string) {
  let id = model.trim().toLowerCase().replace(/_/g, '-')
  if (!id.startsWith('kling-')) return id
  id = id.replace(/^kling-(?:video-)?v?/, '').replace(/\./g, '-')
  if (id === '3' || id === '4') id += '-0'
  if (id === '4-flash') id = '4-0-flash'
  if (id === '3-omni') id = '3-0-omni'
  if (id === '2-5-turbo') id = '2-5'
  return `kling-video-${id === 'o1' ? '' : 'v'}${id}`
}
export function videoCapabilities(model: string, mode: 't2v' | 'i2v' | 'reference' = 't2v', supplied?: VideoCapabilitySet): VideoCapabilities {
  const verified = (catalog as Record<string, VideoCapabilitySet>)[capabilityID(model)]?.[mode]
  const upstream = supplied?.[mode]
  const known = upstream || verified
  // Old model responses must not reopen durations removed from the catalog.
  // A narrower upstream declaration is still respected.
  if (known) return {
    ...known,
    durations: verified && upstream
      ? verified.durations.filter(value => upstream.durations.includes(value))
      : known.durations
  }
  return {
    durations: Array.from({ length: 30 }, (_, i) => i + 1),
    resolutions: [...videoModelResolutions(model)], default_resolution: '720p',
    ratios: ['auto', '16:9', '9:16', '1:1'], modes: [], sound: false,
    audio_resolutions: [], negative_prompt: false, cfg_scale: false,
    prompt_max: /^kling/i.test(model) ? 2500 : 4000, image_max_bytes: 10 * 1024 * 1024, image_min_edge: 0,
  }
}
export function videoDurationAllowed(value: unknown, caps: VideoCapabilities): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && caps.durations.includes(value)
}
export function nearestVideoDuration(value: number, caps: VideoCapabilities): number {
  return caps.durations.reduce((best, current) => Number.isFinite(value) && Math.abs(current - value) < Math.abs(best - value) ? current : best, caps.durations[0] || 5)
}
export function videoAspectRatio(size: string, kling = false): string {
  if (!size || size === 'auto') return 'auto'
  const [w, h] = size.split('x').map(Number)
  if (!(w > 0 && h > 0)) return 'auto'
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a
  const factor = gcd(w, h), ratio = `${w / factor}:${h / factor}`
  return kling && ratio === '7:3' ? '21:9' : ratio
}
export function videoAudioAllowed(caps: VideoCapabilities, resolution: string): boolean {
  return caps.sound && caps.audio_resolutions.includes(resolution || caps.default_resolution)
}
