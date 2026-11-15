import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import VideoParameterControls from '../VideoParameterControls.vue'

function render(durations: number[], duration = durations[0]) {
  return mount(VideoParameterControls, {
    props: {
      resolution: '720p', resolutionOptions: ['720p'], supportedResolutions: ['720p'],
      duration, durationMin: durations[0], durationMax: durations[durations.length - 1],
      durationStep: durations.length > 1 ? durations[1] - durations[0] : 1,
      durationTicks: durations, allowedDurations: durations, ratios: [], ratio: 'auto', quantity: 1,
      labels: {
        resolution: 'Resolution', duration: 'Duration', ratio: 'Ratio', output: 'Quantity',
        seconds: 'seconds', defaultResolution: 'Default', resolutionHint: '', unsupportedResolution: '', durationHint: 'Supported durations'
      }
    }
  })
}

describe('video duration controls', () => {
  it('only offers 5 and 10 seconds for discrete models', async () => {
    const wrapper = render([5, 10])
    const select = wrapper.get('[data-testid="video-duration"]')
    expect(select.element.tagName).toBe('SELECT')
    expect(select.findAll('option').map(option => option.attributes('value'))).toEqual(['5', '10'])
    await select.setValue('10')
    expect(wrapper.emitted('update:duration')?.at(-1)).toEqual([10])
    wrapper.unmount()
  })

  it('marks an out-of-range number invalid while editing and restores a supported value on blur', async () => {
    const wrapper = render(Array.from({ length: 15 }, (_, index) => index + 1), 6)
    const input = wrapper.get('[data-testid="video-duration"]')
    expect(input.attributes('min')).toBe('1')
    expect(input.attributes('max')).toBe('15')
    await input.setValue('16')
    await wrapper.setProps({ duration: 16 })
    expect(input.attributes('aria-invalid')).toBe('true')
    await input.trigger('blur')
    expect(wrapper.emitted('update:duration')?.at(-1)).toEqual([15])
    await wrapper.setProps({ duration: NaN })
    await input.trigger('blur')
    expect(wrapper.emitted('update:duration')?.at(-1)).toEqual([1])
    wrapper.unmount()
  })

  it('never emits an unsupported duration from a slider event', async () => {
    const wrapper = render([3, 5, 10], 5)
    await wrapper.get('[data-testid="video-duration-slider"]').setValue('7')
    expect(wrapper.emitted('update:duration')?.at(-1)).toEqual([5])
    wrapper.unmount()
  })
})
