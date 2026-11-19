import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import WorkbenchPopover from '../WorkbenchPopover.vue'
import WorkbenchLayout from '../WorkbenchLayout.vue'

const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); document.body.style.overflow = '' })
function popover(label = 'Output settings') {
  const wrapper = mount(WorkbenchPopover, {attachTo: document.body, props: {label}, slots: {trigger: label, default: '<input aria-label="Draft" />'}})
  cleanup.push(() => wrapper.unmount())
  return wrapper
}

describe('workbench popover interactions', () => {
  it('opens only one settings panel and retains drafts when closed', async () => {
    const first = popover('Model'), second = popover('Output')
    expect(first.get('button').attributes('type')).toBe('button')
    await first.get('button').trigger('click')
    expect(first.get('[role="dialog"]').isVisible()).toBe(true)
    expect(first.get('button').attributes('aria-expanded')).toBe('true')
    await first.get('input').setValue('keep my draft')
    await second.get('button').trigger('click')
    expect(first.get('[role="dialog"]').isVisible()).toBe(false)
    expect(second.get('[role="dialog"]').isVisible()).toBe(true)
    expect(second.get('button').attributes('aria-controls')).not.toBe(first.get('button').attributes('aria-controls'))
    await first.get('button').trigger('click')
    expect(first.get('input').element.value).toBe('keep my draft')
  })

  it('returns focus after Escape and dismisses an outside click', async () => {
    const wrapper = popover()
    await wrapper.get('button').trigger('click')
    await nextTick()
    await wrapper.get('input').trigger('keydown', {key:'Escape'})
    await nextTick()
    expect(wrapper.get('[role="dialog"]').isVisible()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('button').element)
    await wrapper.get('button').trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', {bubbles:true}))
    await nextTick()
    expect(wrapper.get('[role="dialog"]').isVisible()).toBe(false)
  })

  it('closes settings when disabled', async () => {
    const wrapper = popover()
    await wrapper.get('button').trigger('click')
    await wrapper.setProps({disabled:true})
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="dialog"]').isVisible()).toBe(false)
  })
})

describe('workbench fullscreen lifetime', () => {
  it('restores page scrolling on exit and unmount', async () => {
    document.body.style.overflow = 'auto'
    const wrapper = mount(WorkbenchLayout, {props:{label:'Video studio',fullscreen:true}})
    cleanup.push(() => wrapper.unmount())
    expect(document.body.style.overflow).toBe('hidden')
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))
    expect(wrapper.emitted('update:fullscreen')).toEqual([[false]])
    await wrapper.setProps({fullscreen:false})
    expect(document.body.style.overflow).toBe('auto')
    await wrapper.setProps({fullscreen:true})
    wrapper.unmount()
    expect(document.body.style.overflow).toBe('auto')
  })
})

describe('workbench compact history', () => {
  it('closes the history drawer from the backdrop or Escape without leaving fullscreen', async () => {
    const wrapper = mount(WorkbenchLayout, {props:{label:'Video studio',railCollapsed:false,fullscreen:true},slots:{rail:'<button>History item</button>'}})
    cleanup.push(() => wrapper.unmount())
    await wrapper.get('.wb-rail-backdrop').trigger('click')
    expect(wrapper.emitted('update:railCollapsed')).toEqual([[true]])
    await wrapper.get('.wb-rail button').trigger('keydown', {key:'Escape'})
    expect(wrapper.emitted('update:railCollapsed')).toHaveLength(2)
    expect(wrapper.emitted('update:fullscreen')).toBeUndefined()
  })
})
