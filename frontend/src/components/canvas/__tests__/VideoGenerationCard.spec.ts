import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import VideoGenerationCard from '../VideoGenerationCard.vue'
import { retryTask, stopWaiting, type VideoTask } from '@/composables/useVideoStudioEngine'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/composables/useVideoStudioEngine', () => ({ retryTask: vi.fn(), stopWaiting: vi.fn(), archiveVideoTask: vi.fn(), recordVideoMetadata: vi.fn() }))
const task = (data: Partial<VideoTask> = {}): VideoTask => ({
  taskId: 12, remoteId: '', status: 'pending', prompt: 'test video',
  model: 'kling-v4-flash', seconds: 10, resolution: '720p', submittedAt: 1, ...data
})

describe('video generation receipt presentation', () => {
  it('shows acknowledgement recovery separately from a queued video and allows stopping', async () => {
    const value = reactive(task({ submissionRecovering: true, submissionUnconfirmed: true }))
    const wrapper = mount(VideoGenerationCard, { props: { task: value, now: 2000 } })
    expect(wrapper.text()).toContain('videoStudio.checkingSubmission')
    expect(wrapper.text()).not.toContain('videoStudio.queued')
    await wrapper.get('button.text-action').trigger('click')
    expect(stopWaiting).toHaveBeenCalledWith(12)
    value.submissionRecovering = false
    value.remoteId = 'original-job'
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('videoStudio.queued')
    wrapper.unmount()
  })

  it('keeps an upstream error visible and offers checking the original uncertain task', async () => {
    const wrapper = mount(VideoGenerationCard, { props: { now: 2000, task: task({ status: 'failed', submissionUnconfirmed: true, error: 'Official Kling CLI request failed\nCheck the original task' }) } })
    expect(wrapper.get('.task-error').text()).toContain('Official Kling CLI request failed')
    expect(wrapper.text()).toContain('videoStudio.checkSubmission')
    expect(wrapper.text()).not.toContain('videoStudio.regenerate')
    await wrapper.get('button.action.primary').trigger('click')
    expect(retryTask).toHaveBeenCalledWith(12)
    wrapper.unmount()
  })
})
