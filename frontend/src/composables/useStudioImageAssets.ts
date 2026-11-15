import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { listChatAssetTurns, deleteChatAsset, chatAssetRevision, type ChatTurn } from './useChatDrawEngine'
import { history, loadHistory, deleteHistory, type HistoryItem } from './useImageStudioEngine'
import { sessionOwnerKey } from './studioSession'

export interface StudioImageAsset extends Omit<HistoryItem, 'id'> {
  id: string
  remove: () => Promise<void>
}
export function useStudioImageAssets() {
  const chats = ref<ChatTurn[]>([])
  let revision = 0, disposed = false
  const urls = new Map<Blob, string>()
  function objectUrlFor(item: StudioImageAsset) {
    const blob = item.images[0]?.blob
    if (!blob) return ''
    let url = urls.get(blob)
    if (!url) { url = URL.createObjectURL(blob); urls.set(blob, url) }
    return url
  }
  const items = computed<StudioImageAsset[]>(() => [
    ...history.value.flatMap(item => item.images.flatMap((image, index) => image.blob && !image.failed ? [{
      ...item, id: `legacy:${item.id}:${index}`, images: [image], remove: () => deleteHistory(item.id),
    }] : [])),
    ...chats.value.flatMap(turn => turn.images.flatMap(image => image.status === 'done' && image.blob ? [{
      id: `chat:${turn.id}:${image.id}`, ts: turn.ts, model: turn.model, quality: turn.quality,
      format: turn.format, size: turn.size, actualSize: image.actualSize, prompt: turn.prompt,
      mode: (turn.refs.length ? 'i2i' : 't2i') as 't2i' | 'i2i', images: [{ blob: image.blob, failed: false }],
      starred: false, remove: async () => { await deleteChatAsset(turn.id, image.id); await reload() },
    }] : [])),
  ].sort((a, b) => b.ts - a.ts))
  function releaseUrls() { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear() }
  async function reload() {
    const version = ++revision, owner = sessionOwnerKey()
    const turns = await listChatAssetTurns().catch(() => [])
    if (disposed || version !== revision || owner !== sessionOwnerKey()) return
    chats.value = turns
    const blobs = new Set(items.value.map(item => item.images[0].blob))
    for (const [blob, url] of urls) if (!blobs.has(blob)) { URL.revokeObjectURL(url); urls.delete(blob) }
  }
  function reset() { revision++; chats.value = []; releaseUrls() }
  watch(chatAssetRevision, () => { void reload() })
  onMounted(() => {
    window.addEventListener('studio-session-ended', reset)
    void loadHistory()
    void reload()
  })
  onUnmounted(() => { disposed = true; reset(); window.removeEventListener('studio-session-ended', reset) })
  return { items, objectUrlFor, reload }
}
