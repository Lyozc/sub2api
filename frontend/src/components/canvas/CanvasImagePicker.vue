<template>
  <div ref="dialog" tabindex="-1" role="dialog" aria-modal="true" :aria-label="t('canvas.importFromImage')" @keydown.esc.stop="emit('close')" class="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-[2px] sm:p-6" @click.self="$emit('close')">
    <div class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--st-border)] bg-[var(--st-panel)] shadow-2xl  ">
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--st-border)] px-4 py-3 ">
        <span class="text-sm font-bold">{{ t('canvas.importFromImage') }}</span>
        <button
          type="button"
          :aria-label="t('common.close')"
          :title="t('common.close')"
          autofocus
          class="grid h-8 w-8 place-items-center rounded-lg border border-[var(--st-border)] text-[var(--st-muted)] hover:border-[var(--st-border-strong)] hover:text-[var(--st-text)]  "
          @click="$emit('close')"
        ><Icon name="x" size="sm" /></button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <p class="mb-3 text-[11px] text-[var(--st-muted)]">{{ t('canvas.importHint') }}</p>
        <div v-if="items.length === 0" class="flex h-40 items-center justify-center text-sm text-[var(--st-muted)]">{{ t('canvas.importEmpty') }}</div>
        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            class="group relative overflow-hidden rounded-xl border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            :class="selected.has(item.id) ? 'border-[var(--st-accent)]' : 'border-[var(--st-border)] hover:border-[var(--st-border-strong)]  '"
            :disabled="!selected.has(item.id) && selected.size >= maxSelect"
            @click="toggle(item.id)"
          >
            <img v-if="objectUrlFor(item)" :src="objectUrlFor(item)" class="aspect-square w-full bg-[var(--st-surface)] object-cover " alt="" />
            <span class="absolute left-1 top-1 max-w-[calc(100%-2rem)] truncate rounded bg-black/65 px-1.5 py-px text-[10px] font-medium text-white">{{ item.model }}</span>
            <span v-if="selected.has(item.id)" class="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--st-accent)] text-[var(--st-accent-on)]" aria-hidden="true"><Icon name="check" size="xs" /></span>
            <span class="block truncate px-1 py-1 text-left text-[10px] text-[var(--st-muted)] ">{{ item.prompt || t('imageStudio.prompt') }}</span>
          </button>
        </div>
      </div>
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--st-border)] px-4 py-3 ">
        <span class="text-xs text-[var(--st-muted)]">{{ t('canvas.importPicked', { n: selected.size, max: maxSelect }) }}</span>
        <div class="ml-auto flex gap-2">
          <button type="button" class="rounded-lg border border-[var(--st-border)] px-3 py-1.5 text-xs font-medium text-[var(--st-text-soft)] hover:border-[var(--st-border-strong)]  " @click="$emit('close')">{{ t('common.cancel') }}</button>
          <button type="button" class="rounded-lg bg-[var(--st-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--st-accent-on)] hover:bg-[var(--st-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="selected.size === 0" @click="confirmImport">{{ t('canvas.importConfirm') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/components/icons/Icon.vue'
import { useStudioDialog } from '@/composables/useStudioDialog'
import { useStudioImageAssets, type StudioImageAsset } from '@/composables/useStudioImageAssets'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ maxSelect: number }>()
const emit = defineEmits<{ close: []; import: [StudioImageAsset[]] }>()
const { t } = useI18n()
const dialog = ref<HTMLElement>()
useStudioDialog(dialog, () => emit('close'))

const selected = ref(new Set<string>())

const { items, objectUrlFor } = useStudioImageAssets()

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else {
    if (next.size >= props.maxSelect) return
    next.add(id)
  }
  selected.value = next
}

function confirmImport() {
  const picked = items.value.filter(it => selected.value.has(it.id))
  if (picked.length) emit('import', picked)
  emit('close')
}
</script>
