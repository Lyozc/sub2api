<template>
  <WorkbenchLayout
    v-model:fullscreen="fullscreen"
    class="video-studio"
    :label="t('videoStudio.title')"
    v-model:rail-collapsed="railCollapsed"
    :rail-close-label="L.collapseRail"
  >
    <template #rail>
      <div class="rail-head">
        <button class="icon-button rail-close" type="button" :aria-label="L.collapseRail" @click="railCollapsed = true"><Icon name="x" size="sm" /></button>
        <div class="results-title">
          <h2>{{ L.recent }}</h2>
          <span class="count-badge">{{ totalCount }}</span>
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
      <div class="rail-tools">
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
      <ul
        v-if="conversationsReady && visibleTasks.length"
        class="rail-list"
        :aria-label="L.recent"
        @keydown="onRailKeydown"
      >
        <li v-for="task in visibleTasks" :key="task.taskId">
          <button
            type="button"
            class="rail-item"
            :data-rail-task="task.taskId"
            :class="{ selected: viewMode === 'preview' && previewTask?.taskId === task.taskId }"
            :aria-current="viewMode === 'preview' && previewTask?.taskId === task.taskId ? 'true' : undefined"
            :aria-label="`${L.previewTask}: ${task.prompt}`"
            @click="selectPreview(task)"
          >
            <span class="rail-status" :class="task.status" aria-hidden="true"
              ><Icon
                :name="task.status === 'done' ? 'play' : task.status === 'failed' ? 'exclamationCircle' : 'refresh'"
                size="xs"
            /></span>
            <span class="rail-text">
              <strong>{{ task.prompt }}</strong>
              <small>{{ task.model }} · {{ task.seconds }}s</small>
            </span>
          </button>
        </li>
      </ul>
      <p v-else-if="conversationsReady" class="rail-empty">
        {{ t(totalCount ? 'videoStudio.noMatchingCreations' : 'videoStudio.emptyTasks') }}
      </p>
      <footer class="results-footnote">
        <Icon name="inbox" size="xs" aria-hidden="true" /><span>{{ t('videoStudio.historyNote') }}</span>
      </footer>
    </template>

    <template #header>
      <div class="results-header">
        <button
          type="button"
          class="icon-button"
          :aria-label="railCollapsed ? L.expandRail : L.collapseRail"
          :title="railCollapsed ? L.expandRail : L.collapseRail"
          :aria-pressed="!railCollapsed"
          @click="railCollapsed = !railCollapsed"
        >
          <Icon name="menu" size="sm" />
        </button>
        <div class="header-text">
          <h1>{{ t('videoStudio.myCreations') }}</h1>
          <p>
            {{ activeCount ? t('videoStudio.activeTasks', { n: activeCount }) : t('videoStudio.resultsCaption') }}
          </p>
        </div>
        <div class="result-filters view-switch" role="group" :aria-label="L.viewMode">
          <button
            v-for="value in ['gallery', 'preview'] as const"
            :key="value"
            type="button"
            :class="{ selected: viewMode === value }"
            :aria-pressed="viewMode === value"
            @click="viewMode = value"
          >
            {{ L[value] }}
          </button>
        </div>
        <button
          type="button"
          class="icon-button"
          :aria-label="fullscreen ? L.exitFullscreen : L.fullscreen"
          :title="fullscreen ? L.exitFullscreen : L.fullscreen"
          :aria-pressed="fullscreen"
          @click="fullscreen = !fullscreen"
        >
          <Icon :name="fullscreen ? 'x' : 'arrowUp'" size="sm" />
        </button>
      </div>
    </template>

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
    <div ref="resultList" class="results-scroll">
      <div v-if="conversationInitError" class="empty-results" role="alert">
        <p>{{ conversationInitError }}</p>
        <button type="button" class="action primary" @click="initVideoConversations">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="!conversationsReady" class="empty-results" role="status">
        <span class="button-spinner"></span>
        <p>{{ t('videoStudio.loadingConversations') }}</p>
      </div>
      <template v-else-if="visibleTasks.length">
        <div v-if="viewMode === 'gallery'" class="results-grid">
          <VideoGenerationCard
            v-for="task in visibleTasks"
            :key="task.taskId"
            :task="task"
            :now="now"
            @reuse="continueCreation"
          />
        </div>
        <div v-else-if="previewTask" class="preview-stage">
          <VideoGenerationCard :key="previewTask.taskId" :task="previewTask" :now="now" @reuse="continueCreation" />
        </div>
        <p v-else class="rail-empty">{{ L.nothingToPreview }}</p>
      </template>
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
          {{ totalCount ? t('videoStudio.tryOtherFilter') : L.emptyHint }}
        </p>
        <div v-if="!totalCount" class="inspirations">
          <button v-for="idea in inspirations" :key="idea.key" type="button" @click="applyIdea(idea.key)">
            <Icon :name="idea.icon" size="xs" aria-hidden="true" />{{ t(`videoStudio.ideas.${idea.key}.title`)
            }}<Icon name="arrowUp" size="xs" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <template #composer>
      <form class="composer" @submit.prevent="send" @dragover.prevent @drop.prevent="onRefDrop" @paste="onPaste">
        <div v-if="mode === 'i2v'" class="ref-strip" :aria-busy="preparingFirstFrame">
          <template v-if="hasKlingReferenceControls()">
            <figure v-for="item in klingRefThumbs" :key="item.name" class="ref-thumb">
              <img :src="item.url" :alt="item.name" referrerpolicy="no-referrer" />
              <button
                type="button"
                :aria-label="t('videoStudio.removeReference', { name: item.name })"
                :disabled="preparingFirstFrame"
                @click="removeKlingReference(item.name)"
              >
                <Icon name="x" size="xs" />
              </button>
            </figure>
          </template>
          <figure v-else-if="refImages.length" class="ref-thumb">
            <img :src="refImages[0].url" :alt="t('videoStudio.firstFrame')" />
            <button type="button" :aria-label="t('videoStudio.removeFirstFrame')" @click="clearFirstFrame">
              <Icon name="x" size="xs" />
            </button>
          </figure>
          <button type="button" class="text-action" @click="showPicker = true">
            <Icon name="inbox" size="xs" />{{ t('videoStudio.materials') }}
          </button>
          <span v-if="preparingFirstFrame" class="settings-note" role="status">{{ t('videoStudio.preparingFrame') }}</span>
          <span v-else-if="referenceHint" class="settings-note setting-error" role="status">{{ referenceHint }}</span>
        </div>
        <div class="composer-main">
          <button
            type="button"
            class="plus-button"
            :aria-label="L.upload"
            :title="L.upload"
            :disabled="!conversationsReady || preparingFirstFrame"
            @click="onPlus"
          >
            <Icon name="plus" size="md" />
          </button>
          <input
            ref="fileInput"
            class="visually-hidden"
            type="file"
            tabindex="-1"
            accept="image/png,image/jpeg,image/webp"
            :aria-label="t('videoStudio.addFrame')"
            @change="onRefFilesChange"
          />
          <div class="prompt-box">
            <label for="video-prompt" class="visually-hidden">{{ t('videoStudio.describeIdea') }}</label>
            <textarea
              id="video-prompt"
              ref="promptInput"
              v-model="prompt"
              data-testid="video-prompt"
              :maxlength="capabilities.prompt_max"
              rows="2"
              :disabled="!conversationsReady"
              :placeholder="t('videoStudio.promptPlaceholder')"
              @keydown="onComposerKeydown"
            ></textarea>
            <div class="prompt-bottom">
              <span>{{ t('videoStudio.shortcutHint') }}</span
              ><span>{{ prompt.length }} / {{ capabilities.prompt_max }}</span>
            </div>
          </div>
        </div>
        <p v-if="contextTaskId !== null" class="settings-note reused-note">
          {{ t('videoStudio.parametersLoaded')
          }}<button type="button" class="text-action" @click="contextTaskId = null">
            {{ t('videoStudio.clearContext') }}
          </button>
        </p>
        <div class="composer-toolbar">
          <div class="creation-modes" role="group" :aria-label="L.mode">
            <button
              v-for="value in ['t2v', 'i2v'] as const"
              :key="value"
              type="button"
              :class="{ selected: mode === value }"
              :aria-pressed="mode === value"
              @click="setCreationMode(value)"
            >
              <Icon :name="value === 't2v' ? 'edit' : 'inbox'" size="xs" aria-hidden="true" />{{
                t(value === 't2v' ? 'videoStudio.modeText2Video' : 'videoStudio.modeImage2Video')
              }}
            </button>
          </div>

          <WorkbenchPopover
            :label="t('imageStudio.model')"
            :width="340"
            :disabled="!modelsReady"
            testid="video-model"
          >
            <template #trigger>
              <Icon name="sparkles" size="xs" aria-hidden="true" /><span class="chip-text">{{
                selectedModelOption ? selectedModelOption.id : L.selectModel
              }}</span
              ><Icon name="chevronDown" size="xs" aria-hidden="true" />
            </template>
            <template #default="{ close }">
            <h3 class="pop-title" id="video-model">{{ t('imageStudio.model') }}</h3>
            <p v-if="!modelOptions.length" class="settings-note">{{ t('videoStudio.chooseModel') }}</p>
            <div v-else class="model-options" role="radiogroup" aria-labelledby="video-model">
              <button
                v-for="option in modelOptions"
                :key="option.value"
                type="button"
                role="radio"
                class="model-option"
                :class="{ selected: selectedModel === option.value }"
                :aria-checked="selectedModel === option.value"
                :data-model-key="option.value"
                @click="chooseModel(option.value, close)"
              >
                <strong>{{ option.label }}</strong><small>{{ option.hint }}</small>
              </button>
            </div>
            </template>
          </WorkbenchPopover>

          <WorkbenchPopover
            v-if="mode === 'i2v' && hasKlingReferenceControls()"
            ref="refPopover"
            :label="L.references"
            :width="400"
          >
            <template #trigger>
              <Icon name="inbox" size="xs" aria-hidden="true" /><span class="chip-text">{{
                t(klingReferences.mode === 'frames' ? 'videoStudio.referenceFrames' : 'videoStudio.referenceOmni')
              }}</span>
            </template>
            <VideoReferenceControls @pick="showPicker = true" />
          </WorkbenchPopover>

          <WorkbenchPopover :label="L.output" :width="380">
            <template #trigger>
              <Icon name="slidersHorizontal" size="xs" aria-hidden="true" /><span class="chip-text">{{
                outputSummary
              }}</span>
            </template>
            <div class="settings-panel">
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
            </div>
          </WorkbenchPopover>

          <WorkbenchPopover :label="L.advanced" :width="360">
            <template #trigger>
              <Icon name="cog" size="xs" aria-hidden="true" /><span class="chip-text">{{ L.advanced }}</span>
            </template>
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
            </template>
            <div class="polish-content">
              <h3 class="pop-title">{{ t('canvasChat.polishSettings') }}</h3>
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
          </WorkbenchPopover>

          <button
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

          <div class="send-group">
            <div class="cost-estimate" data-testid="video-cost-estimate" aria-live="polite">
              <strong>{{ preparingFirstFrame ? t('videoStudio.preparingFrame') : estimatedCost }}</strong>
              <small v-if="estimateBreakdown && !preparingFirstFrame" data-testid="video-cost-breakdown">{{ estimateBreakdown }}</small>
            </div>
            <button class="generate-button" data-testid="video-send" type="submit" :disabled="!canSend">
              <span v-if="generating" class="button-spinner" aria-hidden="true"></span
              ><Icon v-else name="sparkles" size="sm" aria-hidden="true" />{{
                generating ? t('videoStudio.batchGenerating') : t('videoStudio.generateN', { n: quantity })
              }}
            </button>
          </div>
        </div>
      </form>
    </template>

    <template #overlay>
      <CanvasImagePicker v-if="showPicker" :max-select="1" @close="showPicker = false" @import="onImportFromImage" />
    </template>
  </WorkbenchLayout>
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
import WorkbenchLayout from './WorkbenchLayout.vue'
import WorkbenchPopover from './WorkbenchPopover.vue'
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
  klingReferences,
  removeKlingReference,
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
const estimatedUnitPrice = computed(() => {
  const option = models.value.find((o) => o.id === model.value && o.group_id === modelGroupId.value)
  const isPro = option?.platform === 'kling' && capabilities.value.modes.includes(klingSettings.value.mode) && klingSettings.value.mode === 'pro'
  const prices = isPro ? option?.pro_unit_prices : option?.unit_prices
  const price = prices?.[selectedResolution.value || capabilities.value.default_resolution]
  return typeof price === 'number' && Number.isFinite(price) && price >= 0 ? price : null
})
const hasBillableVideoReference = computed(() => mode.value === 'i2v' && hasKlingReferenceControls() && activeKlingReferences().media.some(item => item.name.startsWith('video_')))
const estimatedCost = computed(() => {
  if (!durationValid.value || !validVideoQuantity(quantity.value)) return ''
  const price = estimatedUnitPrice.value
  if (price == null) return t('videoStudio.costUnavailable')
  return t(hasBillableVideoReference.value ? 'videoStudio.estimatedMinimumCost' : 'videoStudio.estimatedCost', {
    cost: (price * seconds.value * quantity.value).toFixed(4)
  })
})
const estimateBreakdown = computed(() => {
  if (estimatedUnitPrice.value == null || !durationValid.value || !validVideoQuantity(quantity.value)) return ''
  if (hasBillableVideoReference.value) return t('videoStudio.referenceCostPending')
  return t('videoStudio.costBreakdown', {
    price: estimatedUnitPrice.value.toFixed(4), seconds: seconds.value, count: quantity.value
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
    previewTaskId.value = created[0].taskId
    void nextTick(() => resultList.value?.scrollTo({ top: 0, behavior: 'smooth' }))
  }
}

// ---- Workbench layout state (UI only; never triggers generation) ----
const { locale } = useI18n()
const localMessages = {
  zh: {
    workbench: '视频工作台',
    recent: '最近创作',
    gallery: '画廊',
    preview: '预览',
    viewMode: '结果视图',
    previewTask: '预览此作品',
    fullscreen: '全屏',
    exitFullscreen: '退出全屏',
    collapseRail: '收起侧栏',
    expandRail: '展开侧栏',
    upload: '上传参考图',
    references: '参考素材',
    mode: '创作模式',
    advanced: '高级设置',
    output: '输出设置',
    noReference: '图生视频需要上传参考图',
    nothingToPreview: '选择左侧作品进行预览',
    selectModel: '选择模型',
    defaultRes: '默认',
    emptyHint: '在下方描述画面、选择模型与参数，开始创作你的第一支视频。'
  },
  en: {
    workbench: 'Video workbench',
    recent: 'Recent creations',
    gallery: 'Gallery',
    preview: 'Preview',
    viewMode: 'Result view',
    previewTask: 'Preview this creation',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    collapseRail: 'Collapse sidebar',
    expandRail: 'Expand sidebar',
    upload: 'Upload reference image',
    references: 'References',
    mode: 'Creation mode',
    advanced: 'Advanced settings',
    output: 'Output settings',
    noReference: 'Image-to-video needs a reference image',
    nothingToPreview: 'Pick a creation from the sidebar to preview',
    selectModel: 'Select model',
    defaultRes: 'Default',
    emptyHint: 'Describe your scene below, choose a model and settings, and create your first video.'
  }
} as const
const L = computed(() => (String(locale.value).toLowerCase().startsWith('zh') ? localMessages.zh : localMessages.en))
const viewMode = ref<'gallery' | 'preview'>('gallery')
const previewTaskId = ref<number | null>(null)
const compactViewport = window.matchMedia('(max-width: 860px)')
const railCollapsed = ref(compactViewport.matches)
function onCompactViewport(event: MediaQueryListEvent) { if (event.matches) railCollapsed.value = true }
const fullscreen = ref(false)
const fileInput = ref<HTMLInputElement>()
const refPopover = ref<{ open: () => void; close: () => void }>()
const previewTask = computed(
  () => visibleTasks.value.find((task) => task.taskId === previewTaskId.value) || visibleTasks.value[0]
)
function selectPreview(task: VideoTask) {
  previewTaskId.value = task.taskId
  viewMode.value = 'preview'
}
function onRailKeydown(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const list = visibleTasks.value
  if (!list.length) return
  event.preventDefault()
  const index = list.findIndex((task) => task.taskId === previewTask.value?.taskId)
  const next =
    event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1
      : Math.min(list.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))
  selectPreview(list[next])
  const target = event.currentTarget as HTMLElement | null
  void nextTick(() =>
    target
      ?.querySelector<HTMLElement>(`[data-rail-task="${list[next].taskId}"]`)
      ?.focus()
  )
}
const selectedModelOption = computed(() => models.value.find((o) => modelKey(o) === selectedModel.value))
function chooseModel(value: string, close: (returnFocus?: boolean) => void) {
  selectedModel.value = value
  close(true)
}
const outputSummary = computed(() => {
  const res = selectedResolution.value
  const ratio = aspectOptions.value.find((option) => option.value === videoSize.value)?.label || ''
  return [res ? (res === '4k' ? '4K' : res) : L.value.defaultRes, `${seconds.value}${t('videoStudio.secondsUnit')}`, ratio, `×${quantity.value}`]
    .filter(Boolean)
    .join(' · ')
})
const klingRefThumbs = computed(() => {
  if (mode.value !== 'i2v' || !hasKlingReferenceControls()) return []
  const draft = klingReferences.value
  return draft.mode === 'frames' ? draft.frames : draft.images
})
const referenceHint = computed(() => {
  if (mode.value !== 'i2v') return ''
  if (hasKlingReferenceControls()) {
    const error = validateVideoReferences(activeKlingReferences(), capabilities.value.references, klingSettings.value.sound)
    return error ? t(`videoStudio.${error}`) : ''
  }
  return refImages.value.length ? '' : L.value.noReference
})
async function onPlus() {
  if (mode.value !== 'i2v') setCreationMode('i2v')
  await nextTick()
  if (hasKlingReferenceControls()) refPopover.value?.open()
  else fileInput.value?.click()
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
  compactViewport.addEventListener('change', onCompactViewport)
  retryInit()
  void initVideoConversations()
  void initAIOptions()
  syncTicker()
})
onUnmounted(() => {
  invalidatePolish()
  window.removeEventListener('studio-session-ended', onSessionEnded)
  compactViewport.removeEventListener('change', onCompactViewport)
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
  /* Layout lives in WorkbenchLayout.vue; this rule only supplies palette tokens. */
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
h1 {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.2px;
}
.icon-button {
  flex-shrink: 0;
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
select option {
  background: var(--vs-panel);
  color: var(--vs-text);
}
.creation-modes {
  display: flex;
  gap: 2px;
  padding: 2px;
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
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border-radius: 7px;
  font-size: 12px;
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
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
/* ---- Rail ---- */
.rail-close { display: none; }
.rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 14px 10px;
}
.rail-tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 14px 10px;
}
.rail-tools .result-filters button {
  flex: 1;
  justify-content: center;
  padding: 0 6px;
}
.rail-tools .result-search {
  width: 100%;
}
.rail-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  list-style: none;
  margin: 0;
  padding: 4px 8px 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--vs-border-strong) transparent;
}
.rail-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px;
  border-radius: 10px;
  text-align: left;
  color: var(--vs-secondary);
}
.rail-item:hover {
  background: var(--vs-surface);
}
.rail-item.selected {
  background: var(--vs-accent-soft);
  color: var(--vs-text);
  box-shadow: inset 0 0 0 1px var(--vs-accent-border);
}
.rail-status {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--vs-surface);
  color: var(--vs-muted);
}
.rail-status.done {
  color: var(--vs-success);
}
.rail-status.failed {
  color: var(--vs-danger);
  background: var(--vs-error-bg);
}
.rail-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.rail-text strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 550;
}
.rail-text small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--vs-muted);
}
.rail-empty {
  flex: 1;
  padding: 16px;
  font-size: 12px;
  color: var(--vs-muted);
  text-align: center;
}
/* ---- Header ---- */
.header-text {
  flex: 1;
  min-width: 0;
}
.view-switch {
  flex-shrink: 0;
}
.preview-stage {
  max-width: 880px;
  margin: 0 auto;
}
/* ---- Composer ---- */
.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--vs-border);
  border-radius: 16px;
  background: var(--vs-panel);
  box-shadow: var(--st-shadow, 0 16px 36px -24px rgba(16, 24, 40, 0.45));
}
.composer:focus-within {
  border-color: var(--vs-accent-border);
}
.ref-strip {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  max-height: 74px;
}
.ref-thumb {
  flex-shrink: 0;
  position: relative;
  width: 52px;
  height: 52px;
  margin: 0;
  border: 1px solid var(--vs-border);
  border-radius: 9px;
  overflow: hidden;
  background: var(--vs-surface);
}
.ref-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ref-thumb button {
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--vs-panel);
  color: var(--vs-text);
  border: 1px solid var(--vs-border);
}
.ref-strip .settings-note {
  margin-top: 0;
}
.composer-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.plus-button {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border: 1px dashed var(--vs-border-strong);
  border-radius: 11px;
  background: var(--vs-surface);
  color: var(--vs-secondary);
}
.plus-button:hover:enabled {
  border-color: var(--vs-accent-border);
  color: var(--vs-accent-text);
}
.prompt-box {
  flex: 1;
  min-width: 0;
}
.prompt-box textarea {
  display: block;
  width: 100%;
  min-height: 52px;
  max-height: 28vh;
  resize: vertical;
  background: transparent;
  padding: 6px 2px;
  font-size: 13.5px;
  line-height: 1.7;
  outline: none;
  border: 0;
}
.composer-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.send-group {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  min-width: 0;
}
.pop-title {
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 10px;
}
.model-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.model-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid transparent;
  text-align: left;
  color: var(--vs-text);
}
.model-option:hover {
  background: var(--vs-surface);
}
.model-option.selected {
  border-color: var(--vs-accent-border);
  background: var(--vs-accent-soft);
}
.model-option strong {
  font-size: 12.5px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.model-option small {
  font-size: 11px;
  color: var(--vs-muted);
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
.polish-content {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--vs-border);
}
.polish-content:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
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
  min-width: 0;
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
.setting-field:first-child {
  margin-top: 0;
}
.setting-error {
  color: var(--vs-danger);
}
.cost-estimate strong { display: block; font-weight: 600; color: var(--vs-accent-text); }
.cost-estimate small { display: block; margin-top: 2px; font-size: 10px; font-weight: 400; color: var(--vs-muted); }
.cost-estimate {
  color: var(--vs-secondary);
  font-size: 11px;
  line-height: 1.4;
  text-align: right;
  min-width: 0;
  overflow-wrap: anywhere;
}
.generate-button {
  display: flex;
  flex-shrink: 0;
  white-space: nowrap;
  min-height: 40px;
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
.results-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
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
  overscroll-behavior: contain;
  padding: 16px 20px 16px;
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
  margin: 0 14px 8px;
}
.legacy-notice:empty {
  display: none;
}
.studio-notice {
  margin: 12px 20px 0;
}
.results-footnote {
  flex-shrink: 0;
  padding: 9px 12px;
  line-height: 1.6;
  text-align: center;
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
@media (max-width: 860px) {
  /* Compact screens keep the canvas and composer visible; history opens as a drawer. */
  .rail-close { display: grid; }
  .rail-head,
  .rail-tools {
    padding: 8px 10px 6px;
  }
  .rail-tools {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .rail-tools .result-search {
    flex: 1 1 140px;
    width: auto;
  }
  .rail-list { overflow-y: auto; padding: 0 10px 8px; }
  .results-footnote {
    display: none;
  }
  .results-header,
  .results-scroll {
    padding-left: 12px;
    padding-right: 12px;
  }
  .header-text p {
    display: none;
  }
  .results-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .empty-results {
    min-height: 240px;
    padding: 20px 6px;
  }
  .empty-visual {
    display: none;
  }
}
@media (max-width: 520px) {
  .composer {
    padding: 8px;
  }
  .composer-toolbar {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .creation-modes, .send-group { grid-column: 1 / -1; }
  .composer-toolbar :deep(.wb-popover), .composer-toolbar :deep(.wb-chip) { width: 100%; }
  .send-group {
    width: 100%;
    margin-left: 0;
    justify-content: space-between;
  }
  .cost-estimate {
    text-align: left;
  }
  .creation-modes button {
    padding: 0 6px;
  }
  .plus-button {
    width: 34px;
    height: 34px;
  }
  .prompt-bottom span:first-child {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .button-spinner {
    animation: none;
  }
}
</style>
