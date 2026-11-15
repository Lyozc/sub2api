<template>
  <section class="video-studio" :aria-label="t('videoStudio.title')">
    <form class="creation-panel" @submit.prevent="send" @dragover.prevent @drop.prevent="onRefDrop" @paste="onPaste">
      <div class="panel-heading">
        <span class="heading-mark" aria-hidden="true"><Icon name="play" size="sm" /></span>
        <div class="heading-text">
          <h1>{{ t('videoStudio.creation') }}</h1>
          <p>{{ t('videoStudio.creationSubtitle') }}</p>
        </div>
        <button
          type="button"
          class="icon-button"
          :aria-label="t('videoStudio.newCreation')"
          :title="t('videoStudio.newCreation')"
          :disabled="!conversationsReady"
          @click="startNew"
        >
          <Icon name="plus" size="sm" />
        </button>
      </div>
      <div class="creation-scroll">
        <div v-if="initError" class="studio-notice error" role="alert">
          <span>{{ initError }}</span
          ><button type="button" @click="retryInit">
            {{ t('imageStudio.retryInit') }}
          </button>
        </div>
        <div v-if="conversationStorageError && !conversationInitError" class="studio-notice error" role="alert">
          <span>{{ t('videoStudio.conversationSaveFailed') }}</span
          ><button type="button" @click="persistConversations">
            {{ t('imageStudio.retry') }}
          </button>
        </div>
        <div class="model-field">
          <label for="video-model">{{ t('imageStudio.model') }}</label>
          <div class="select-wrap">
            <Icon name="sparkles" size="sm" /><select
              id="video-model"
              v-model="selectedModel"
              data-testid="video-model"
              :disabled="!modelsReady"
            >
              <option v-if="!modelOptions.length" value="">
                {{ t('videoStudio.chooseModel') }}
              </option>
              <option v-for="option in modelOptions" :key="option.value" :value="option.value">
                {{ option.label }} · {{ option.hint }}
              </option></select
            ><Icon name="chevronDown" size="xs" />
          </div>
        </div>
        <div class="creation-modes" role="group" :aria-label="t('videoStudio.generationMode')">
          <button
            v-for="value in ['t2v', 'i2v'] as const"
            :key="value"
            type="button"
            :class="{ selected: mode === value }"
            :aria-pressed="mode === value"
            @click="setCreationMode(value)"
          >
            <Icon :name="value === 't2v' ? 'edit' : 'inbox'" size="sm" aria-hidden="true" />{{
              t(value === 't2v' ? 'videoStudio.modeText2Video' : 'videoStudio.modeImage2Video')
            }}
          </button>
        </div>
        <VideoReferenceControls v-if="mode === 'i2v' && hasKlingReferenceControls()" @pick="showPicker = true" />
        <section v-else-if="mode === 'i2v'" class="frame-section">
          <div class="field-heading">
            <h2>{{ t('videoStudio.firstFrame') }}</h2>
            <button type="button" class="text-action" @click="showPicker = true">
              <Icon name="inbox" size="xs" />{{ t('videoStudio.materials') }}
            </button>
          </div>
          <div class="frame-upload" :class="{ 'has-image': refImages.length }" :aria-busy="preparingFirstFrame">
            <img v-if="refImages.length" :src="refImages[0].url" :alt="t('videoStudio.firstFrame')" />
            <label class="frame-input"
              ><Icon name="plus" size="lg" /><strong>{{
                t(refImages.length ? 'videoStudio.replaceFrame' : 'videoStudio.addFrame')
              }}</strong
              ><span>{{ t('videoStudio.frameUploadHint') }}</span
              ><input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                :aria-label="t('videoStudio.addFrame')"
                @change="onRefFilesChange"
            /></label>
            <button
              v-if="refImages.length"
              type="button"
              class="remove-frame icon-button"
              :aria-label="t('videoStudio.removeFirstFrame')"
              @click="clearFirstFrame"
            >
              <Icon name="x" size="xs" />
            </button>
          </div>
          <p v-if="preparingFirstFrame" class="settings-note" role="status">
            {{ t('videoStudio.preparingFrame') }}
          </p>
        </section>
        <section class="prompt-section">
          <div class="field-heading">
            <label for="video-prompt">{{ t('videoStudio.describeIdea') }}</label
            ><button
              v-if="polishEnabled"
              type="button"
              class="ai-button"
              data-testid="video-polish"
              :disabled="!canPolish"
              :aria-busy="aiLoading"
              @click="onAIPrompt"
            >
              <span v-if="aiLoading" class="button-spinner"></span><Icon v-else name="sparkles" size="xs" />{{
                t('canvasChat.polish')
              }}
            </button>
          </div>
          <div class="prompt-box">
            <textarea
              id="video-prompt"
              ref="promptInput"
              v-model="prompt"
              data-testid="video-prompt"
              :maxlength="capabilities.prompt_max"
              rows="5"
              :disabled="!conversationsReady"
              :placeholder="t('videoStudio.promptPlaceholder')"
              @keydown="onComposerKeydown"
            ></textarea>
            <div class="prompt-bottom">
              <span>{{ t('videoStudio.promptGuide') }}</span
              ><span>{{ prompt.length }} / {{ capabilities.prompt_max }}</span>
            </div>
          </div>
          <p v-if="contextTaskId !== null" class="settings-note reused-note">
            {{ t('videoStudio.parametersLoaded')
            }}<button type="button" class="text-action" @click="contextTaskId = null">
              {{ t('videoStudio.clearContext') }}
            </button>
          </p>
        </section>
        <details class="polish-settings">
          <summary>
            <Icon name="sparkles" size="xs" />{{ t('canvasChat.polishSettings')
            }}<span>{{ t(polishEnabled ? 'videoStudio.enabled' : 'videoStudio.disabled') }}</span
            ><Icon name="chevronDown" size="xs" />
          </summary>
          <div class="polish-content">
            <button
              type="button"
              role="switch"
              class="polish-toggle"
              :aria-checked="polishEnabled"
              @click="togglePolish"
            >
              <span>{{ t('canvasChat.polish') }}</span
              ><span class="switch-track" :class="{ enabled: polishEnabled }"><i></i></span></button
            ><template v-if="polishEnabled"
              ><label class="ai-field"
                >{{ t('canvasChat.polishKey')
                }}<select :value="aiKeyId ?? ''" @change="setAIKey(($event.target as HTMLSelectElement).value || null)">
                  <option value="">{{ t('canvas.aiNoKeys') }}</option>
                  <option v-for="option in keyOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select></label
              ><label class="ai-field"
                >{{ t('canvasChat.polishModel')
                }}<select
                  :value="aiModel"
                  :disabled="!aiModels.length"
                  @change="setAIModel(($event.target as HTMLSelectElement).value)"
                >
                  <option v-if="!aiModels.length" value="">
                    {{ t('canvas.aiNoModels') }}
                  </option>
                  <option v-for="value in aiModels" :key="value" :value="value">
                    {{ value }}
                  </option>
                </select></label
              ></template
            >
          </div>
        </details>
        <section class="settings-panel" :aria-label="t('videoStudio.videoSettings')">
          <div class="field-heading">
            <h2>{{ t('videoStudio.videoSettings') }}</h2>
            <Icon name="slidersHorizontal" size="xs" />
          </div>
          <VideoParameterControls
            v-model:resolution="selectedResolution"
            v-model:duration="seconds"
            v-model:ratio="videoSize"
            v-model:quantity="quantity"
            :resolution-options="resolutionOptions"
            :supported-resolutions="supportedResolutions"
            :duration-min="durationRange.min"
            :duration-max="durationRange.max"
            :duration-step="durationRange.step"
            :duration-ticks="durationRange.ticks"
            :allowed-durations="capabilities.durations"
            :ratios="aspectOptions"
            :labels="parameterLabels"
          />
          <template v-if="isKling && hasAdvancedSettings"
            ><div v-if="capabilities.modes.length" class="setting-field">
              <h3>{{ t('videoStudio.generationMode') }}</h3>
              <div class="setting-choices">
                <button
                  v-for="value in capabilities.modes"
                  :key="value"
                  type="button"
                  :class="{ selected: klingSettings.mode === value }"
                  :aria-pressed="klingSettings.mode === value"
                  @click="klingSettings.mode = value as 'std' | 'pro'"
                >
                  {{ t(value === 'pro' ? 'videoStudio.professionalMode' : 'videoStudio.standardMode') }}
                </button>
              </div>
            </div>
            <div v-if="capabilities.sound" class="setting-field">
              <h3>{{ t('videoStudio.sound') }}</h3>
              <div class="setting-choices">
                <button
                  v-for="value in ['', 'on', 'off'] as const"
                  :key="value"
                  type="button"
                  :class="{ selected: klingSettings.sound === value }"
                  :aria-pressed="klingSettings.sound === value"
                  :disabled="value === 'on' && !audioAllowed"
                  @click="klingSettings.sound = value"
                >
                  {{
                    t(
                      value === 'on'
                        ? 'videoStudio.soundOn'
                        : value === 'off'
                          ? 'videoStudio.soundOff'
                          : 'videoStudio.upstreamDefault'
                    )
                  }}
                </button>
              </div>
              <p v-if="!audioAllowed" class="settings-note">
                {{ t('videoStudio.audioResolutionHint') }}
              </p>
            </div>
            <details v-if="capabilities.negative_prompt || capabilities.cfg_scale" class="advanced-settings">
              <summary>{{ t('videoStudio.advancedSettings') }}</summary>
              <label v-if="capabilities.negative_prompt" class="ai-field" for="video-negative-prompt"
                >{{ t('videoStudio.negativePrompt')
                }}<textarea
                  id="video-negative-prompt"
                  v-model="klingSettings.negativePrompt"
                  class="setting-input"
                  rows="2"
                  maxlength="2500"
                  :placeholder="t('videoStudio.negativePromptPlaceholder')"
                ></textarea></label
              ><label v-if="capabilities.cfg_scale" class="ai-field" for="video-cfg-scale"
                >{{ t('videoStudio.cfgScale')
                }}<input
                  id="video-cfg-scale"
                  :value="klingSettings.cfgScale ?? ''"
                  class="setting-input"
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  :placeholder="t('videoStudio.upstreamDefault')"
                  :aria-invalid="!cfgValid"
                  @input="setCfgScale"
                /><span class="settings-note" :class="{ 'setting-error': !cfgValid }">{{
                  t('videoStudio.cfgScaleHint')
                }}</span></label
              >
            </details>
          </template>
        </section>
      </div>
      <footer class="creation-footer">
        <p class="cost-estimate" data-testid="video-cost-estimate">
          {{ preparingFirstFrame ? t('videoStudio.preparingFrame') : estimatedCost }}
        </p>
        <button class="generate-button" data-testid="video-send" type="submit" :disabled="!canSend">
          <span v-if="generating" class="button-spinner" aria-hidden="true"></span><Icon v-else name="sparkles" size="sm" aria-hidden="true" />{{
            generating ? t('videoStudio.batchGenerating') : t('videoStudio.generateN', { n: quantity })
          }}
        </button>
        <p class="shortcut-hint">{{ t('videoStudio.shortcutHint') }}</p>
      </footer>
    </form>
    <main class="results-panel">
      <header class="results-header">
        <div>
          <div class="results-title">
            <h2>{{ t('videoStudio.myCreations') }}</h2>
            <span class="count-badge">{{ totalCount }}</span>
          </div>
          <p>
            {{ activeCount ? t('videoStudio.activeTasks', { n: activeCount }) : t('videoStudio.resultsCaption') }}
          </p>
        </div>
        <button type="button" class="reset-button" :disabled="!conversationsReady" @click="startNew">
          <Icon name="plus" size="xs" aria-hidden="true" />{{ t('videoStudio.newCreation') }}
        </button>
      </header>
      <div class="results-toolbar">
        <div class="result-filters" role="group" :aria-label="t('videoStudio.filterResults')">
          <button
            v-for="value in resultFilters"
            :key="value"
            type="button"
            :class="{ selected: resultFilter === value }"
            :aria-pressed="resultFilter === value"
            @click="resultFilter = value"
          >
            {{ t(`videoStudio.filter${value}`) }}<span v-if="value === 'active' && activeCount">{{ activeCount }}</span>
          </button>
        </div>
        <label class="result-search"
          ><Icon name="search" size="sm" aria-hidden="true" /><input
            v-model="search"
            :placeholder="t('videoStudio.searchCreations')"
            :aria-label="t('videoStudio.searchCreations')"
        /></label>
      </div>
      <div class="legacy-notice">
        <StudioLegacyHistory kind="video" @imported="reloadImportedHistory" />
      </div>
      <div ref="resultList" class="results-scroll">
        <div v-if="conversationInitError" class="empty-results" role="alert">
          <p>{{ conversationInitError }}</p>
          <button type="button" class="action primary" @click="initVideoConversations">{{ t('common.retry') }}</button>
        </div>
        <div v-else-if="!conversationsReady" class="empty-results" role="status">
          <span class="button-spinner"></span>
          <p>{{ t('videoStudio.loadingConversations') }}</p>
        </div>
        <div v-else-if="visibleTasks.length" class="results-grid">
          <VideoGenerationCard
            v-for="task in visibleTasks"
            :key="task.taskId"
            :task="task"
            :now="now"
            @reuse="continueCreation"
          />
        </div>
        <div v-else class="empty-results">
          <div class="empty-visual" aria-hidden="true">
            <div class="empty-frame back"></div>
            <div class="empty-frame front"><Icon name="play" size="lg" /><span class="frame-corner"></span></div>
            <span class="empty-spark"><Icon name="sparkles" size="sm" /></span>
          </div>
          <h3>
            {{ t(totalCount ? 'videoStudio.noMatchingCreations' : 'videoStudio.emptyTasks') }}
          </h3>
          <p>
            {{ t(totalCount ? 'videoStudio.tryOtherFilter' : 'videoStudio.workspaceEmptyHint') }}
          </p>
          <div v-if="!totalCount" class="inspirations">
            <button v-for="idea in inspirations" :key="idea.key" type="button" @click="applyIdea(idea.key)">
              <Icon :name="idea.icon" size="xs" aria-hidden="true" />{{ t(`videoStudio.ideas.${idea.key}.title`)
              }}<Icon name="arrowUp" size="xs" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <footer class="results-footnote">
        <Icon name="inbox" size="xs" aria-hidden="true" /><span>{{ t('videoStudio.historyNote') }}</span>
      </footer>
    </main>
    <CanvasImagePicker v-if="showPicker" :max-select="1" @close="showPicker = false" @import="onImportFromImage" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import { useAppStore } from '@/stores/app'
import StudioLegacyHistory from './StudioLegacyHistory.vue'
import VideoGenerationCard from './VideoGenerationCard.vue'
import VideoParameterControls from './VideoParameterControls.vue'
import VideoReferenceControls from './VideoReferenceControls.vue'
import { validateVideoReferences } from '@/composables/videoReferences'
import CanvasImagePicker from './CanvasImagePicker.vue'
import type { ToolbarValue } from './chatdraw/format'
import { sessionOwnerKey } from '@/composables/studioSession'
import {
  KLING_VIDEO_RESOLUTIONS,
  videoDurationAllowed,
  nearestVideoDuration,
  videoAudioAllowed
} from '@/composables/videoModelCapabilities'
import {
  RESOLUTIONS,
  SECONDS,
  klingSettings,
  defaultKlingSettings,
  validVideoDuration,
  validVideoQuantity,
  models,
  modelsReady,
  model,
  modelGroupId,
  initError,
  retryInit,
  resolution,
  videoSize,
  seconds,
  prompt,
  quantity,
  mode,
  refImages,
  addRefImages,
  removeRefImage,
  submitBatch,
  tasks,
  generating,
  preparingFirstFrame,
  hasKlingReferenceControls,
  activeKlingReferences,
  selectedVideoCapabilities,
  loadHistory,
  type VideoTask,
  type VideoModelOption
} from '@/composables/useVideoStudioEngine'
import {
  activeConversationId,
  activeConversation,
  conversationsReady,
  conversationStorageError,
  conversationInitError,
  initVideoConversations,
  persistConversations,
  newVideoConversation,
  reuseVideoTask,
  importVideoHistory
} from '@/composables/useVideoStudioConversations'
import {
  aiEnhancePrompt,
  aiKeys,
  aiKeyId,
  aiModels,
  aiModel,
  initAIOptions,
  onAIKeyChange,
  rememberAIModel
} from '@/composables/useAIPrompt'
import type { StudioImageAsset } from '@/composables/useStudioImageAssets'
import './studio-shell.css'

const { t } = useI18n()
const appStore = useAppStore()
const search = ref('')
const resultFilter = ref<'all' | 'active' | 'done'>('all')
const resultFilters = ['all', 'active', 'done'] as const
const resultList = ref<HTMLElement>()
const visibleTasks = computed(() =>
  tasks.value
    .filter((task) => !task.archived)
    .filter((task) => {
      if (resultFilter.value === 'active' && !['pending', 'processing'].includes(task.status)) return false
      if (resultFilter.value === 'done' && task.status !== 'done') return false
      return `${task.prompt} ${task.model}`.toLowerCase().includes(search.value.toLowerCase())
    })
    .sort((a, b) => b.submittedAt - a.submittedAt || b.taskId - a.taskId)
)
const activeCount = computed(
  () => tasks.value.filter((task) => !task.archived && ['pending', 'processing'].includes(task.status)).length
)
const totalCount = computed(() => tasks.value.filter((task) => !task.archived).length)
const showPicker = ref(false)
const aiLoading = ref(false)
const polishEnabled = ref(false)
const promptInput = ref<HTMLTextAreaElement>()
const now = ref(Date.now())
const contextTaskId = ref<number | null>(null)
const isKling = computed(() => /^kling/i.test(model.value))
const capabilities = computed(selectedVideoCapabilities)
const hasAdvancedSettings = computed(
  () =>
    capabilities.value.modes.length ||
    capabilities.value.sound ||
    capabilities.value.negative_prompt ||
    capabilities.value.cfg_scale
)
const klingResolutionOptions = KLING_VIDEO_RESOLUTIONS
const supportedResolutions = computed(() => capabilities.value.resolutions)
const resolutionOptions = computed(() =>
  isKling.value ? klingResolutionOptions : supportedResolutions.value.includes('') ? ['', ...RESOLUTIONS] : RESOLUTIONS
)
const durationValid = computed(() => videoDurationAllowed(seconds.value, capabilities.value))
const cfgValid = computed(
  () =>
    !capabilities.value.cfg_scale ||
    klingSettings.value.cfgScale === null ||
    (Number.isFinite(klingSettings.value.cfgScale) &&
      klingSettings.value.cfgScale >= 0 &&
      klingSettings.value.cfgScale <= 1)
)
function setCfgScale(event: Event) {
  const input = event.target as HTMLInputElement
  klingSettings.value.cfgScale = input.value === '' && !input.validity.badInput ? null : input.valueAsNumber
}
const durationRange = computed(() => {
  const values = capabilities.value.durations
  const min = values[0] || 1,
    max = values[values.length - 1] || min
  const step =
    values.length > 1 && values.every((value, i) => i === 0 || value - values[i - 1] === values[1] - min)
      ? values[1] - min
      : 1
  return {
    min,
    max,
    step,
    ticks: values.filter((value, i) => i === 0 || i === values.length - 1 || value % 5 === 0)
  }
})
const selectedResolution = computed<string>({
  get: () => (isKling.value ? klingSettings.value.resolution : resolution.value),
  set: (value) => {
    if (!capabilities.value.resolutions.includes(value)) return
    if (isKling.value) {
      if (klingResolutionOptions.includes(value as (typeof klingResolutionOptions)[number]))
        klingSettings.value.resolution = value as (typeof klingResolutionOptions)[number]
    } else if (value === '' || RESOLUTIONS.includes(value as (typeof RESOLUTIONS)[number]))
      resolution.value = value as typeof resolution.value
  }
})
const parameterLabels = computed(() => ({
  resolution: t('videoStudio.resolution'),
  duration: t('videoStudio.duration'),
  ratio: t('canvas.aspectRatio'),
  output: t('videoStudio.output'),
  seconds: t('videoStudio.secondsUnit'),
  defaultResolution: t('videoStudio.upstreamDefault'),
  unsupportedResolution: t('videoStudio.unsupportedResolution'),
  resolutionHint: supportedResolutions.value.some((value) => value !== '')
    ? t('videoStudio.resolutionSupportHint', {
        resolutions: supportedResolutions.value
          .filter(Boolean)
          .map((value) => (value === '4k' ? '4K' : value))
          .join(' / ')
      })
    : t('videoStudio.resolutionDefaultHint'),
  durationHint: durationRange.value.step === 1
    ? t('videoStudio.durationRangeHint', durationRange.value)
    : t('videoStudio.discreteDurationHint', { values: capabilities.value.durations.join(' / ') })
}))
const aspectOptions = computed(() =>
  (capabilities.value.ratios.length ? capabilities.value.ratios : ['auto']).map((ratio) => {
    const [width, height] = ratio.split(':').map(Number)
    return {
      value: ratio === 'auto' ? 'auto' : `${width * 120}x${height * 120}`,
      label: ratio === 'auto' ? t('videoStudio.autoAspect') : ratio,
      width: width || 1,
      height: height || 1
    }
  })
)
const modelKey = (option: VideoModelOption) => `${option.group_id}:${option.id}`
const modelOptions = computed(() =>
  models.value.map((option) => ({
    value: modelKey(option),
    label: option.id,
    hint: option.group_name
  }))
)
const selectedModel = computed({
  get: () => {
    const selected =
      models.value.find((o) => o.id === model.value && o.group_id === modelGroupId.value) ||
      (modelGroupId.value == null ? models.value.find((o) => o.id === model.value) : undefined)
    return selected ? modelKey(selected) : ''
  },
  set: (value) => {
    const selected = models.value.find((o) => modelKey(o) === value)
    if (selected) {
      model.value = selected.id
      modelGroupId.value = selected.group_id
    }
  }
})
const canSend = computed(
  () =>
    conversationsReady.value &&
    modelsReady.value &&
    durationValid.value &&
    capabilities.value.resolutions.includes(selectedResolution.value) &&
    validVideoQuantity(quantity.value) &&
    cfgValid.value &&
    (mode.value !== 'i2v' || (hasKlingReferenceControls() ? !validateVideoReferences(activeKlingReferences(), capabilities.value.references, klingSettings.value.sound) : refImages.value.length > 0)) &&
    !generating.value &&
    !preparingFirstFrame.value &&
    !aiLoading.value &&
    !initError.value &&
    !!selectedModel.value &&
    !!prompt.value.trim() &&
    prompt.value.trim().length <= capabilities.value.prompt_max
)
const canPolish = computed(
  () =>
    conversationsReady.value &&
    !generating.value &&
    !preparingFirstFrame.value &&
    !aiLoading.value &&
    !!prompt.value.trim()
)
const audioAllowed = computed(() => videoAudioAllowed(capabilities.value, selectedResolution.value)
  && !(mode.value === 'i2v' && hasKlingReferenceControls() && (activeKlingReferences().keepOriginalSound || capabilities.value.references?.disable_generated_audio_with_video && activeKlingReferences().media.some(item=>item.name.startsWith('video_')))))
const estimatedCost = computed(() => {
  if (!durationValid.value) return ''
  if (mode.value === 'i2v' && hasKlingReferenceControls() && activeKlingReferences().media.some(item => item.name.startsWith('video_'))) return t('videoStudio.referenceCostPending')
  const option = models.value.find((o) => o.id === model.value && o.group_id === modelGroupId.value)
  const price = option?.unit_prices?.[selectedResolution.value || capabilities.value.default_resolution]
  return price == null
    ? t('videoStudio.costUnavailable')
    : t('videoStudio.estimatedCost', {
        cost: (price * seconds.value * quantity.value).toFixed(4)
      })
})
const keyOptions = computed(() => aiKeys.value.map((key) => ({ value: key.id, label: key.name })))
function setAIKey(value: ToolbarValue) {
  aiKeyId.value = value === null ? null : Number(value)
  void onAIKeyChange()
}
function setAIModel(value: ToolbarValue) {
  aiModel.value = String(value)
  rememberAIModel()
}
function togglePolish() {
  polishEnabled.value = !polishEnabled.value
  if (polishEnabled.value) void initAIOptions()
}
// Keep generation preferences isolated by account.
let settingsOwner = ''
let settingsLoaded = false
watch(
  modelsReady,
  (ready) => {
    if (!ready || settingsLoaded) return
    settingsOwner = sessionOwnerKey()
    // Start with a duration accepted by every Kling model, then restore preferences.
    seconds.value = isKling.value ? 5 : SECONDS[0]
    try {
      const saved = JSON.parse(localStorage.getItem(`video_studio_settings:${settingsOwner}`) || 'null')
      if (saved) {
        const option = models.value.find((option) => option.id === saved.model && option.group_id === saved.groupId)
        if (option) selectedModel.value = modelKey(option)
        if (validVideoDuration(saved.seconds)) seconds.value = saved.seconds
        if (validVideoQuantity(saved.quantity)) quantity.value = saved.quantity
        if (aspectOptions.value.some((option) => option.value === saved.size)) videoSize.value = saved.size
        if (saved.resolution === '' || RESOLUTIONS.includes(saved.resolution)) resolution.value = saved.resolution
        const settings = defaultKlingSettings()
        if (saved.kling?.mode === 'pro') settings.mode = 'pro'
        if (klingResolutionOptions.includes(saved.kling?.resolution)) settings.resolution = saved.kling.resolution
        if (['on', 'off'].includes(saved.kling?.sound)) settings.sound = saved.kling.sound
        if (typeof saved.kling?.negativePrompt === 'string')
          settings.negativePrompt = saved.kling.negativePrompt.slice(0, 2500)
        if (typeof saved.kling?.cfgScale === 'number' && saved.kling.cfgScale >= 0 && saved.kling.cfgScale <= 1)
          settings.cfgScale = saved.kling.cfgScale
        klingSettings.value = settings
        polishEnabled.value = saved.polish === true
      }
    } catch {
      /* Ignore unavailable storage or corrupt preferences. */
    }
    seconds.value = nearestVideoDuration(seconds.value, capabilities.value)
    settingsLoaded = true
  },
  { immediate: true }
)
watch(
  [capabilities, selectedResolution],
  () => {
    const caps = capabilities.value
    if (!caps.resolutions.includes(selectedResolution.value))
      selectedResolution.value = caps.resolutions.includes('720p') ? '720p' : caps.resolutions[0]
    if (!audioAllowed.value && klingSettings.value.sound === 'on') klingSettings.value.sound = 'off'
    if (!caps.modes.includes(klingSettings.value.mode)) klingSettings.value.mode = 'std'
    if (!caps.sound) klingSettings.value.sound = ''
    if (!caps.negative_prompt) klingSettings.value.negativePrompt = ''
    if (!caps.cfg_scale) klingSettings.value.cfgScale = null
  },
  { immediate: true }
)
watch(
  capabilities,
  (caps) => {
    seconds.value = nearestVideoDuration(seconds.value, caps)
  },
  { immediate: true }
)
watch(
  [model, modelGroupId, videoSize, seconds, quantity, resolution, polishEnabled, klingSettings],
  () => {
    if (!settingsLoaded || settingsOwner !== sessionOwnerKey()) return
    try {
      localStorage.setItem(
        `video_studio_settings:${settingsOwner}`,
        JSON.stringify({
          model: model.value,
          groupId: modelGroupId.value,
          size: videoSize.value,
          seconds: seconds.value,
          quantity: quantity.value,
          resolution: resolution.value,
          polish: polishEnabled.value,
          kling: klingSettings.value
        })
      )
    } catch {
      /* Preference storage must not block creation. */
    }
  },
  { deep: true }
)
const inspirations = [
  { key: 'cinematic', icon: 'play' },
  { key: 'product', icon: 'cube' },
  { key: 'fantasy', icon: 'sparkles' }
] as const

watch(
  aspectOptions,
  () => {
    const [w, h] = videoSize.value.split('x').map(Number)
    const equivalent = aspectOptions.value.find(
      (option) =>
        option.value === videoSize.value ||
        (Number.isFinite(w / h) && Math.abs(option.width / option.height - w / h) < 0.001)
    )
    videoSize.value = (equivalent || aspectOptions.value[0]).value
  },
  { immediate: true }
)

watch(
  activeConversationId,
  () => {
    invalidatePolish()
    contextTaskId.value = null
  },
  { flush: 'sync' }
)
function startNew() {
  newVideoConversation()
  contextTaskId.value = null
  void nextTick(() => promptInput.value?.focus())
}
function setCreationMode(value: 't2v' | 'i2v') {
  if (value === 't2v') while (refImages.value.length) removeRefImage(0)
  mode.value = value
}
function clearFirstFrame() {
  removeRefImage(0)
  mode.value = 'i2v'
}
function send() {
  if (!canSend.value) return
  const created = submitBatch(activeConversationId.value)
  if (created.length) {
    if (activeConversation.value && !activeConversation.value.title) activeConversation.value.title = created[0].prompt.slice(0, 48)
    contextTaskId.value = null
    resultFilter.value = 'all'
    search.value = ''
    void nextTick(() => resultList.value?.scrollTo({ top: 0, behavior: 'smooth' }))
  }
}
function onComposerKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault()
    send()
  }
}
async function continueCreation(task: VideoTask) {
  await reuseVideoTask(task)
  seconds.value = nearestVideoDuration(seconds.value, capabilities.value)
  contextTaskId.value = task.taskId
  void nextTick(() => promptInput.value?.focus())
}
function applyIdea(key: string) {
  prompt.value = t(`videoStudio.ideas.${key}.prompt`)
  promptInput.value?.focus()
}
function addFirstFrame(files: File[]) {
  if (!files.some((file) => file.type.startsWith('image/'))) return
  void addRefImages(files, true)
}
function onRefFilesChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) addFirstFrame(Array.from(input.files))
  input.value = ''
}
function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'))
  if (files.length) {
    event.preventDefault()
    addFirstFrame(files)
  }
}
async function onRefDrop(event: DragEvent) {
  if (event.dataTransfer?.files.length) {
    addFirstFrame(Array.from(event.dataTransfer.files))
    return
  }
  const uri = event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain') || ''
  const url = uri
    .split('\n')
    .map((s) => s.trim())
    .find((value) => value.startsWith('blob:') || value.startsWith(`${window.location.origin}/`))
  if (!url) return
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    if (blob.type.startsWith('image/')) addFirstFrame([new File([blob], 'first-frame.png', { type: blob.type })])
  } catch {
    appStore.showError(t('canvas.clipboardEmpty'))
  }
}
function onImportFromImage(items: StudioImageAsset[]) {
  const blob = items[0]?.images[0]?.blob
  if (blob) addFirstFrame([new File([blob], 'first-frame.png', { type: blob.type || 'image/png' })])
  showPicker.value = false
}
async function reloadImportedHistory() {
  await loadHistory()
  importVideoHistory()
  appStore.showSuccess(t('videoStudio.historyImported'))
}
let componentEpoch = 0
async function onAIPrompt() {
  if (!canPolish.value) return
  if (!aiKeyId.value) {
    appStore.showError(t('canvas.aiNeedKey'))
    return
  }
  if (!aiModel.value) {
    appStore.showError(t('canvas.aiNoModels'))
    return
  }
  const original = prompt.value
  const conversationId = activeConversationId.value
  const version = ++componentEpoch
  aiLoading.value = true
  try {
    const enhanced = await aiEnhancePrompt('video', original, {
      keyId: aiKeyId.value ?? undefined,
      model: aiModel.value || undefined
    })
    if (version !== componentEpoch || activeConversationId.value !== conversationId) return
    if (prompt.value === original) {
      prompt.value = enhanced
    } else {
      appStore.showError(t('canvasChat.polishInputChanged'))
    }
  } catch (error) {
    if (version === componentEpoch && !(error instanceof Error && error.name === 'StudioSessionChangedError')) {
      appStore.showError(error instanceof Error ? error.message : t('canvas.aiPromptFailed'))
    }
  } finally {
    if (version === componentEpoch) aiLoading.value = false
  }
}
function invalidatePolish() {
  componentEpoch++
  aiLoading.value = false
}
function onSessionEnded() {
  invalidatePolish()
  settingsLoaded = false
  polishEnabled.value = false
}
let tickTimer: number | undefined
function syncTicker() {
  const active = tasks.value.some(task => !task.archived && ['pending', 'processing'].includes(task.status))
  if (active && tickTimer === undefined) tickTimer = window.setInterval(() => { now.value = Date.now() }, 1000)
  if (!active && tickTimer !== undefined) { window.clearInterval(tickTimer); tickTimer = undefined }
}
watch(() => tasks.value.map(task => `${task.status}:${task.archived}`).join(','), syncTicker)
onMounted(() => {
  window.addEventListener('studio-session-ended', onSessionEnded)
  retryInit()
  void initVideoConversations()
  void initAIOptions()
  syncTicker()
})
onUnmounted(() => {
  invalidatePolish()
  window.removeEventListener('studio-session-ended', onSessionEnded)
  window.clearInterval(tickTimer)
})
</script>

<style scoped>
/* Tokens follow the shared studio shell (studio-shell.css) and fall back to
 * their own values when this panel renders outside the shell. */
.video-studio {
  --vs-bg: var(--st-panel-soft, #f8fafc);
  --vs-panel: var(--st-panel, #fff);
  --vs-surface: var(--st-surface, #eef1f5);
  --vs-text: var(--st-text, #101828);
  --vs-secondary: var(--st-text-soft, #4a5565);
  --vs-muted: var(--st-muted, #8d97a5);
  --vs-border: var(--st-border, #e3e7ec);
  --vs-border-strong: var(--st-border-strong, #cfd6de);
  --vs-accent: var(--st-accent, #059669);
  --vs-accent-hover: var(--st-accent-hover, #047857);
  --vs-on-accent: var(--st-accent-on, #fff);
  --vs-accent-soft: var(--st-accent-soft, #ecfdf5);
  --vs-accent-border: var(--st-accent-border, #a7f3d0);
  --vs-accent-text: var(--st-accent-text, #047857);
  --vs-focus: var(--st-focus, #0d9488);
  --vs-success: var(--st-accent-text, #047857);
  --vs-danger: var(--st-danger, #d4493f);
  --vs-error-bg: var(--st-danger-soft, #fef2f2);
  display: grid;
  grid-template-columns: 388px minmax(0, 1fr);
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
/* Dark fallbacks only matter when this panel renders outside the shell.
 * Inside the shell, .dark .studio-shell already supplies the --st-* values. */
:global(.dark) .video-studio {
  --vs-bg: var(--st-panel-soft, #182234);
  --vs-panel: var(--st-panel, #151e2f);
  --vs-surface: var(--st-surface, #1e293b);
  --vs-text: var(--st-text, #f1f5f9);
  --vs-secondary: var(--st-text-soft, #c3cedd);
  --vs-muted: var(--st-muted, #8b97a9);
  --vs-border: var(--st-border, #2a3650);
  --vs-border-strong: var(--st-border-strong, #3d4b66);
  --vs-accent: var(--st-accent, #10b981);
  --vs-accent-hover: var(--st-accent-hover, #34d399);
  --vs-on-accent: var(--st-accent-on, #04231a);
  --vs-accent-soft: var(--st-accent-soft, rgba(16, 185, 129, 0.14));
  --vs-accent-border: var(--st-accent-border, rgba(16, 185, 129, 0.38));
  --vs-accent-text: var(--st-accent-text, #6ee7b7);
  --vs-focus: var(--st-focus, #2dd4bf);
  --vs-success: var(--st-accent-text, #6ee7b7);
  --vs-danger: var(--st-danger, #fca5a5);
  --vs-error-bg: var(--st-danger-soft, rgba(185, 28, 28, 0.18));
  background: var(--st-bg, #0e1626);
}
button,
input,
textarea,
select {
  font: inherit;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--vs-focus);
  outline-offset: 3px;
}
input,
textarea,
select {
  min-width: 0;
  color: var(--vs-text);
}
.creation-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border-right: 1px solid var(--vs-border);
  background: var(--vs-panel);
}
.panel-heading {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 16px 22px;
  border-bottom: 1px solid var(--vs-border);
  flex-shrink: 0;
}
.heading-mark {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border: 1px solid var(--vs-accent-border);
  border-radius: 9px;
  background: var(--vs-accent-soft);
  color: var(--vs-accent-text);
}
.heading-text {
  min-width: 0;
  flex: 1;
}
h1 {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.2px;
}
.heading-text p {
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--vs-muted);
}
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--vs-border);
  border-radius: 9px;
  color: var(--vs-secondary);
  background: var(--vs-panel);
}
.creation-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 18px 22px 22px;
  scrollbar-width: thin;
  scrollbar-color: var(--vs-border-strong) transparent;
}
.model-field label,
.field-heading label,
.field-heading h2 {
  font-size: 12.5px;
  font-weight: 600;
}
.model-field label {
  display: block;
  margin-bottom: 8px;
}
.select-wrap {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  border: 1px solid var(--vs-border);
  border-radius: 11px;
  height: 44px;
  background: var(--vs-surface);
}
.select-wrap:focus-within {
  border-color: var(--vs-accent-border);
}
.select-wrap > svg:first-child {
  color: var(--vs-secondary);
  flex-shrink: 0;
}
select {
  appearance: none;
  background: transparent;
  font-size: 12px;
  width: 100%;
  outline: none;
  border: 0;
}
select option {
  background: var(--vs-panel);
  color: var(--vs-text);
}
.select-wrap > svg:last-child {
  pointer-events: none;
  color: var(--vs-muted);
  flex-shrink: 0;
}
.creation-modes {
  display: flex;
  gap: 2px;
  margin: 16px 0 20px;
  padding: 3px;
  border: 1px solid var(--vs-border);
  border-radius: 11px;
  background: var(--vs-surface);
}
.creation-modes button {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 6px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--vs-secondary);
  white-space: nowrap;
}
.creation-modes button > svg {
  flex-shrink: 0;
}
.creation-modes .selected {
  background: var(--vs-panel);
  color: var(--vs-text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
}
.field-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 11px;
}
.field-heading > svg {
  color: var(--vs-muted);
}
.frame-section {
  margin-bottom: 22px;
}
.frame-upload {
  position: relative;
  min-height: 154px;
  border: 1px dashed var(--vs-muted);
  border-radius: 10px;
  overflow: hidden;
  background: var(--vs-bg);
}
.frame-upload > img {
  width: 100%;
  height: 180px;
  object-fit: contain;
}
.frame-input {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 154px;
  cursor: pointer;
  color: var(--vs-secondary);
}
.frame-input strong {
  font-size: 12px;
  font-weight: 500;
}
.frame-input span {
  font-size: 10px;
  color: var(--vs-muted);
}
.frame-input input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.has-image .frame-input {
  position: absolute;
  inset: 0;
  min-height: 0;
  opacity: 0;
  background: #0008;
  color: #fff;
  transition: opacity 0.15s;
}
.has-image:hover .frame-input,
.has-image:focus-within .frame-input {
  opacity: 1;
}
.remove-frame {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
}
.prompt-box {
  border: 1px solid var(--vs-border);
  border-radius: 11px;
  background: var(--vs-bg);
  overflow: hidden;
}
.prompt-box:focus-within {
  border-color: var(--vs-accent-border);
}
.prompt-box textarea {
  display: block;
  width: 100%;
  min-height: 146px;
  resize: vertical;
  background: transparent;
  padding: 13px;
  font-size: 13px;
  line-height: 1.8;
  outline: none;
  border: 0;
}
textarea::placeholder {
  color: var(--vs-muted);
}
.prompt-bottom {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px 10px;
  color: var(--vs-muted);
  font-size: 10.5px;
}
.prompt-bottom span:last-child {
  white-space: nowrap;
}
.ai-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid var(--vs-accent-border);
  border-radius: 999px;
  background: var(--vs-accent-soft);
  color: var(--vs-accent-text);
  font-size: 11.5px;
  font-weight: 550;
}
.ai-button:disabled {
  border-color: var(--vs-border);
  background: var(--vs-surface);
  color: var(--vs-muted);
}
.polish-settings {
  border-bottom: 1px solid var(--vs-border);
  margin: 13px 0 20px;
  padding-bottom: 15px;
}
.polish-settings summary {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--vs-secondary);
  cursor: pointer;
  font-size: 12px;
  list-style: none;
}
summary::-webkit-details-marker {
  display: none;
}
.polish-settings summary span {
  margin-left: auto;
  color: var(--vs-muted);
  font-size: 11px;
}
.polish-content {
  padding-top: 15px;
}
.polish-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}
.switch-track {
  width: 30px;
  height: 18px;
  padding: 3px;
  border-radius: 20px;
  background: var(--vs-border);
}
.switch-track i {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--vs-muted);
  transition: transform 0.15s;
}
.switch-track.enabled {
  background: var(--vs-accent);
}
.switch-track.enabled i {
  transform: translateX(12px);
  background: var(--vs-on-accent);
}
.ai-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 12px;
  font-size: 11px;
  color: var(--vs-secondary);
}
.ai-field select,
.setting-input {
  border: 1px solid var(--vs-border);
  background: var(--vs-bg);
  padding: 10px;
  border-radius: 8px;
  font-size: 12px;
}
.settings-panel {
  padding: 14px;
  border: 1px solid var(--vs-border);
  border-radius: 13px;
  background: var(--vs-bg);
}
.settings-panel .field-heading {
  margin-bottom: 14px;
}
.settings-panel :deep(.vpc-heading) {
  font-size: 12px;
}
.settings-panel :deep(.vpc-hint) {
  font-size: 10px;
  line-height: 1.7;
}
.settings-panel :deep(.vpc-section) {
  padding: 12px 0;
}
.settings-panel :deep(.vpc-section:first-child) {
  padding-top: 0;
}
.settings-note {
  color: var(--vs-muted);
  font-size: 11px;
  line-height: 1.7;
  margin-top: 8px;
}
.setting-field {
  margin-top: 17px;
}
.setting-field h3 {
  font-size: 12px;
  color: var(--vs-secondary);
  margin-bottom: 9px;
}
.setting-choices {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--vs-surface);
  border-radius: 9px;
}
.setting-choices button {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  padding: 8px 4px;
  border-radius: 6px;
  color: var(--vs-secondary);
}
.setting-choices .selected {
  background: var(--vs-panel);
  color: var(--vs-text);
}
.advanced-settings {
  font-size: 12px;
  margin-top: 18px;
  color: var(--vs-secondary);
}
.advanced-settings summary {
  cursor: pointer;
}
.setting-error {
  color: var(--vs-danger);
}
.creation-footer {
  padding: 13px 22px 14px;
  border-top: 1px solid var(--vs-border);
  background: var(--vs-panel);
  flex-shrink: 0;
}
.cost-estimate {
  color: var(--vs-secondary);
  font-size: 11px;
  margin-bottom: 9px;
  line-height: 1.6;
}
.generate-button {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 12px;
  background: var(--vs-accent);
  color: var(--vs-on-accent);
  border-radius: 11px;
  font-size: 13.5px;
  font-weight: 650;
  box-shadow: 0 10px 24px -18px var(--vs-accent);
}
.generate-button:hover:enabled {
  background: var(--vs-accent-hover);
}
.shortcut-hint {
  text-align: center;
  font-size: 10px;
  color: var(--vs-muted);
  margin-top: 8px;
}
.results-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 26px;
  border-bottom: 1px solid var(--vs-border);
  flex-shrink: 0;
}
.results-title {
  display: flex;
  align-items: center;
  gap: 9px;
}
.results-title h2 {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.2px;
}
.count-badge {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--vs-surface);
  color: var(--vs-secondary);
}
.results-header p {
  color: var(--vs-muted);
  font-size: 11.5px;
  margin-top: 3px;
}
.reset-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 12px;
  font-size: 12.5px;
  font-weight: 550;
  color: var(--vs-secondary);
  background: var(--vs-panel);
  border: 1px solid var(--vs-border);
  border-radius: 10px;
  white-space: nowrap;
}
.reset-button:hover:enabled {
  border-color: var(--vs-border-strong);
  color: var(--vs-text);
}
.results-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 26px;
}
.result-filters {
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--vs-border);
  border-radius: 11px;
  background: var(--vs-surface);
}
.result-filters button {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 550;
  color: var(--vs-secondary);
  white-space: nowrap;
  border-radius: 8px;
}
.result-filters button:hover:enabled {
  color: var(--vs-text);
}
.result-filters .selected {
  background: var(--vs-panel);
  color: var(--vs-text);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
}
.result-filters span {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--vs-muted);
}
.result-search {
  width: 200px;
  min-width: 0;
  display: flex;
  gap: 7px;
  align-items: center;
  height: 34px;
  padding: 0 10px;
  background: var(--vs-panel);
  border: 1px solid var(--vs-border);
  border-radius: 10px;
  color: var(--vs-muted);
}
.result-search:focus-within {
  border-color: var(--vs-accent-border);
}
.result-search input {
  width: 100%;
  background: transparent;
  outline: none;
  font-size: 12px;
}
.results-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 26px 24px;
  scrollbar-width: thin;
  scrollbar-color: var(--vs-border-strong) transparent;
}
.results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 310px), 1fr));
  gap: 20px;
  align-items: start;
}
.empty-results {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 30px 16px;
}
.empty-visual {
  width: 180px;
  height: 132px;
  position: relative;
  margin-bottom: 28px;
}
.empty-frame {
  position: absolute;
  width: 132px;
  height: 84px;
  border-radius: 12px;
  border: 1px solid var(--vs-border);
  background: var(--vs-panel);
}
.empty-frame.back {
  transform: rotate(-10deg);
  left: 15px;
  top: 14px;
  background: var(--vs-surface);
}
.empty-frame.front {
  display: grid;
  place-items: center;
  transform: rotate(7deg);
  left: 31px;
  top: 32px;
  color: var(--vs-muted);
  box-shadow: 0 12px 25px #00000008;
}
.empty-frame.front > svg {
  padding: 10px;
  box-sizing: content-box;
  border: 1px solid var(--vs-border);
  border-radius: 50%;
}
.empty-spark {
  position: absolute;
  right: 6px;
  top: 9px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--vs-accent-border);
  border-radius: 9px;
  background: var(--vs-accent-soft);
  color: var(--vs-accent-text);
  transform: rotate(10deg);
}
.empty-results h3 {
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.2px;
}
.empty-results > p {
  max-width: 24rem;
  color: var(--vs-secondary);
  font-size: 12.5px;
  line-height: 1.8;
  margin-top: 8px;
}
.inspirations {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}
.inspirations button {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--vs-border);
  background: var(--vs-panel);
  border-radius: 10px;
  font-size: 12px;
  font-weight: 550;
  color: var(--vs-secondary);
}
.inspirations button:hover:enabled {
  border-color: var(--vs-accent-border);
  background: var(--vs-accent-soft);
  color: var(--vs-accent-text);
}
.inspirations button > svg:last-child {
  width: 11px;
  transform: rotate(45deg);
  color: var(--vs-muted);
}
.results-footnote {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 11px 20px;
  color: var(--vs-muted);
  font-size: 10.5px;
  border-top: 1px solid var(--vs-border);
}
.text-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--vs-secondary);
}
.text-action:hover:enabled {
  color: var(--vs-text);
}
.reused-note {
  display: flex;
  gap: 6px;
  justify-content: space-between;
}
.studio-notice {
  font-size: 11.5px;
  padding: 10px 12px;
  margin-bottom: 12px;
  line-height: 1.7;
  border: 1px solid var(--st-danger-border, #fecaca);
  border-radius: 11px;
  background: var(--vs-error-bg);
  color: var(--vs-danger);
  overflow-wrap: anywhere;
}
.studio-notice button {
  text-decoration: underline;
  margin-left: 8px;
}
.legacy-notice {
  margin: 0 26px;
}
.legacy-notice:empty {
  display: none;
}
.button-spinner {
  width: 14px;
  height: 14px;
  display: inline-block;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (min-width: 1600px) {
  .video-studio {
    grid-template-columns: 420px minmax(0, 1fr);
  }
  .creation-scroll {
    padding-left: 28px;
    padding-right: 28px;
  }
}
@media (max-width: 1050px) and (min-width: 761px) {
  .video-studio {
    grid-template-columns: 348px minmax(0, 1fr);
  }
  .results-header,
  .results-scroll,
  .results-toolbar {
    padding-left: 20px;
    padding-right: 20px;
  }
  .results-toolbar {
    flex-wrap: wrap;
    gap: 10px;
  }
  .result-search {
    width: 100%;
  }
  .legacy-notice {
    margin: 0 20px;
  }
}
@media (max-width: 760px) {
  .video-studio {
    display: flex;
    flex-direction: column;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .creation-panel {
    flex: none;
    border-right: 0;
    border-bottom: 1px solid var(--vs-border);
  }
  .panel-heading {
    padding: 14px 16px;
  }
  .creation-scroll {
    overflow: visible;
    padding: 16px 16px 20px;
    flex: none;
  }
  .creation-footer {
    padding: 13px 16px;
    position: sticky;
    bottom: 0;
    z-index: 5;
    box-shadow: 0 -5px 20px rgba(16, 24, 40, 0.05);
  }
  .results-panel {
    flex: none;
    min-height: 480px;
  }
  .results-scroll {
    overflow: visible;
    flex: 1;
    padding: 12px 16px 20px;
  }
  .results-header {
    padding: 14px 16px;
  }
  .results-toolbar {
    padding: 12px 16px;
    gap: 10px;
    flex-wrap: wrap;
  }
  .legacy-notice {
    margin: 0 16px;
  }
  .result-search {
    width: 100%;
  }
  .result-filters {
    width: 100%;
  }
  .result-filters button {
    flex: 1;
    justify-content: center;
  }
  .results-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .empty-results {
    min-height: 320px;
    padding: 25px 6px;
  }
  .empty-results h3 {
    font-size: 16px;
  }
  .results-footnote {
    line-height: 1.8;
    text-align: center;
  }
}
@media (prefers-reduced-motion: reduce) {
  .button-spinner {
    animation: none;
  }
}
</style>
