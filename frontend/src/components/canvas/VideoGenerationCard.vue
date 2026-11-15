<template>
  <article class="generation-card" :data-task-id="task.taskId">
    <div class="card-media">
      <video
        v-if="task.status === 'done' && task.videoUrl"
        :src="task.videoUrl"
        :aria-label="task.prompt"
        controls
        playsinline
        preload="none"
        @loadedmetadata="onMetadata"
        :style="{ aspectRatio: playerAspect }"
      ></video>
      <div v-else-if="task.status === 'failed'" class="result-state failed" role="status">
        <Icon name="exclamationCircle" size="lg" /><strong>{{
          task.submissionUnconfirmed
            ? t('videoStudio.submissionPending')
            : task.upstreamFailed
              ? t('videoStudio.generateFailed')
              : task.upstreamDone
                ? t('videoStudio.downloadPending')
                : t('videoStudio.taskPaused')
        }}</strong>
        <p>{{ task.error || t('videoStudio.generateFailed') }}</p>
        <p v-if="task.upstreamDone">
          {{ t('videoStudio.downloadFailedRetry') }}
        </p>
        <button type="button" class="action primary" @click="retryTask(task.taskId)">
          <Icon name="refresh" size="xs" />{{ retryLabel }}
        </button>
      </div>
      <div v-else class="result-state" role="status">
        <img v-if="referenceUrl" :src="referenceUrl" alt="" class="processing-frame" />
        <div class="processing-info">
          <div class="render-orbit"><Icon name="play" size="sm" /></div>
          <strong>{{ statusLabel }}</strong>
          <p>
            {{
              t('videoStudio.waiting', {
                n: Math.max(0, Math.floor((now - task.submittedAt) / 1000))
              })
            }}
          </p>
          <button type="button" class="text-action" @click="stopWaiting(task.taskId)">
            {{ t('videoStudio.stopWaiting') }}
          </button>
        </div>
      </div>
      <span v-if="task.status === 'done'" class="duration-badge">{{ actualDuration }}s</span>
    </div>
    <div class="card-body">
      <div class="card-label">
        <span class="model-name">{{ task.model }}</span
        ><span class="status" :class="task.status">{{ statusLabel }}</span>
      </div>
      <p class="card-prompt" :title="task.prompt">{{ task.prompt }}</p>
      <div class="card-meta">
        <span
          >{{ task.seconds }}s · {{ aspectLabel
          }}<template v-if="actualResolution || resultSettings">
            · {{ actualResolution || resultSettings }}</template
          ></span
        ><time :datetime="new Date(task.submittedAt).toISOString()">{{ timeLabel }}</time>
      </div>
      <p v-if="task.references" class="reference-task-note">{{ t(task.references.mode === 'frames' ? 'videoStudio.referenceFrames' : 'videoStudio.referenceOmni') }} · {{ t('videoStudio.referenceTaskSummary', { images: task.references.images.length, media: task.references.media.length }) }}</p>
      <p v-if="task.billingNote" class="reference-task-note">{{ task.billingNote }}</p>
      <div class="card-actions">
        <button type="button" class="action" @click="emit('reuse', task)">
          <Icon name="slidersHorizontal" size="xs" />{{ t('videoStudio.reuseParameters') }}</button
        ><a
          v-if="task.videoUrl"
          :href="task.videoUrl"
          :download="`video-${task.remoteId || task.taskId}.mp4`"
          class="action"
          ><Icon name="download" size="xs" />{{ t('imageStudio.download') }}</a
        ><button v-if="task.status === 'failed'" type="button" class="action" @click="archiveVideoTask(task)">
          <Icon name="inbox" size="xs" />{{ t('videoStudio.archive') }}
        </button>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import { videoAspectRatio, videoCapabilities } from '@/composables/videoModelCapabilities'
import { retryTask, stopWaiting, archiveVideoTask, recordVideoMetadata, type VideoTask } from '@/composables/useVideoStudioEngine'

const props = defineProps<{ task: VideoTask; now: number }>()
const emit = defineEmits<{ reuse: [task: VideoTask] }>()
const { t } = useI18n()
const referenceUrl = ref('')
watch(
  () => props.task.refImage,
  (file) => {
    if (referenceUrl.value) URL.revokeObjectURL(referenceUrl.value)
    referenceUrl.value = file ? URL.createObjectURL(file) : ''
  },
  { immediate: true }
)
onUnmounted(() => {
  if (referenceUrl.value) URL.revokeObjectURL(referenceUrl.value)
})
const aspectLabel = computed(() => {
  const ratio = videoAspectRatio(props.task.videoSize || 'auto', true)
  return ratio === 'auto' ? t('videoStudio.autoAspect') : ratio
})
const actualDuration = ref(props.task.actualDuration || props.task.seconds)
const actualResolution = ref(
  props.task.actualWidth && props.task.actualHeight ? `${props.task.actualWidth}×${props.task.actualHeight}` : ''
)
const playerAspect = computed(() =>
  props.task.actualWidth && props.task.actualHeight
    ? `${props.task.actualWidth} / ${props.task.actualHeight}`
    : props.task.videoSize && props.task.videoSize !== 'auto'
      ? props.task.videoSize.replace('x', ' / ')
      : '16 / 9'
)
function onMetadata(event: Event) {
  const video = event.target as HTMLVideoElement
  if (Number.isFinite(video.duration) && video.duration > 0) actualDuration.value = Math.round(video.duration * 10) / 10
  if (video.videoWidth && video.videoHeight) actualResolution.value = `${video.videoWidth}×${video.videoHeight}`
  recordVideoMetadata(props.task.taskId, actualDuration.value, video.videoWidth, video.videoHeight)
}
const resultSettings = computed(() => {
  const task = props.task
  if (!/^kling/i.test(task.model)) return task.resolution
  return [
    !videoCapabilities(task.model, task.mode).modes.length
      ? ''
      : t(task.klingSettings?.mode === 'pro' ? 'videoStudio.professionalMode' : 'videoStudio.standardMode'),
    task.klingSettings?.resolution
  ]
    .filter(Boolean)
    .join(' · ')
})
const timeLabel = computed(() =>
  new Date(props.task.submittedAt).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
)
const statusLabel = computed(() =>
  t(
    props.task.status === 'done'
      ? 'videoStudio.completed'
      : props.task.status === 'failed'
        ? 'videoStudio.needsAttention'
        : props.task.upstreamDone
          ? 'videoStudio.downloading'
          : props.task.status === 'processing'
            ? 'videoStudio.processing'
            : 'videoStudio.queued'
  )
)
const retryLabel = computed(() =>
  t(
    props.task.submissionUnconfirmed
      ? 'videoStudio.checkSubmission'
      : props.task.upstreamDone
        ? 'videoStudio.retryDownload'
        : props.task.remoteId && !props.task.upstreamFailed
          ? 'videoStudio.resumeTask'
          : 'videoStudio.regenerate'
  )
)
</script>

<style scoped>
.reference-task-note { margin:8px 0 0; font-size:11px; line-height:1.6; color:var(--vs-secondary); overflow-wrap:anywhere; }
.generation-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--vs-border);
  border-radius: 14px;
  background: var(--vs-panel);
  box-shadow: var(--st-shadow-sm, 0 1px 2px rgba(16, 24, 40, 0.05));
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.generation-card:hover {
  border-color: var(--vs-border-strong, var(--vs-muted));
  box-shadow: var(--st-shadow, 0 10px 30px -22px rgba(16, 24, 40, 0.35));
}
.card-media {
  position: relative;
  background: var(--vs-surface);
  min-height: 170px;
}
video {
  display: block;
  width: 100%;
  max-height: 380px;
  min-height: 170px;
  object-fit: contain;
  background: #08090b;
}
.duration-badge {
  position: absolute;
  right: 10px;
  bottom: 10px;
  background: #0009;
  color: #fff;
  font-size: 10px;
  border-radius: 5px;
  padding: 3px 6px;
  pointer-events: none;
}
.result-state {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
  position: relative;
  overflow: hidden;
}
.result-state strong {
  font-size: 13px;
  font-weight: 500;
}
.result-state p {
  font-size: 11px;
  line-height: 1.7;
  color: var(--vs-secondary);
  overflow-wrap: anywhere;
}
.failed {
  background: var(--vs-error-bg);
}
.failed > svg {
  color: var(--vs-danger);
}
.processing-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.14;
  filter: blur(3px);
}
.processing-info {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.render-orbit {
  position: relative;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  color: var(--vs-secondary);
  margin-bottom: 3px;
}
.render-orbit::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px solid var(--vs-border);
  border-top-color: var(--vs-secondary);
  border-radius: 50%;
  animation: orbit 1.5s linear infinite;
}
.card-body {
  padding: 15px;
}
.card-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.model-name {
  font-size: 10.5px;
  font-weight: 600;
  padding: 4px 7px;
  background: var(--vs-surface);
  border-radius: 6px;
  overflow-wrap: anywhere;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 550;
  color: var(--vs-muted);
  flex-shrink: 0;
}
.status::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.status.done {
  color: var(--vs-success);
}
.status.failed {
  color: var(--vs-danger);
  background: none;
}
.card-prompt {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.8;
  margin: 12px 0;
  min-height: 43px;
}
.card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  font-size: 10.5px;
  color: var(--vs-muted);
  line-height: 1.7;
}
.card-actions {
  border-top: 1px solid var(--vs-border);
  margin-top: 13px;
  padding-top: 11px;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 30px;
  border: 1px solid var(--vs-border);
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 550;
  padding: 0 10px;
  color: var(--vs-secondary);
  cursor: pointer;
}
.action:hover {
  color: var(--vs-text);
  border-color: var(--vs-border-strong, var(--vs-muted));
}
.action.primary {
  border-color: var(--vs-accent-border);
  background: var(--vs-accent-soft);
  color: var(--vs-accent-text);
}
.action.primary:hover {
  border-color: var(--vs-accent);
  color: var(--vs-accent-text);
}
.text-action {
  font-size: 11px;
  color: var(--vs-secondary);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.text-action:hover {
  color: var(--vs-text);
}
button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--vs-focus, #0d9488);
  outline-offset: 3px;
}
@keyframes orbit {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .render-orbit::before {
    animation: none;
  }
}
</style>
