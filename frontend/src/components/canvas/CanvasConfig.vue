<template>
  <div class="config-wrap">
    <section class="studio-panel config-section" :aria-label="t('canvas.configApi')">
      <div class="studio-panel-head">
        <div class="studio-panel-title">
          <span class="studio-title-mark" aria-hidden="true"><Icon name="server" size="sm" /></span>
          <div class="min-w-0">
            <h2 class="studio-heading">{{ t('canvas.configApi') }}</h2>
            <p class="studio-subheading">{{ t('canvas.configChannelsSubtitle') }}</p>
          </div>
        </div>
        <button
          type="button"
          class="studio-btn studio-btn--ghost studio-btn--sm ml-auto"
          :disabled="loading"
          @click="reload"
        ><Icon name="refresh" size="xs" aria-hidden="true" />{{ t('canvas.configRetry') }}</button>
      </div>
      <div class="config-body">
        <p class="studio-note">{{ t('canvas.configApiDesc') }}</p>
        <div class="config-rows">
          <div class="studio-row">
            <span class="studio-row-label">
              <span class="studio-dot" :class="dotClass(imageError)" aria-hidden="true"></span>
              {{ t('canvas.configImageKey') }}
            </span>
            <span class="studio-row-value" :class="valueClass(imageError)">{{ statusText(imageError) }}</span>
          </div>
          <div class="studio-row">
            <span class="studio-row-label">
              <span class="studio-dot" :class="dotClass(videoError)" aria-hidden="true"></span>
              {{ t('canvas.configVideoKey') }}
            </span>
            <span class="studio-row-value" :class="valueClass(videoError)">{{ statusText(videoError) }}</span>
          </div>
        </div>
        <p v-if="imageError" role="alert" class="studio-alert">
          <Icon name="exclamationCircle" size="sm" class="mt-px shrink-0" aria-hidden="true" /><span>{{ imageError }}</span>
        </p>
        <p v-if="videoError" role="alert" class="studio-alert">
          <Icon name="exclamationCircle" size="sm" class="mt-px shrink-0" aria-hidden="true" /><span>{{ videoError }}</span>
        </p>
        <p class="studio-note studio-note--muted">{{ t('canvas.configNote') }}</p>
      </div>
    </section>

    <section class="studio-panel config-section" :aria-label="t('canvas.configGroups')">
      <div class="studio-panel-head">
        <div class="studio-panel-title">
          <span class="studio-title-mark" aria-hidden="true"><Icon name="database" size="sm" /></span>
          <div class="min-w-0">
            <h2 class="studio-heading">{{ t('canvas.configGroups') }}</h2>
            <p class="studio-subheading">{{ t('canvas.configGroupsSubtitle') }}</p>
          </div>
        </div>
        <span v-if="groups.length" class="studio-count ml-auto">{{ groups.length }}</span>
      </div>
      <div class="config-body">
        <div v-if="groups.length" class="config-rows">
          <div v-for="g in groups" :key="g.id + g.name" class="studio-row">
            <span class="studio-row-label">
              <strong class="config-group-name">{{ g.name }}</strong>
              <span v-if="g.platform" class="studio-tag">{{ g.platform }}</span>
            </span>
            <span class="studio-row-value studio-value--muted">{{ g.count }} {{ t('canvas.modelsUnit') }}</span>
          </div>
        </div>
        <p v-else-if="loading" class="studio-note">{{ t('canvas.configLoading') }}</p>
        <p v-else class="studio-note">{{ t('canvas.noGroups') }}</p>
      </div>
    </section>

    <section class="studio-panel config-section" :aria-label="t('canvas.configAbout')">
      <div class="studio-panel-head">
        <div class="studio-panel-title">
          <span class="studio-title-mark" aria-hidden="true"><Icon name="infoCircle" size="sm" /></span>
          <h2 class="studio-heading">{{ t('canvas.configAbout') }}</h2>
        </div>
      </div>
      <div class="config-body">
        <p class="studio-note">{{ t('canvas.configAboutDesc') }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import {
  models as imageModels, loadModels as loadImageModels, initError as imageError,
} from '@/composables/useImageStudioEngine'
import { models as videoModels, loadModels as loadVideoModels, initError as videoError } from '@/composables/useVideoStudioEngine'
import './studio-shell.css'

const { t } = useI18n()

const loading = ref(true)
let disposed = false
const groups = computed(() => {
  const map = new Map<number, { id: number; name: string; platform: string; count: number }>()
  const options = [...(!imageError.value ? imageModels.value : []), ...(!videoError.value ? videoModels.value : [])]
  const seen = new Set<string>()
  for (const model of options) {
    if (!model.group_id || seen.has(`${model.group_id}:${model.id}`)) continue
    seen.add(`${model.group_id}:${model.id}`)
    const row = map.get(model.group_id) || { id: model.group_id, name: model.group_name || String(model.group_id), platform: model.platform || '', count: 0 }
    row.count++
    map.set(model.group_id, row)
  }
  return [...map.values()]
})
/** 状态文案只反映真实加载结果:加载中 / 不可用 / 已就绪 */
function statusText(error: string) {
  return t(loading.value ? 'canvas.configLoading' : error ? 'canvas.configUnavailable' : 'canvas.configReady')
}
function dotClass(error: string) {
  if (loading.value) return ''
  return error ? 'studio-dot--error' : 'studio-dot--ok'
}
function valueClass(error: string) {
  if (loading.value) return 'studio-value--muted'
  return error ? 'studio-value--error' : 'studio-value--ok'
}
async function reload() {
  loading.value = true
  try { await Promise.all([loadImageModels(), loadVideoModels()]) }
  finally { if (!disposed) loading.value = false }
}
onMounted(reload)
onUnmounted(() => { disposed = true })
</script>

<style scoped>
.config-wrap {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
  align-content: start;
  gap: 14px;
  max-width: 62rem;
  margin: 0 auto;
}
.config-section {
  min-width: 0;
}
.config-section:last-child {
  grid-column: 1 / -1;
}
.config-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px 16px;
}
.config-rows {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.config-group-name {
  min-width: 0;
  color: var(--st-text);
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
