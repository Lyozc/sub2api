import { videoCapabilities } from '@/composables/videoModelCapabilities'

export const grokVideoPriceResolutions = [
  { key: '480p', label: '480p' },
  { key: '720p', label: '720p' },
  { key: '1080p', label: '1080p' }
] as const

export const grokVideoPriceFamilies = [
  { key: 'grok-imagine-video', label: 'grok-imagine-video' },
  { key: 'grok-imagine-video-1.5', label: 'grok-imagine-video-1.5' }
] as const

export const klingVideoPriceFamilies = [
  { key: 'kling-v4', label: 'Kling 4.0 · kling-v4' },
  { key: 'kling-v4-flash', label: 'Kling 4.0 Flash · kling-v4-flash' },
  { key: 'kling-v3', label: 'Kling 3.0 · kling-v3' },
  { key: 'kling-v3-omni', label: 'Kling 3.0 Omni · kling-v3-omni' },
  { key: 'kling-o1', label: 'Kling O1 · kling-o1' },
  { key: 'kling-v2-6', label: 'Kling 2.6 · kling-v2-6' },
] as const

const seedanceVideoResolutions: Record<string, string[]> = {
  'seedance_2.0': ['720p', '1080p', '4k'],
  'seedance_2.0_fast': ['720p'],
  'seedance_2.0_mini': ['720p'],
  'seedance_2.5': ['480p', '720p', '1080p', '4k'],
  'seedance_2.5_draft': ['480p'],
  'seedance_2.5_flash': ['480p', '720p'],
  'seedance_pro_fast': ['720p', '1080p'],
}

export function videoPriceResolutions(platform = 'grok') {
  return platform === 'kling'
    ? [...grokVideoPriceResolutions, { key: '4k', label: '4K' }]
    : [...grokVideoPriceResolutions]
}

export function videoModelSupportsResolution(model: string, resolution: string, platform = 'grok') {
  // Keep pre-existing custom models editable. Only disable verified unsupported tiers.
  const seedance = seedanceVideoResolutions[model]
  if (platform === 'kling' && seedance) return seedance.includes(resolution)
  const known = klingVideoPriceFamilies.some(family => family.key === model)
  return platform !== 'kling' || !known || videoCapabilities(model).resolutions.includes(resolution)
}

function knownFamilies(platform: string) {
  return platform === 'kling'
    ? [...klingVideoPriceFamilies, ...Object.keys(seedanceVideoResolutions).map(key => ({ key, label: key }))]
    : grokVideoPriceFamilies
}

export type VideoModelPrices = Record<string, Record<string, number>>
export type VideoModelPricesForm = Record<string, Record<string, number | string | null>>

function normalizeFamily(value: string): string {
  const raw = value.trim().toLowerCase()
  if (!raw.startsWith('kling-')) return raw
  const pro = raw.endsWith('-pro') ? '-pro' : ''
  let id = pro ? raw.slice(0,-4) : raw
  id = id.replace(/_/g,'-').replace(/^kling-(?:video-)?v?/, '').replace(/\./g,'-')
  const aliases: Record<string,string> = { '4':'kling-v4','4-0':'kling-v4','4-flash':'kling-v4-flash','4-0-flash':'kling-v4-flash','3':'kling-v3','3-0':'kling-v3','3-omni':'kling-v3-omni','3-0-omni':'kling-v3-omni','2-6':'kling-v2-6','2-5':'kling-v2-5-turbo','2-5-turbo':'kling-v2-5-turbo','o1':'kling-o1' }
  return aliases[id] ? aliases[id]+pro : raw
}

function normalizePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const price = Number(value)
  return Number.isFinite(price) && price >= 0 ? price : null
}

function emptyTiers(platform = 'grok'): Record<string, number | string | null> {
  return Object.fromEntries(videoPriceResolutions(platform).map(({ key }) => [key, null]))
}

// Keep unknown families from an existing group so a future backend catalog is
// not silently discarded when an operator edits another group setting.
export function createVideoModelPricesForm(
  prices?: VideoModelPrices | VideoModelPricesForm | null, platform = 'grok'
): VideoModelPricesForm {
  const form: VideoModelPricesForm = {}

  for (const [rawFamily, rawTiers] of Object.entries(prices ?? {})) {
    const family = normalizeFamily(rawFamily)
    if (!family || !rawTiers || typeof rawTiers !== 'object') continue
    form[family] ??= emptyTiers(platform)
    for (const [rawResolution, rawPrice] of Object.entries(rawTiers)) {
      const price = normalizePrice(rawPrice)
      if (price !== null) form[family][rawResolution.trim().toLowerCase()] = price
    }
  }

  for (const { key } of knownFamilies(platform)) {
    form[key] ??= emptyTiers(platform)
  }
  return form
}

export function serializeVideoModelPrices(form: VideoModelPricesForm): VideoModelPrices {
  const result: VideoModelPrices = {}
  for (const [rawFamily, tiers] of Object.entries(form)) {
    const family = normalizeFamily(rawFamily)
    if (!family || !tiers || typeof tiers !== 'object') continue

    const normalizedTiers: Record<string, number> = {}
    for (const [rawResolution, rawPrice] of Object.entries(tiers)) {
      const resolution = rawResolution.trim().toLowerCase()
      const price = normalizePrice(rawPrice)
      if (resolution && price !== null) normalizedTiers[resolution] = price
    }
    if (Object.keys(normalizedTiers).length > 0) result[family] = normalizedTiers
  }
  return result
}

export function videoModelPriceFamilyRows(form: VideoModelPricesForm, platform = 'grok') {
  const known = new Set<string>(knownFamilies(platform).map(({ key }) => key))
  const extra = Object.keys(form)
    .map(normalizeFamily)
    .filter((family) => family && !known.has(family) && Object.values(form[family] || {}).some(value => normalizePrice(value) !== null))
    .sort()
    .map((key) => ({ key, label: key }))
  return [...knownFamilies(platform), ...extra]
}
