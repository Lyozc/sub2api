<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { klingReferences, klingSettings, model, preparingFirstFrame, activeKlingReferences, klingReferenceCapabilities, addKlingReferenceFiles, addKlingReferenceURL, removeKlingReference, moveKlingKeyframe } from '@/composables/useVideoStudioEngine'
import { referenceImageLimit, validateVideoReferences } from '@/composables/videoReferences'
const { t } = useI18n()
const emit = defineEmits<{ pick: [] }>()
const url = ref('')
const kind = ref<'image' | 'video' | 'audio' | 'input' | 'tail_image' | 'keyframe'>('input')
const allCaps = computed(klingReferenceCapabilities)
const caps = computed(() => allCaps.value[klingReferences.value.mode])
const limits = computed(() => caps.value.references)
const entries = computed(() => klingReferences.value.mode === 'frames' ? klingReferences.value.frames : klingReferences.value.images)
const media = computed(() => klingReferences.value.mode === 'reference' ? klingReferences.value.media : [])
const error = computed(() => validateVideoReferences(activeKlingReferences(), limits.value, klingSettings.value.sound))
const options = computed(() => {
  const value = limits.value
  if (!value) return []
  return [
    ...(value.image_slots.includes('input') ? [{ value: 'input' as const, label: 'firstFrame' }] : []),
    ...(value.image_slots.includes('tail_image') ? [{ value: 'tail_image' as const, label: 'tailFrame' }] : []),
    ...(value.image_slots.some(name => name.startsWith('keyframe_')) ? [{ value: 'keyframe' as const, label: 'keyframes' }] : []),
    ...(value.image_slots.some(name => name.startsWith('image_')) ? [{ value: 'image' as const, label: 'referenceImages' }] : []),
    ...(value.video_slots.length ? [{ value: 'video' as const, label: 'referenceVideos' }] : []),
    ...(value.audio_slots.length ? [{ value: 'audio' as const, label: 'referenceAudio' }] : [])
  ]
})
watch(limits, value=>{ if(value?.multi_shots_required) klingReferences.value.preferMultiShots=true }, {immediate:true})
watch(options, value => { if (!value.some(item => item.value === kind.value)) kind.value = value[0]?.value || 'input' }, { immediate: true })
watch([model, allCaps, () => klingReferences.value], () => {
  const draft = klingReferences.value
  if (!draft.frames.length && !draft.images.length && !draft.media.length && !allCaps.value[draft.mode].references) draft.mode = allCaps.value.frames.references ? 'frames' : 'reference'
}, { immediate: true })
watch(() => klingReferences.value.keepOriginalSound, keep => { if (keep && klingSettings.value.sound === 'on') klingSettings.value.sound = 'off' })
function label(name: string) {
  if (name === 'input') return t('videoStudio.firstFrame')
  if (name === 'tail_image') return t('videoStudio.tailFrame')
  const [prefix, index] = name.split('_')
  return `${t(`videoStudio.${prefix === 'keyframe' ? 'keyframes' : prefix === 'image' ? 'referenceImages' : prefix === 'video' ? 'referenceVideos' : 'referenceAudio'}`)} ${index}`
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  await addKlingReferenceFiles(Array.from(input.files || []), kind.value)
  input.value = ''
}
function addURL() { if (addKlingReferenceURL(url.value, kind.value)) url.value = '' }
</script>

<template>
  <section class="reference-controls" data-testid="video-references">
    <label for="video-reference-mode">{{ t('videoStudio.referenceMode') }}</label>
    <select id="video-reference-mode" v-model="klingReferences.mode" data-testid="video-reference-mode" :disabled="preparingFirstFrame">
      <option value="frames" :disabled="!allCaps.frames.references">{{ t('videoStudio.referenceFrames') }}</option>
      <option value="reference" :disabled="!allCaps.reference.references">{{ t('videoStudio.referenceOmni') }}</option>
    </select>
    <button type="button" @click="emit('pick')">{{ t('videoStudio.materials') }}</button>
    <p v-if="limits" class="reference-hint">
      {{ t('videoStudio.referenceLimits', { images: referenceImageLimit(limits, media), total: limits.max_total, videos: limits.video_slots.length, audio: limits.audio_slots.length }) }}
    </p>
    <p v-else class="reference-error" role="alert">{{ t('videoStudio.referenceUnsupported') }}</p>
    <div v-if="entries.length" class="reference-grid">
      <article v-for="item in entries" :key="item.name" class="reference-card" :data-slot="item.name">
        <img :src="item.url" :alt="label(item.name)" referrerpolicy="no-referrer" />
        <span>{{ label(item.name) }}</span>
        <div class="reference-actions">
          <template v-if="item.name.startsWith('keyframe_')">
            <button type="button" :aria-label="t('videoStudio.referenceMoveUp')" :disabled="item.name === 'keyframe_1' || preparingFirstFrame" @click="moveKlingKeyframe(item.name, -1)">↑</button>
            <button type="button" :aria-label="t('videoStudio.referenceMoveDown')" :disabled="item.name === entries.filter(entry => entry.name.startsWith('keyframe_')).at(-1)?.name || preparingFirstFrame" @click="moveKlingKeyframe(item.name, 1)">↓</button>
          </template>
          <button type="button" :aria-label="t('videoStudio.removeReference', { name: label(item.name) })" :disabled="preparingFirstFrame" @click="removeKlingReference(item.name)">×</button>
        </div>
      </article>
    </div>
    <ul v-if="media.length" class="reference-media-list">
      <li v-for="item in media" :key="item.name" :data-slot="item.name">
        <div><strong>{{ label(item.name) }}</strong><span :title="item.url">{{ item.url }}</span></div>
        <button type="button" :aria-label="t('videoStudio.removeReference', { name: label(item.name) })" :disabled="preparingFirstFrame" @click="removeKlingReference(item.name)">×</button>
      </li>
    </ul>
    <div class="reference-add">
      <label for="video-reference-kind">{{ t('videoStudio.referenceType') }}</label>
      <select id="video-reference-kind" v-model="kind" data-testid="video-reference-kind" :disabled="preparingFirstFrame || !options.length">
        <option v-for="option in options" :key="option.value" :value="option.value">{{ t(`videoStudio.${option.label}`) }}</option>
      </select>
      <label v-if="!['video', 'audio'].includes(kind) && options.length" class="reference-upload">
        {{ t('videoStudio.uploadReferences') }}
        <input type="file" accept="image/png,image/jpeg,image/webp" :multiple="kind === 'image' || kind === 'keyframe'" :disabled="preparingFirstFrame" :aria-label="t('videoStudio.uploadReferences')" @change="upload" />
      </label>
      <label for="video-reference-url">{{ t('videoStudio.referenceURL') }}</label>
      <div class="reference-url-row">
        <input id="video-reference-url" v-model="url" type="url" placeholder="https://…" :disabled="preparingFirstFrame || !options.length" @keydown.enter.prevent="addURL" />
        <button type="button" :disabled="!url.trim() || preparingFirstFrame || !options.length" @click="addURL">{{ t('videoStudio.addReference') }}</button>
      </div>
    </div>
    <p v-if="preparingFirstFrame" class="reference-hint" role="status">{{ t('videoStudio.preparingFrame') }}</p>
    <p v-if="error && error !== 'referencesRequired'" class="reference-error" role="alert">{{ t(`videoStudio.${error}`) }}</p>
    <label v-if="(limits?.keep_original_sound || klingReferences.keepOriginalSound) && klingReferences.mode === 'reference'" class="reference-check">
      <input v-model="klingReferences.keepOriginalSound" type="checkbox" />{{ t('videoStudio.keepOriginalSound') }}
    </label>
    <label v-if="limits?.prefer_multi_shots && klingReferences.mode === 'reference'" class="reference-check">
      <input v-model="klingReferences.preferMultiShots" type="checkbox" :disabled="limits.multi_shots_required" />{{ t('videoStudio.preferMultiShots') }}
    </label>
    <p class="reference-hint">{{ t('videoStudio.referenceCombinationHint') }}</p>
    <p v-if="media.some(item => item.name.startsWith('video_'))" class="reference-hint">{{ t('videoStudio.referenceVideoBilling') }}</p>
  </section>
</template>

<style scoped>
.reference-controls { display:grid; gap:10px; min-width:0; padding:16px 0; border-bottom:1px solid var(--vs-border,#e4e8e6); font-size:12px; }
.reference-controls > label,.reference-add > label { font-weight:600; }
.reference-controls select,.reference-url-row input { width:100%; min-width:0; border:1px solid var(--vs-border,#dce2df); background:var(--vs-surface,#fff); color:inherit; border-radius:8px; padding:9px; }
.reference-hint { color:var(--vs-secondary,#738078); line-height:1.6; margin:0; overflow-wrap:anywhere; }
.reference-error { color:#c24135; line-height:1.6; margin:0; }
.reference-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.reference-card { min-width:0; border:1px solid var(--vs-border,#dce2df); border-radius:8px; overflow:hidden; }
.reference-card img { width:100%; height:72px; object-fit:cover; background:var(--vs-surface,#f5f7f6); }
.reference-card > span { display:block; padding:5px; font-size:10px; }
.reference-actions { display:flex; justify-content:flex-end; gap:4px; padding:0 4px 4px; }
.reference-controls button { border:1px solid var(--vs-border,#dce2df); border-radius:6px; padding:4px 8px; white-space:nowrap; }
.reference-controls button:disabled { opacity:.4; }
.reference-media-list { list-style:none; display:grid; gap:8px; padding:0; margin:0; }
.reference-media-list li { display:flex; align-items:center; gap:8px; min-width:0; padding:8px; border:1px solid var(--vs-border,#dce2df); border-radius:8px; }
.reference-media-list li > div { display:grid; gap:4px; min-width:0; flex:1; }
.reference-media-list span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--vs-secondary,#738078); font-size:10px; }
.reference-add { display:grid; gap:8px; }
.reference-upload { position:relative; text-align:center; padding:11px; border:1px dashed var(--vs-border,#b8c8bf); border-radius:8px; cursor:pointer; }
.reference-upload input { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; }
.reference-url-row { display:flex; gap:6px; }
.reference-check { display:flex; align-items:center; gap:8px; }
.reference-check input { accent-color:#16875e; }

@media(max-width:360px) { .reference-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
