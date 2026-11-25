<template>
  <nav class="studio-sections" :aria-label="t('canvas.studioNav')">
    <button
      v-for="item in sections"
      :key="item.id"
      type="button"
      class="studio-section-link"
      :class="{ 'is-tool': item.tool, 'first-tool': item.id === 'prompts' }"
      :aria-current="active === item.id ? 'page' : undefined"
      :aria-label="t(item.label)"
      @click="select(item.id)"
    >
      <Icon :name="item.icon" size="sm" aria-hidden="true" />
      <span class="studio-section-full">{{ t(item.label) }}</span>
      <span class="studio-section-short" aria-hidden="true">{{ t(item.short) }}</span>
    </button>

    <div ref="disclosure" class="studio-section-overflow" @keydown.esc.stop="close(true)" @focusout="onFocusOut">
      <button
        ref="trigger"
        type="button"
        class="studio-section-link"
        :class="{ 'is-current-tool': currentTool }"
        :aria-expanded="open"
        :aria-label="currentTool ? t('canvas.currentToolMenu', { name: t(currentTool.label) }) : t('canvas.moreTools')"
        :aria-controls="listId"
        @click="open = !open"
        @keydown.down.prevent="openList"
      >
        <Icon :name="currentTool?.icon ?? 'more'" size="sm" aria-hidden="true" />
        <span>{{ currentTool ? t(currentTool.short) : t('common.more') }}</span>
        <Icon name="chevronDown" size="xs" aria-hidden="true" />
      </button>
      <div v-show="open" :id="listId" class="studio-section-list">
        <button
          v-for="item in tools"
          :key="item.id"
          type="button"
          :aria-current="active === item.id ? 'page' : undefined"
          @click="select(item.id, true)"
        >
          <Icon :name="item.icon" size="sm" aria-hidden="true" />
          <span>{{ t(item.label) }}</span>
          <Icon v-if="active === item.id" name="check" size="xs" aria-hidden="true" />
        </button>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import { studioSections, type StudioTab } from './studioSections'

const props = defineProps<{ active: StudioTab }>()
const emit = defineEmits<{ select: [tab: StudioTab] }>()
const { t } = useI18n()
const sections = studioSections
const tools = sections.filter(section => section.tool)
const currentTool = computed(() => tools.find(item => item.id === props.active))
const disclosure = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const listId = useId()
const open = ref(false)

function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}
function select(tab: StudioTab, returnToTrigger = false) {
  close(returnToTrigger)
  emit('select', tab)
}
async function openList() {
  open.value = true
  await nextTick()
  disclosure.value?.querySelector<HTMLButtonElement>('.studio-section-list button')?.focus()
}
function onFocusOut(event: FocusEvent) {
  if (!disclosure.value?.contains(event.relatedTarget as Node | null)) close()
}
onClickOutside(disclosure, () => close())
watch(() => props.active, () => close())
</script>

<style scoped>
.studio-sections { display: flex; align-items: center; gap: 3px; min-width: 0; }
.studio-section-link, .studio-section-list button {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  min-height: 38px; padding: 0 11px; border: 1px solid transparent;
  border-radius: 8px; font-size: 13px; font-weight: 550; color: var(--st-text-soft); white-space: nowrap;
}
.studio-section-link:hover, .studio-section-list button:hover { background: var(--st-surface); color: var(--st-text); }
.studio-section-link[aria-current], .studio-section-link.is-current-tool, .studio-section-list button[aria-current] {
  background: var(--st-accent-soft); color: var(--st-accent-text); border-color: var(--st-accent-border); font-weight: 650;
}
.studio-section-link:focus-visible, .studio-section-list button:focus-visible { outline: 2px solid var(--st-focus); outline-offset: -2px; }
.first-tool { position: relative; margin-left: 12px; }
.first-tool::before { content: ''; position: absolute; left: -9px; height: 16px; width: 1px; background: var(--st-border); }
.studio-section-short, .studio-section-overflow { display: none; }
.studio-section-overflow { position: relative; }
.studio-section-list {
  position: absolute; right: 0; top: calc(100% + 5px); z-index: 45;
  min-width: 160px; padding: 5px; border: 1px solid var(--st-border);
  border-radius: 12px; background: var(--st-panel); box-shadow: var(--st-shadow-lg);
}
.studio-section-list button { display: flex; justify-content: flex-start; width: 100%; min-height: 44px; }
.studio-section-list button span { flex: 1; }
@container studio (max-width: 900px) {
  .studio-section-link.is-tool, .studio-section-full { display: none; }
  .studio-section-short, .studio-section-overflow { display: inline-flex; }
  .studio-section-link { min-height: 44px; }
}
@container studio (max-width: 600px) {
  .studio-sections { flex: 1; justify-content: space-between; gap: 0; }
  .studio-section-link { padding-inline: 6px; gap: 4px; font-size: 12px; }
}
@container studio (max-width: 350px) {
  .studio-section-link { padding-inline: 4px; }
  .studio-section-overflow > button > svg:first-child { display: none; }
}
</style>
