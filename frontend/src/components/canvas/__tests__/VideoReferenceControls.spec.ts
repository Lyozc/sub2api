import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type Ref } from 'vue'
import { emptyVideoReferences } from '@/composables/videoReferences'
import VideoReferenceControls from '../VideoReferenceControls.vue'

const state = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/composables/useVideoStudioEngine', async () => {
  const { ref } = await import('vue')
  const { emptyVideoReferences, validateVideoReferences } = await import('@/composables/videoReferences')
  const { videoCapabilities } = await import('@/composables/videoModelCapabilities')
  const klingReferences = ref(emptyVideoReferences())
  const model = ref('kling-v4')
  const klingSettings = ref({ sound: 'off' })
  const activeKlingReferences = () => ({ ...klingReferences.value, images: klingReferences.value.mode === 'frames' ? klingReferences.value.frames : klingReferences.value.images, media: klingReferences.value.mode === 'reference' ? klingReferences.value.media : [] })
  const engine = {
    klingReferences, model, klingSettings, preparingFirstFrame: ref(false), usesDreaminaVideo: ref(false),
    selectedReferenceError: (_refs: unknown, caps: ReturnType<typeof videoCapabilities>) => validateVideoReferences(activeKlingReferences(), caps.references, klingSettings.value.sound),
    klingReferenceCapabilities: () => ({ frames: videoCapabilities(model.value, 'i2v'), reference: videoCapabilities(model.value, 'reference') }),
    removeKlingReference: (name: string) => { klingReferences.value.media = klingReferences.value.media.filter(item => item.name !== name) },
    addKlingReferenceFiles: vi.fn(), addKlingReferenceURL: vi.fn(), moveKlingKeyframe: vi.fn()
  }
  state.value = engine
  return engine
})

interface ReferenceState {
  klingReferences: Ref<ReturnType<typeof emptyVideoReferences>>
  model: Ref<string>
}
const engine = () => state.value as ReferenceState

describe('video reference original sound controls', () => {
  beforeEach(() => {
    engine().model.value = 'kling-v4'
    engine().klingReferences.value = { ...emptyVideoReferences(), mode: 'reference', images: [{ name: 'image_1', url: 'https://example.com/a.png' }] }
  })

  it('disables original sound for image and audio references until a video is added', async () => {
    const wrapper = mount(VideoReferenceControls)
    expect(wrapper.get('[data-testid="keep-original-sound"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('videoStudio.referenceOriginalNeedsVideo')
    engine().klingReferences.value.media.push({ name: 'audio_1', url: 'https://example.com/a.mp3' })
    await nextTick()
    expect(wrapper.get('[data-testid="keep-original-sound"]').attributes('disabled')).toBeDefined()
    engine().klingReferences.value.media.push({ name: 'video_1', url: 'https://example.com/v.mp4' })
    await nextTick()
    expect(wrapper.get('[data-testid="keep-original-sound"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-testid="keep-original-sound"]').setValue(true)
    expect(engine().klingReferences.value.keepOriginalSound).toBe(true)
    await wrapper.get('[data-slot="video_1"] button').trigger('click')
    expect(engine().klingReferences.value.keepOriginalSound).toBe(false)
    expect(wrapper.get('[data-testid="keep-original-sound"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('clears stale original sound when restoring image-only references or switching modes', async () => {
    engine().klingReferences.value.keepOriginalSound = true
    const wrapper = mount(VideoReferenceControls)
    expect(engine().klingReferences.value.keepOriginalSound).toBe(false)
    engine().klingReferences.value.media.push({ name: 'video_1', url: 'https://example.com/v.mp4' })
    await nextTick()
    await wrapper.get('[data-testid="keep-original-sound"]').setValue(true)
    await wrapper.get('[data-testid="video-reference-mode"]').setValue('frames')
    expect(engine().klingReferences.value.keepOriginalSound).toBe(false)
    expect(wrapper.find('[data-testid="keep-original-sound"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
