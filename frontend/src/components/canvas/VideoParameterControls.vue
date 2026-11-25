<script lang="ts">
let instanceCounter = 0
</script>

<script setup lang="ts">
import { computed } from 'vue'

interface RatioOption {
  value: string
  label: string
  width: number
  height: number
}

interface ControlLabels {
  resolution: string
  duration: string
  ratio: string
  output: string
  seconds: string
  defaultResolution: string
  resolutionHint: string
  unsupportedResolution: string
  durationHint: string
}

const props = withDefaults(
  defineProps<{
    resolution: string
    resolutionOptions: readonly string[]
    supportedResolutions: readonly string[]
    duration: number
    durationMin: number
    durationMax: number
    durationStep?: number
    durationTicks: readonly number[]
    allowedDurations?: readonly number[]
    ratios: readonly RatioOption[]
    ratio: string
    quantity: number
    maxQuantity?: number
    labels: ControlLabels
  }>(),
  { durationStep: 1 }
)

const emit = defineEmits<{
  (e: 'update:resolution', value: string): void
  (e: 'update:duration', value: number): void
  (e: 'update:ratio', value: string): void
  (e: 'update:quantity', value: number): void
}>()

const uid = `vpc-${++instanceCounter}`
const ids = {
  resolution: `${uid}-resolution`,
  resolutionHint: `${uid}-resolution-hint`,
  durationLabel: `${uid}-duration-label`,
  slider: `${uid}-duration-slider`,
  number: `${uid}-duration-number`,
  unit: `${uid}-duration-unit`,
  hint: `${uid}-duration-hint`,
  ratio: `${uid}-ratio`,
  output: `${uid}-output`,
}

const quantityOptions = computed(() => [1, 2, 3, 4].filter(value => value <= (props.maxQuantity ?? 4)))

/* ---------- Duration ---------- */

const rangeMin = computed(() => Math.min(props.durationMin, props.durationMax))
const rangeMax = computed(() => Math.max(props.durationMin, props.durationMax))
const rangeSpan = computed(() => rangeMax.value - rangeMin.value || 1)
const safeStep = computed(() => (props.durationStep > 0 ? props.durationStep : 1))
const durationChoices = computed(() => props.allowedDurations || [])
const discreteDuration = computed(() => durationChoices.value.length > 0 && durationChoices.value.some((value, index, values) => index > 0 && value - values[index - 1] !== 1))

function supportedDuration(value: number) {
  if (durationChoices.value.length) return durationChoices.value.reduce((best, candidate) =>
    Number.isFinite(value) && Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  )
  return Math.min(rangeMax.value, Math.max(rangeMin.value, Number.isFinite(value) ? Math.round(value) : rangeMin.value))
}

const sliderValue = computed(() =>
  Math.min(rangeMax.value, Math.max(rangeMin.value, Number.isFinite(props.duration) ? props.duration : rangeMin.value))
)

const fraction = (v: number) => (v - rangeMin.value) / rangeSpan.value

const fillStyle = computed(() => ({ '--vpc-p': String(fraction(sliderValue.value)) }))

const visibleTicks = computed(() =>
  [...new Set(props.durationTicks)]
    .filter((t) => Number.isFinite(t) && t >= rangeMin.value && t <= rangeMax.value)
    .sort((a, b) => a - b)
    .map((t) => ({ value: t, style: { '--vpc-p': String(fraction(t)) } }))
)

function onSliderInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value) && value !== props.duration) emit('update:duration', supportedDuration(value))
}

const durationValid = computed(() => Number.isSafeInteger(props.duration) && props.duration >= rangeMin.value && props.duration <= rangeMax.value && (!props.allowedDurations || props.allowedDurations.includes(props.duration)))
function onNumberInput(event: Event) {
  emit('update:duration', (event.target as HTMLInputElement).valueAsNumber)
}
function commitDuration() {
  if (!durationValid.value) emit('update:duration', supportedDuration(props.duration))
}

/* ---------- Ratio icons ---------- */

const ICON_BOX = 18
const ICON_MIN = 6

const isAuto = (value: string) => value.trim().toLowerCase() === 'auto'

function iconStyle(option: RatioOption) {
  const w = option.width > 0 ? option.width : 1
  const h = option.height > 0 ? option.height : 1
  const scale = ICON_BOX / Math.max(w, h)
  return {
    width: `${Math.max(ICON_MIN, Math.round(w * scale))}px`,
    height: `${Math.max(ICON_MIN, Math.round(h * scale))}px`,
  }
}
</script>

<template>
  <div class="vpc">
    <!-- Resolution -->
    <section class="vpc-section">
      <h3 :id="ids.resolution" class="vpc-heading">{{ labels.resolution }}</h3>
      <div class="vpc-segmented vpc-segmented--resolution" :style="{ gridTemplateColumns: `repeat(${resolutionOptions.length}, minmax(0, 1fr))` }" role="group" :aria-labelledby="ids.resolution">
        <button
          v-for="option in resolutionOptions"
          :key="option"
          type="button"
          class="vpc-segment"
          :class="{ 'is-selected': option === resolution }"
          :aria-pressed="option === resolution"
          :disabled="!supportedResolutions.includes(option)"
          :title="!supportedResolutions.includes(option) ? labels.unsupportedResolution : undefined"
          :aria-describedby="ids.resolutionHint"
          @click="emit('update:resolution', option)"
        >
          {{ option === '' ? labels.defaultResolution : option === '4k' ? '4K' : option }}
        </button>
      </div>
      <p :id="ids.resolutionHint" class="vpc-hint" data-testid="video-resolution-hint" aria-live="polite">{{ labels.resolutionHint }}</p>
    </section>

    <!-- Duration -->
    <section class="vpc-section">
      <label :id="ids.durationLabel" :for="ids.slider" class="vpc-heading">{{ labels.duration }}</label>
      <div class="vpc-duration">
        <div class="vpc-slider" :style="fillStyle">
          <input
            :id="ids.slider"
            data-testid="video-duration-slider"
            class="vpc-range"
            type="range"
            :min="rangeMin"
            :max="rangeMax"
            :step="safeStep"
            :value="sliderValue"
            :aria-valuetext="`${duration} ${labels.seconds}`"
            @input="onSliderInput"
          />
          <div class="vpc-ticks" aria-hidden="true">
            <span
              v-for="tick in visibleTicks"
              :key="tick.value"
              class="vpc-tick"
              :class="{ 'is-active': tick.value === duration }"
              :style="tick.style"
            >
              <span class="vpc-tick-mark" />
              <span class="vpc-tick-label">{{ tick.value }}</span>
            </span>
          </div>
        </div>

        <div class="vpc-number">
          <select
            v-if="discreteDuration"
            :id="ids.number"
            data-testid="video-duration"
            class="vpc-number-input"
            :value="duration"
            :aria-describedby="ids.hint"
            :aria-labelledby="`${ids.durationLabel} ${ids.unit}`"
            @change="emit('update:duration', Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="value in durationChoices" :key="value" :value="value">{{ value }}</option>
          </select>
          <input
            v-else
            :id="ids.number"
            data-testid="video-duration"
            class="vpc-number-input"
            type="number"
            inputmode="numeric"
            :min="rangeMin"
            :max="rangeMax"
            :step="safeStep"
            :value="Number.isFinite(duration) ? duration : ''"
            :aria-invalid="!durationValid"
            :aria-describedby="ids.hint"
            :aria-labelledby="`${ids.durationLabel} ${ids.unit}`"
            @input="onNumberInput"
            @blur="commitDuration"
            @keydown.enter.prevent="commitDuration"
          />
          <span :id="ids.unit" class="vpc-unit">{{ labels.seconds }}</span>
        </div>
      </div>
      <p :id="ids.hint" data-testid="video-duration-hint" class="vpc-hint" :class="{ 'is-invalid': !durationValid }" aria-live="polite">{{ labels.durationHint }}</p>
    </section>

    <!-- Ratio -->
    <section class="vpc-section">
      <h3 :id="ids.ratio" class="vpc-heading">{{ labels.ratio }}</h3>
      <div class="vpc-segmented vpc-segmented--ratio" role="group" :aria-labelledby="ids.ratio">
        <button
          v-for="option in ratios"
          :key="option.value"
          type="button"
          class="vpc-segment vpc-ratio"
          :class="{ 'is-selected': option.value === ratio }"
          :aria-pressed="option.value === ratio"
          @click="emit('update:ratio', option.value)"
        >
          <span class="vpc-ratio-icon-box" aria-hidden="true">
            <span v-if="isAuto(option.value)" class="vpc-auto-icon">
              <span class="vpc-auto-corner vpc-auto-corner--tl" />
              <span class="vpc-auto-corner vpc-auto-corner--br" />
            </span>
            <span v-else class="vpc-ratio-icon" :style="iconStyle(option)" />
          </span>
          <span class="vpc-ratio-label">{{ option.label }}</span>
        </button>
      </div>
    </section>

    <!-- Output quantity -->
    <section class="vpc-section">
      <h3 :id="ids.output" class="vpc-heading">{{ labels.output }}</h3>
      <div
        class="vpc-segmented vpc-segmented--output"
        role="group"
        data-testid="video-output-count"
        :aria-labelledby="ids.output"
      >
        <button
          v-for="n in quantityOptions"
          :key="n"
          type="button"
          class="vpc-segment"
          :class="{ 'is-selected': n === quantity }"
          :aria-pressed="n === quantity"
          @click="emit('update:quantity', n)"
        >
          {{ n }}
        </button>
      </div>
    </section>
  </div>
</template>

<style>
.vpc {
  --_panel: var(--vs-panel, #1b1c20);
  --_surface: var(--vs-surface, #26272c);
  --_text: var(--vs-text, #f4f4f5);
  --_secondary: var(--vs-secondary, #b4b4bb);
  --_muted: var(--vs-muted, #7c7c85);
  --_border: var(--vs-border, rgba(255, 255, 255, 0.08));
  /* Selected state follows the studio accent so parameter pickers read the
   * same here and in the chat composer. */
  --_accent: var(--vs-accent, #059669);
  --_selected: var(--vs-accent-soft, color-mix(in srgb, var(--_accent) 12%, var(--_surface)));
  --_selected-text: var(--vs-accent-text, var(--_accent));
  --_selected-border: var(--vs-accent-border, color-mix(in srgb, var(--_accent) 40%, transparent));
  --_hover: color-mix(in srgb, var(--_text) 6%, var(--_surface));
  --_focus: var(--vs-focus, color-mix(in srgb, var(--_text) 70%, transparent));
  --_thumb-w: 12px;
  --_thumb-h: 22px;
  --_track-h: 6px;

  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 0;
  background: transparent;
  color: var(--_text);
  font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  border-radius: 14px;
  overflow: hidden;
}
.vpc *,
.vpc *::before,
.vpc *::after { box-sizing: border-box; }

.vpc-section { min-width: 0; padding: 14px 0; }
.vpc-section:first-child { padding-top: 0; }
.vpc-section:last-child { padding-bottom: 0; }
.vpc-section + .vpc-section { border-top: 1px solid var(--_border); }

.vpc-heading {
  display: block;
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--_secondary);
}

/* Segmented groups */
.vpc-segmented {
  display: grid;
  gap: 2px;
  padding: 3px;
  background: var(--_surface);
  border-radius: 12px;
  min-width: 0;
}
.vpc-segmented--resolution { grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); }
.vpc-segmented--ratio { grid-template-columns: repeat(auto-fit, minmax(60px, 1fr)); }
.vpc-segmented--output { grid-template-columns: repeat(4, minmax(0, 1fr)); }

.vpc-segment {
  appearance: none;
  min-width: 0;
  min-height: 38px;
  margin: 0;
  padding: 6px 8px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--_secondary);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.vpc-segment:hover:not(:disabled) { background: var(--_hover); color: var(--_text); }
.vpc-segment:disabled { opacity: 0.35; cursor: not-allowed; }
.vpc-segment.is-selected {
  background: var(--_selected);
  box-shadow: inset 0 0 0 1px var(--_selected-border);
  color: var(--_selected-text);
  font-weight: 600;
}
.vpc-segment:focus-visible,
.vpc-number-input:focus-visible {
  outline: 2px solid var(--_focus);
  outline-offset: 1px;
}

/* Ratio cards */
.vpc-ratio {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 70px;
  padding: 10px 4px 8px;
}
.vpc-ratio-icon-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
}
.vpc-ratio-icon {
  display: block;
  border: 1.5px solid currentColor;
  border-radius: 3px;
}
.vpc-auto-icon {
  position: relative;
  display: block;
  width: 18px;
  height: 18px;
  border: 1.5px solid currentColor;
  border-radius: 4px;
}
.vpc-auto-corner {
  position: absolute;
  width: 5px;
  height: 5px;
  border-color: currentColor;
  border-style: solid;
  border-width: 0;
}
.vpc-auto-corner--tl { top: 2.5px; left: 2.5px; border-top-width: 1.5px; border-left-width: 1.5px; }
.vpc-auto-corner--br { right: 2.5px; bottom: 2.5px; border-right-width: 1.5px; border-bottom-width: 1.5px; }
.vpc-ratio-label { font-size: 13px; line-height: 1.2; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }

/* Duration */
.vpc-duration {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 14px;
}
.vpc-slider {
  position: relative;
  min-width: 0;
  padding-top: 8px;
  --vpc-fill: calc(var(--_thumb-w) / 2 + (100% - var(--_thumb-w)) * var(--vpc-p, 0));
}
.vpc-range {
  -webkit-appearance: none;
  appearance: none;
  display: block;
  width: 100%;
  height: var(--_thumb-h);
  margin: 0;
  background: transparent;
  cursor: pointer;
}
.vpc-range:focus { outline: none; }
.vpc-range::-webkit-slider-runnable-track {
  height: var(--_track-h);
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--_accent) 0 var(--vpc-fill),
    var(--_surface) var(--vpc-fill) 100%
  );
}
.vpc-range::-moz-range-track {
  height: var(--_track-h);
  border-radius: 999px;
  background: var(--_surface);
}
.vpc-range::-moz-range-progress {
  height: var(--_track-h);
  border-radius: 999px;
  background: color-mix(in srgb, var(--_text) 32%, var(--_surface));
}
.vpc-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: var(--_thumb-w);
  height: var(--_thumb-h);
  margin-top: calc((var(--_track-h) - var(--_thumb-h)) / 2);
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}
.vpc-range::-moz-range-thumb {
  width: var(--_thumb-w);
  height: var(--_thumb-h);
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}
.vpc-range:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--_focus); outline-offset: 2px; }
.vpc-range:focus-visible::-moz-range-thumb { outline: 2px solid var(--_focus); outline-offset: 2px; }

.vpc-ticks {
  position: relative;
  height: 22px;
  margin-top: 2px;
  pointer-events: none;
}
.vpc-tick {
  position: absolute;
  top: 0;
  left: calc(var(--_thumb-w) / 2 + (100% - var(--_thumb-w)) * var(--vpc-p, 0));
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateX(-50%);
}
.vpc-tick-mark {
  width: 1px;
  height: 4px;
  background: var(--_muted);
  opacity: 0.6;
}
.vpc-tick-label {
  margin-top: 2px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--_muted);
}
.vpc-tick.is-active .vpc-tick-label { color: var(--_text); font-weight: 600; }

.vpc-number {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 44px;
  padding: 0 10px 0 4px;
  border: 1px solid var(--_border);
  border-radius: 10px;
  background: var(--_surface);
}
.vpc-number:focus-within { border-color: color-mix(in srgb, var(--_text) 35%, transparent); }
.vpc-number-input {
  width: 4.5ch;
  min-width: 0;
  height: 32px;
  padding: 0 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--_text);
  font: inherit;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
select.vpc-number-input {
  width: 4rem;
  padding-inline: 8px;
  text-align: left;
}
select.vpc-number-input option { background: var(--_surface); color: var(--_text); }
.vpc-hint { margin: 8px 0 0; color: var(--_muted); font-size: 11px; line-height: 1.6; }
.vpc-hint.is-invalid { color: var(--vs-danger, #ef4444); }
.vpc-number-input[aria-invalid="true"] { outline: 1px solid var(--vs-danger, #ef4444); }
.vpc-unit { color: var(--_secondary); font-size: 13px; }

@media (max-width: 640px) {
  .vpc-segment { min-height: 44px; }
  .vpc-ratio { min-height: 64px; }
}
@media (max-width: 360px) {
  .vpc-duration { gap: 10px; }
  .vpc-ratio { min-height: 62px; }
  .vpc-segment { padding-inline: 4px; font-size: 12px; }
  .vpc-tick:nth-child(2) { display: none; }
  .vpc-number { padding-right: 6px; }
  .vpc-number-input { width: 3.5ch; }
}
@media (prefers-reduced-motion: reduce) {
  .vpc-segment { transition: none; }
}
</style>
