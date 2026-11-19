<script lang="ts">
import { ref } from 'vue'
// Module-level owner keeps only one workbench popover open at a time.
const openOwner = ref<symbol | null>(null)
let seq = 0
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    width?: number
    placement?: 'top' | 'bottom'
    disabled?: boolean
    triggerClass?: string
    testid?: string
  }>(),
  { width: 340, placement: 'top', disabled: false, triggerClass: '', testid: undefined }
)
const emit = defineEmits<{ open: []; close: [] }>()

const owner = Symbol('workbench-popover')
const panelId = `wb-popover-${++seq}`
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const panel = ref<HTMLElement>()
const style = ref<Record<string, string>>({})
const isOpen = computed(() => openOwner.value === owner)
const GAP = 8
const MARGIN = 8

function position() {
  const button = trigger.value
  if (!button) return
  const rect = button.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(props.width, vw - MARGIN * 2)
  const left = Math.min(Math.max(MARGIN, rect.left), vw - width - MARGIN)
  const spaceAbove = rect.top - GAP - MARGIN
  const spaceBelow = vh - rect.bottom - GAP - MARGIN
  const above = props.placement === 'top' ? spaceAbove >= Math.min(spaceBelow, 260) : spaceBelow < 260 && spaceAbove > spaceBelow
  const maxHeight = Math.max(48, above ? spaceAbove : spaceBelow)
  style.value = {
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
    ...(above ? { bottom: `${vh - rect.top + GAP}px` } : { top: `${rect.bottom + GAP}px` })
  }
}

function open() {
  if (props.disabled) return
  openOwner.value = owner
}
function close(returnFocus = false) {
  if (!isOpen.value) return
  openOwner.value = null
  if (returnFocus) void nextTick(() => trigger.value?.focus())
}
function toggle() {
  if (isOpen.value) close()
  else open()
}
function onDocPointer(event: PointerEvent) {
  const target = event.target as Node | null
  if (!target || root.value?.contains(target)) return
  // Native pickers/dialogs teleported elsewhere should not close us via their own clicks.
  close()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isOpen.value) {
    event.stopPropagation()
    close(true)
  }
}
function onViewport() {
  if (isOpen.value) position()
}
function bind(on: boolean) {
  if (on) {
    document.addEventListener('pointerdown', onDocPointer, true)
    window.addEventListener('resize', onViewport)
    window.addEventListener('scroll', onViewport, true)
  } else {
    document.removeEventListener('pointerdown', onDocPointer, true)
    window.removeEventListener('resize', onViewport)
    window.removeEventListener('scroll', onViewport, true)
  }
}

watch(isOpen, (value) => {
  bind(value)
  if (value) {
    position()
    emit('open')
    void nextTick(() => {
      position()
      const focusable = Array.from(panel.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ) || []).find(element => !element.closest('[hidden]') && getComputedStyle(element).display !== 'none')
      ;(focusable || panel.value)?.focus()
    })
  } else emit('close')
})
watch(
  () => props.disabled,
  (value) => {
    if (value) close()
  }
)
onBeforeUnmount(() => {
  bind(false)
  if (isOpen.value) openOwner.value = null
})
defineExpose({ open, close, isOpen })
</script>

<template>
  <div ref="root" class="wb-popover" @keydown="onKeydown">
    <button
      ref="trigger"
      type="button"
      class="wb-chip"
      :class="[triggerClass, { open: isOpen }]"
      :aria-expanded="isOpen"
      :aria-controls="panelId"
      aria-haspopup="dialog"
      :aria-label="label"
      :title="label"
      :disabled="disabled"
      :data-testid="testid"
      @click="toggle"
    >
      <slot name="trigger" />
    </button>
    <div
      v-show="isOpen"
      :id="panelId"
      ref="panel"
      class="wb-popover-panel"
      role="dialog"
      :aria-label="label"
      tabindex="-1"
      :style="style"
    >
      <slot :close="close" />
    </div>
  </div>
</template>

<style scoped>
.wb-popover {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.wb-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--vs-border);
  border-radius: 9px;
  background: var(--vs-panel);
  color: var(--vs-secondary);
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
  cursor: pointer;
}
.wb-chip:hover:enabled,
.wb-chip.open {
  border-color: var(--vs-accent-border);
  color: var(--vs-text);
}
.wb-chip.open {
  background: var(--vs-accent-soft);
}
.wb-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.wb-chip:focus-visible {
  outline: 2px solid var(--vs-focus);
  outline-offset: 2px;
}
.wb-chip :deep(.chip-text) {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.wb-popover-panel {
  position: fixed;
  z-index: 60;
  box-sizing: border-box;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 14px;
  border: 1px solid var(--vs-border);
  border-radius: 14px;
  background: var(--vs-panel);
  color: var(--vs-text);
  box-shadow: var(--st-shadow, 0 18px 40px -20px rgba(16, 24, 40, 0.45));
  scrollbar-width: thin;
  scrollbar-color: var(--vs-border-strong) transparent;
}
.wb-popover-panel:focus {
  outline: none;
}
@media (prefers-reduced-motion: no-preference) {
  .wb-popover-panel {
    animation: wb-pop 0.12s ease-out;
  }
}
@keyframes wb-pop {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
</style>
