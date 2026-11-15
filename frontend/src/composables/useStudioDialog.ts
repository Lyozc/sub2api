import { nextTick, onMounted, onUnmounted, watch, type Ref } from 'vue'

export function useStudioDialog(element: Ref<HTMLElement | undefined>, close: () => void, open?: Ref<boolean>) {
  let previous: HTMLElement | null = null
  function focusable() {
    return Array.from(element.value?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') || []).filter(item => item.getClientRects().length)
  }
  async function focus() {
    previous = document.activeElement as HTMLElement | null
    await nextTick()
    ;(focusable()[0] || element.value)?.focus()
  }
  function restore() { if (previous?.isConnected) previous.focus(); previous = null }
  function keydown(event: KeyboardEvent) {
    if (open && !open.value || !element.value) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === 'Tab') {
      const items = focusable(), first = items[0], last = items.at(-1)
      if (!first) { event.preventDefault(); element.value.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !element.value.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !element.value.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
  }
  onMounted(() => { document.addEventListener('keydown', keydown, true); if (!open || open.value) void focus() })
  if (open) watch(open, value => { if (value) void focus(); else restore() })
  onUnmounted(() => { document.removeEventListener('keydown', keydown, true); restore() })
}
