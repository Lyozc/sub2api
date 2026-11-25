import type { activeTab } from '@/composables/useInfiniteCanvas'

export type StudioTab = typeof activeTab.value

export const studioSections = [
  { id: 'conversation', label: 'canvas.tabConversation', short: 'canvas.compactChat', icon: 'chat', tool: false },
  { id: 'chat', label: 'canvas.tabChat', short: 'canvas.compactImage', icon: 'sparkles', tool: false },
  { id: 'video', label: 'canvas.tabVideo', short: 'canvas.compactVideo', icon: 'play', tool: false },
  { id: 'prompts', label: 'canvas.tabPrompts', short: 'canvas.compactPrompts', icon: 'lightbulb', tool: true },
  { id: 'assets', label: 'canvas.tabAssets', short: 'canvas.compactAssets', icon: 'grid', tool: true },
  { id: 'config', label: 'canvas.tabConfig', short: 'canvas.tabConfig', icon: 'cog', tool: true }
] as const
