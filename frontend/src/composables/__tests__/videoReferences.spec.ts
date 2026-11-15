import { describe, expect, it } from 'vitest'
import { videoCapabilities } from '../videoModelCapabilities'
import { copyVideoReferences, publicReferenceURL, validateVideoReferences, type VideoReferences } from '../videoReferences'
const refs = (count: number): VideoReferences => ({ mode: 'reference', images: Array.from({ length: count }, (_, i) => ({ name: `image_${i + 1}`, url: `https://example.com/${i}.png` })), media: [], keepOriginalSound: false })
describe('video reference combinations', () => {
  it('enforces image and mixed-video caps without dropping existing materials', () => {
    for (const model of ['kling-v4', 'kling-v4-flash']) {
      const limits = videoCapabilities(model, 'reference').references
      expect(validateVideoReferences(refs(10), limits)).toBe('')
      expect(validateVideoReferences(refs(11), limits)).toBeTruthy()
    }
    for (const model of ['kling-o1', 'kling-v3-omni']) {
      const value = refs(7), limits = videoCapabilities(model, 'reference').references
      expect(validateVideoReferences(value, limits)).toBe('')
      value.media.push({ name: 'video_1', url: 'https://example.com/v.mp4' })
      expect(validateVideoReferences(value, limits)).toBe('referenceLimitExceeded')
      expect(value.images).toHaveLength(7)
      value.images = value.images.slice(0, 4)
      expect(validateVideoReferences(value, limits)).toBe('')
    }
  })
  it('rejects Flash audio and conflicting generated/original audio settings', () => {
    const value = refs(1)
    value.media.push({ name: 'audio_1', url: 'https://example.com/a.mp3' })
    expect(validateVideoReferences(value, videoCapabilities('kling-v4-flash', 'reference').references)).toBe('referenceSlotUnsupported')
    value.keepOriginalSound = true
    expect(validateVideoReferences(value, videoCapabilities('kling-v4', 'reference').references, 'on')).toBe('referenceAudioConflict')
    value.keepOriginalSound = false
    value.media = [{ name: 'video_1', url: 'https://example.com/v.mp4' }]
    expect(validateVideoReferences(value, videoCapabilities('kling-v3-omni', 'reference').references, 'on')).toBe('referenceAudioConflict')
  })
  it('takes independent task snapshots and retains local files while discarding ephemeral URLs', () => {
    const value = refs(1)
    value.images[0] = { name: 'image_1', url: 'blob:temporary', file: new File(['test'], 'ref.png', { type: 'image/png' }) }
    const snapshot = copyVideoReferences(value)!
    expect(snapshot.images[0].url).toBe('')
    expect(snapshot.images[0].file).toBe(value.images[0].file)
    value.images.length = 0
    expect(snapshot.images).toHaveLength(1)
  })
  it('requires public media links and rejects duplicate slots', () => {
    for (const url of ['file:///tmp/a', 'javascript:alert(1)', 'http://127.0.0.1/a', 'https://user:pass@example.com/a']) expect(publicReferenceURL(url)).toBe(false)
    const value = refs(1)
    value.images.push({ ...value.images[0] })
    expect(validateVideoReferences(value, videoCapabilities('kling-v4', 'reference').references)).toBe('referenceSlotUnsupported')
  })
})
