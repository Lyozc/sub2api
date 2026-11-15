import { describe, expect, it } from 'vitest'
import { compatibleVideoResolution, nearestVideoDuration, videoCapabilities, videoDurationAllowed, videoModelResolutions } from '../videoModelCapabilities'

const durationCases = [
  ['grok-imagine-video', 1, 15],
  ['grok-imagine-video-1.5', 1, 15],
  ['grok-imagine-video-1.5-preview', 1, 15],
  ['grok-imagine-video-1.5-lite', 1, 15],
  ['kling-v2-5-turbo', 5, 10],
  ['kling-video-v2_6', 5, 10],
  ['kling-video-o1', 3, 10],
  ['kling-v3', 3, 15],
  ['kling-v3.0-omni', 3, 15],
  ['kling-video-v3_0_turbo', 3, 15],
  ['kling-v4', 3, 30],
  ['kling-v4-0', 3, 30],
  ['kling-4.0', 3, 30],
  ['kling-v4-flash', 3, 20],
  ['kling-v4.0-flash', 3, 20],
  ['kling-video-v4_0_flash', 3, 20],
] as const

describe('verified video duration limits', () => {
  it.each(durationCases)('restricts both generation modes for %s', (model, min, max) => {
    for (const mode of ['t2v', 'i2v'] as const) {
      const caps = videoCapabilities(model, mode)
      const discrete = /^kling.*2[._-][56]/.test(model)
      for (let seconds = 0; seconds <= 31; seconds++) {
        expect(videoDurationAllowed(seconds, caps), `${mode}: ${seconds}`).toBe(
          discrete ? seconds === 5 || seconds === 10 : seconds >= min && seconds <= max
        )
      }
      for (const value of [-1, 1.5, NaN, Infinity, '5', null]) expect(videoDurationAllowed(value, caps)).toBe(false)
      expect(nearestVideoDuration(max + 10, caps)).toBe(max)
      expect(nearestVideoDuration(0, caps)).toBe(min)
    }
  })

  it('cannot reopen Grok 16–30 seconds with stale server metadata', () => {
    const stale = { ...videoCapabilities('grok-imagine-video-1.5'), durations: Array.from({ length: 30 }, (_, i) => i + 1) }
    const caps = videoCapabilities('grok-imagine-video-1.5', 't2v', { t2v: stale })
    expect(caps.durations.at(-1)).toBe(15)
    expect(videoDurationAllowed(16, caps)).toBe(false)
  })

  it('respects a narrower server declaration', () => {
    const narrower = { ...videoCapabilities('grok-imagine-video'), durations: [5, 10] }
    expect(videoCapabilities('grok-imagine-video', 'i2v', { i2v: narrower }).durations).toEqual([5, 10])
  })
})

describe('video model resolution limits', () => {
  it.each([
    ['grok-imagine-video', ['480p', '720p']],
    ['grok-imagine-video-1.5', ['480p', '720p', '1080p']],
    ['grok-imagine-video-1.5-preview', ['480p', '720p', '1080p']],
    ['grok-imagine-video-1.5-lite', ['480p', '720p', '1080p']],
    ['kling-v2-5-turbo', ['', '720p', '1080p']],
    ['kling-v2-6', ['', '720p', '1080p']],
    ['kling-video-o1', ['', '720p', '1080p']],
    ['kling-v3', ['', '720p', '1080p', '4k']],
    ['kling-v3.0-omni', ['', '720p', '1080p', '4k']],
    ['kling-video-v3_0_turbo', ['', '720p', '1080p']],
    ['kling-v4', ['', '720p', '1080p']],
    ['kling-v4-0', ['', '720p', '1080p']],
    ['kling-4.0', ['', '720p', '1080p']],
    ['kling-v4-flash', ['', '720p']],
    ['kling-v4.0-flash', ['', '720p']],
    ['kling-video-v4_0_flash', ['', '720p']],
    ['new-video-model', ['']],
  ])('only offers verified resolutions for %s', (model, expected) => {
    expect(videoModelResolutions(model)).toEqual(expected)
  })

  it('preserves compatible selections and resets stale settings to a supported value', () => {
    expect(compatibleVideoResolution('grok-imagine-video', '1080p')).toBe('720p')
    expect(compatibleVideoResolution('grok-imagine-video-1.5', '1080p')).toBe('1080p')
    expect(compatibleVideoResolution('kling-v4', '4k')).toBe('720p')
    expect(compatibleVideoResolution('kling-v4-flash', '1080p')).toBe('720p')
    expect(compatibleVideoResolution('kling-v3', '4k')).toBe('4k')
    expect(compatibleVideoResolution('kling-v4-flash', '')).toBe('')
    expect(compatibleVideoResolution('new-video-model', '1080p')).toBe('')
  })
})
