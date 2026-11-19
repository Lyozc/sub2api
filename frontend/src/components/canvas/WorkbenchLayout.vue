<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps<{ label: string; fullscreen?: boolean; railCollapsed?: boolean; railCloseLabel?: string }>()
const emit = defineEmits<{ 'update:fullscreen': [value: boolean]; 'update:railCollapsed': [value: boolean] }>()

let previousOverflow: string | null = null
function onKeydown(event: KeyboardEvent) {
  // Popovers stop propagation of their own Escape, so this only fires when none is open.
  if (event.key === 'Escape' && props.fullscreen && !event.defaultPrevented) emit('update:fullscreen', false)
}
function lock(on: boolean) {
  if (on) {
    if (previousOverflow === null) previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeydown)
  } else {
    if (previousOverflow !== null) document.body.style.overflow = previousOverflow
    previousOverflow = null
    window.removeEventListener('keydown', onKeydown)
  }
}
watch(() => !!props.fullscreen, lock, { immediate: true })
onBeforeUnmount(() => lock(false))
</script>

<template>
  <section
    class="workbench"
    :class="{ 'is-fullscreen': fullscreen, 'rail-collapsed': railCollapsed }"
    :aria-label="label"
  >
    <button v-if="!railCollapsed" class="wb-rail-backdrop" type="button" :aria-label="railCloseLabel || 'Close recent creations'" @click="emit('update:railCollapsed', true)" />
    <aside class="wb-rail" @keydown.esc.stop="emit('update:railCollapsed', true)"><slot name="rail" /></aside>
    <div class="wb-main">
      <header class="wb-header"><slot name="header" /></header>
      <div class="wb-canvas"><slot /></div>
      <div class="wb-composer"><slot name="composer" /></div>
    </div>
    <slot name="overlay" />
  </section>
</template>

<style scoped>
.workbench {
  position: relative;
  display: grid;
  grid-template-columns: 272px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--st-bg, #f4f6f8);
  color: var(--vs-text);
  border: 1px solid var(--vs-border);
  border-radius: 18px;
  box-shadow: var(--st-shadow, 0 10px 30px -22px rgba(16, 24, 40, 0.35));
}
:global(.dark) .workbench {
  background: var(--st-bg, #0e1626);
}
.workbench.rail-collapsed {
  grid-template-columns: 0 minmax(0, 1fr);
}
.workbench.rail-collapsed .wb-rail {
  visibility: hidden;
  border-right: 0;
}
.workbench.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 50;
  border-radius: 0;
  border: 0;
}
.wb-rail-backdrop { display: none; }
.wb-rail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  border-right: 1px solid var(--vs-border);
  background: var(--vs-panel);
}
.wb-main {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.wb-header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--vs-border);
}
.wb-canvas {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.wb-composer {
  flex-shrink: 0;
  padding: 0 20px 16px;
}
@media (max-width: 1100px) {
  .workbench {
    grid-template-columns: 228px minmax(0, 1fr);
  }
}
@media (max-width: 860px) {
  .workbench,
  .workbench.rail-collapsed {
    display: flex;
    flex-direction: column;
  }
  .wb-rail {
    position: absolute;
    z-index: 42;
    inset: 0 auto 0 0;
    width: min(272px, calc(100% - 24px));
    max-height: none;
    border-right: 1px solid var(--vs-border);
    box-shadow: var(--st-shadow-lg);
  }
  .wb-rail-backdrop {
    position: absolute;
    z-index: 41;
    inset: 0;
    display: block;
    width: 100%;
    border: 0;
    background: var(--vs-text);
    opacity: .12;
  }
  .workbench.rail-collapsed .wb-rail {
    display: none;
  }
  .wb-main {
    flex: 1;
  }
  .wb-composer {
    padding: 0 10px 10px;
  }
}
</style>
