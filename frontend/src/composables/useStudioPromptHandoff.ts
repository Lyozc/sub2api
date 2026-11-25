import { onScopeDispose } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { draftText as imageDraft } from './useChatDrawEngine'
import { activeTab } from './useInfiniteCanvas'
import { applyVideoPrompt, conversationInitError } from './useVideoStudioConversations'

const PROMPT_LIMIT = 4000

export function useStudioPromptHandoff() {
  const { t } = useI18n()
  const app = useAppStore()
  let request = 0
  onScopeDispose(() => { request++ })

  async function fillPrompt(kind: 'image' | 'video', text: string) {
    if (!text?.trim()) return
    const id = ++request
    const destination = t(kind === 'image' ? 'canvas.tabChat' : 'canvas.tabVideo')
    const value = text.slice(0, PROMPT_LIMIT)
    function acceptDraft(current: string) {
      if (id !== request) return false
      return !current.trim() || current === value || window.confirm(t('canvas.replaceDraftConfirm', { destination }))
    }

    if (kind === 'image') {
      if (!acceptDraft(imageDraft.value)) return
      imageDraft.value = value
    } else {
      const applied = await applyVideoPrompt(value, acceptDraft)
      if (id !== request) return
      if (!applied) {
        if (conversationInitError.value) app.showError(conversationInitError.value)
        return
      }
    }

    activeTab.value = kind === 'image' ? 'chat' : 'video'
    if (text.length > PROMPT_LIMIT) {
      app.showInfo(t('canvas.promptTruncated', { max: PROMPT_LIMIT, destination }))
    } else {
      app.showSuccess(t(kind === 'image' ? 'canvas.sentToImage' : 'canvas.sentToVideo'))
    }
  }

  return { fillPrompt }
}
