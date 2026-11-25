import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { marked } from 'marked'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StudioChatMessage } from '@/composables/studioChatStorage'
import StudioChatMessageRow from '../StudioChatMessageRow.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: { seconds: number }) => params ? String(params.seconds) : key
  })
}))

function row(message: StudioChatMessage) {
  return mount(StudioChatMessageRow, {
    props: {
      message,
      last: true,
      copied: false,
      retryDisabled: false,
      previewVisible: false,
      previewCreated: false,
      zoomed: false
    }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('studio chat rendering', () => {
  it('shows growing replies as text and only formats each settled message once', async () => {
    const parse = vi.spyOn(marked, 'parse')
    const message = reactive<StudioChatMessage>({ id: 'reply', role: 'assistant', status: 'streaming', content: '' })
    const wrapper = row(message)

    for (const part of ['## Result\n\n', 'x'.repeat(24_000), '<img src=x onerror="boom">']) {
      message.content += part
      await nextTick()
      expect(wrapper.get('.chat-live-text').text()).toBe(message.content.trim())
      expect(wrapper.find('img').exists()).toBe(false)
    }
    expect(parse).not.toHaveBeenCalled()
    message.status = 'done'
    await nextTick()
    expect(wrapper.find('.chat-live-text').exists()).toBe(false)
    expect(wrapper.get('.chat-markdown h2').text()).toBe('Result')
    expect(wrapper.find('img').exists()).toBe(false)
    await wrapper.setProps({ copied: true })
    await wrapper.setProps({ last: false })
    expect(parse).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('updates elapsed time during silence and clears the timer on the first text', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-25T10:00:00Z'))
    const message = reactive<StudioChatMessage>({
      id: 'pending', role: 'assistant', status: 'streaming', content: '', startedAt: Date.now() - 10_000
    })
    const wrapper = row(message)
    expect(wrapper.get('[role="timer"]').text()).toBe('10')
    vi.advanceTimersByTime(4_000)
    await nextTick()
    expect(wrapper.get('[role="timer"]').text()).toBe('14')
    message.content = 'First characters'
    await nextTick()
    expect(wrapper.find('[role="timer"]').exists()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    wrapper.unmount()
  })
})
