<template>
  <div ref="dialog" tabindex="-1" role="dialog" aria-modal="true" :aria-label="t('canvas.importFromImage')" @keydown.esc.stop="emit('close')" class="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-[2px] sm:p-6" @click.self="$emit('close')">
    <div class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-dark-700 dark:bg-dark-900">
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-dark-700">
        <span class="text-sm font-bold">{{ t('canvas.importFromImage') }}</span>
        <button
          type="button"
          :aria-label="t('common.close')"
          :title="t('common.close')"
          autofocus
          class="grid h-8 w-8 place-items-center rounded-lg border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-800 dark:border-dark-600 dark:hover:text-gray-100"
          @click="$emit('close')"
        ><Icon name="x" size="sm" /></button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <p class="mb-3 text-[11px] text-gray-400">{{ t('canvas.importHint') }}</p>
        <div v-if="items.length === 0" class="flex h-40 items-center justify-center text-sm text-gray-400">{{ t('canvas.importEmpty') }}</div>
        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            class="group relative overflow-hidden rounded-xl border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            :class="selected.has(item.id) ? 'border-emerald-500' : 'border-gray-200 hover:border-gray-400 dark:border-dark-700 dark:hover:border-dark-500'"
            :disabled="!selected.has(item.id) && selected.size >= maxSelect"
            @click="toggle(item.id)"
          >
            <img v-if="objectUrlFor(item)" :src="objectUrlFor(item)" class="aspect-square w-full bg-gray-100 object-cover dark:bg-dark-800" alt="" />
            <span class="absolute left-1 top-1 max-w-[calc(100%-2rem)] truncate rounded bg-black/65 px-1.5 py-px text-[10px] font-medium text-white">{{ item.model }}</span>
            <span v-if="selected.has(item.id)" class="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white" aria-hidden="true"><Icon name="check" size="xs" /></span>
            <span class="block truncate px-1 py-1 text-left text-[10px] text-gray-500 dark:text-gray-400">{{ item.prompt || t('imageStudio.prompt') }}</span>
          </button>
        </div>
      </div>
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-4 py-3 dark:border-dark-700">
        <span class="text-xs text-gray-500">{{ t('canvas.importPicked', { n: selected.size, max: maxSelect }) }}</span>
        <div class="ml-auto flex gap-2">
          <button type="button" class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 dark:border-dark-600 dark:text-gray-300" @click="$emit('close')">{{ t('common.cancel') }}</button>
          <button type="button" class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="selected.size === 0" @click="confirmImport">{{ t('canvas.importConfirm') }}</button>
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
