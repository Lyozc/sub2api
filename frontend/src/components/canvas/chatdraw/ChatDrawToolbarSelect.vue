<template>
  <div ref="root" class="relative inline-flex shrink-0" @keydown.esc="onEscape">
    <button
      type="button"
      class="inline-flex h-8 max-w-[14rem] items-center gap-1.5 whitespace-nowrap rounded-full border bg-[var(--st-panel)]/95 px-3 text-xs text-[var(--st-text-soft)] shadow-sm backdrop-blur transition-colors hover:border-[var(--st-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
      :class="open ?'border-[var(--st-accent-border)]' :'border-[var(--st-border)]'"
      :disabled="disabled"
      :title="label"
      :aria-label="`${label}: ${currentLabel}`"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
      @keydown.down.prevent="openAndFocus"
    >
      <span class="text-[var(--st-muted)]">{{ label }}</span>
      <span class="min-w-0 truncate font-medium">{{ currentLabel }}</span>
      <Icon name="chevronDown" size="xs" class="shrink-0 transition-transform" :class="open ?'rotate-180' :''" />
    </button>
    <div
      v-if="open"
      ref="menu"
      role="listbox"
      :aria-label="label"
      :style="menuStyle"
      class="absolute left-0 z-40 max-h-72 min-w-[10rem] max-w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-[var(--st-border)] bg-[var(--st-panel)] p-1.5 shadow-xl"
      :class="openUp ?'bottom-[calc(100%+0.5rem)]' :'top-[calc(100%+0.5rem)]'"
      @keydown.esc.prevent="close(true)"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
    >
      <button
        v-for="opt in options"
        :key="String(opt.value)"
        type="button"
        role="option"
        :aria-selected="opt.value === modelValue"
        class="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--st-surface)] focus:bg-[var(--st-surface)] focus:outline-none"
        :class="opt.value === modelValue ?'font-semibold text-[var(--st-text)]' :'text-[var(--st-text-soft)]'"
        @click="pick(opt.value)"
      >
        <span class="min-w-0 flex-1 truncate">{{ opt.label }}</span>
        <span v-if="opt.hint" class="shrink-0 text-[10px] text-[var(--st-muted)]">{{ opt.hint }}</span>
        <Icon v-if="opt.value === modelValue" name="check" size="xs" class="shrink-0 text-[var(--st-accent-text)]" />
      </button>
      <div v-if="!options.length" class="px-2.5 py-1.5 text-xs text-[var(--st-muted)]">{{ emptyText }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 输入区上方的胶囊下拉(仿参照 StudioToolbarSelectButton:按钮触发 + 向上弹出的选项面板) */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '@/components/icons/Icon.vue'
import type { ToolbarOption, ToolbarValue } from './format'

type T = ToolbarValue
const props = defineProps<{
  modelValue: T
  options: ToolbarOption[]
  label: string
  disabled?: boolean
  emptyText?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T]; change: [value: T] }>()

const open = ref(false)
/** 弹出方向:按钮上方空间放得下菜单则向上,否则向下(设置面板里向上弹会被视口顶边截断) */
const openUp = ref(true)
const menuStyle = ref<Record<string, string>>({})
const root = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const currentLabel = computed(() => props.options.find(o => o.value === props.modelValue)?.label ?? (props.emptyText || '—'))

function toggle() {
  if (open.value) close()
  else open.value = true
}
/** 菜单渲染后按实际高度选方向;打开前先用最大高度预估一次,避免先向上闪现再翻转 */
function fitDirection() {
  const rect = root.value?.getBoundingClientRect()
  if (!rect) return
  const bounds = root.value?.closest('.chat-draw-settings')?.getBoundingClientRect()
  const top = Math.max(8, (bounds?.top ?? 0) + 8)
  const bottom = Math.min(window.innerHeight - 8, (bounds?.bottom ?? window.innerHeight) - 8)
  const above = rect.top - top - 8, below = bottom - rect.bottom - 8
  const menuH = Math.min(menu.value?.scrollHeight ?? 288, 288)
  openUp.value = above >= menuH || above > below
  const left = Math.max(8, (bounds?.left ?? 0) + 8)
  const right = Math.min(window.innerWidth - 8, (bounds?.right ?? window.innerWidth) - 8)
  const width = Math.min(352, Math.max(rect.width, 160), right - left)
  menuStyle.value = {
    maxHeight: `${Math.max(44, openUp.value ? above : below)}px`,
    width: `${width}px`, minWidth: `${Math.min(width, 160)}px`,
    left: `${Math.max(left - rect.left, Math.min(0, right - rect.left - width))}px`
  }
}
function close(refocus = false) {
  open.value = false
  if (refocus) root.value?.querySelector('button')?.focus()
}
function onEscape(event: KeyboardEvent) {
  if (!open.value) return
  event.preventDefault()
  event.stopPropagation()
  close(true)
}
function pick(v: T) {
  emit('update:modelValue', v)
  emit('change', v)
  close(true)
}
async function openAndFocus() {
  open.value = true
  await nextTick()
  const items = optionEls()
  const idx = props.options.findIndex(o => o.value === props.modelValue)
  items[Math.max(0, idx)]?.focus()
}
function optionEls(): HTMLElement[] {
  return Array.from(menu.value?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
}
function move(step: number) {
  const items = optionEls()
  if (!items.length) return
  const cur = items.indexOf(document.activeElement as HTMLElement)
  items[(cur + step + items.length) % items.length].focus()
}
function onDocPointer(e: PointerEvent) {
  if (root.value && !root.value.contains(e.target as Node)) close()
}
watch(open, v => {
  if (v) {
    // 先按菜单上限预估方向,渲染完成后按实际高度再校准一次(选项少时菜单矮,向上更自然)
    fitDirection()
    void nextTick(() => fitDirection())
    document.addEventListener('pointerdown', onDocPointer)
  } else {
    document.removeEventListener('pointerdown', onDocPointer)
  }
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointer))
</script>
