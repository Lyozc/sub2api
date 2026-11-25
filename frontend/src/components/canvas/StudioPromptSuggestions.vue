<template>
  <ul class="studio-suggestions" :aria-label="label">
    <li v-for="option in options" :key="option.title">
      <button type="button" @click="emit('pick', option.prompt)">
        <img v-if="option.image" :src="option.image" width="480" height="270" alt="" />
        <span class="suggestion-content">
          <span class="suggestion-title">
            <Icon v-if="option.icon" :name="option.icon" size="sm" aria-hidden="true" />
            {{ option.title }}
            <Icon name="arrowRight" size="xs" class="suggestion-arrow" aria-hidden="true" />
          </span>
          <span class="suggestion-prompt">{{ option.prompt }}</span>
        </span>
      </button>
    </li>
  </ul>
</template>

<script setup lang="ts">
import Icon from '@/components/icons/Icon.vue'

defineProps<{
  label: string
  options: ReadonlyArray<{
    title: string
    prompt: string
    icon?: 'lightbulb' | 'edit' | 'book'
    image?: string
  }>
}>()
const emit = defineEmits<{ pick: [prompt: string] }>()
</script>

<style scoped>
.studio-suggestions {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 175px), 1fr));
  gap: 12px; width: 100%; margin: 0; padding: 0; list-style: none; text-align: start;
}
.studio-suggestions button {
  display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden;
  border: 1px solid var(--st-border); border-radius: 14px; background: var(--st-panel);
  color: var(--st-text); text-align: inherit; box-shadow: var(--st-shadow-sm);
}
.studio-suggestions button:hover, .studio-suggestions button:focus-visible { border-color: var(--st-accent); }
.studio-suggestions button:focus-visible { outline: 2px solid var(--st-focus); outline-offset: 2px; }
.studio-suggestions img { width: 100%; height: 92px; object-fit: cover; }
.suggestion-content { display: grid; gap: 6px; padding: 14px; width: 100%; min-width: 0; }
.suggestion-title { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 650; }
.suggestion-title svg { color: var(--st-accent-text); flex-shrink: 0; }
.suggestion-arrow { margin-inline-start: auto; }
.suggestion-prompt { color: var(--st-text-soft); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
@container studio (max-width: 600px) {
  .studio-suggestions { grid-template-columns: minmax(0,1fr); gap: 7px; }
  .studio-suggestions button { flex-direction: row; align-items: center; }
  .studio-suggestions img { margin-inline-start: 7px; width: 62px; height: 48px; border-radius: 8px; flex-shrink: 0; }
  .suggestion-content { padding: 9px 11px; gap: 2px; }
  .suggestion-title { font-size: 13px; }
  .suggestion-prompt { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
}
</style>
