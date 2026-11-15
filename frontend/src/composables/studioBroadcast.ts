import { sessionOwnerKey } from './studioSession'

const KEY = 'studio-local-change'
type Kind = 'video' | 'chat'
const listeners = new Map<Kind, Set<() => void>>()
export function notifyStudioChange(kind: Kind, owner: string) {
  // A nonce makes successive commits observable without storing user content.
  try { localStorage.setItem(KEY, JSON.stringify({ kind, owner, nonce: `${Date.now()}-${Math.random()}` })) } catch { /* Persistence remains valid without notifications. */ }
}
export function onStudioChange(kind: Kind, listener: () => void) {
  if (!listeners.has(kind)) listeners.set(kind, new Set())
  listeners.get(kind)!.add(listener)
  return () => { listeners.get(kind)?.delete(listener) }
}
window.addEventListener('storage', event => {
  if (event.key !== KEY || !event.newValue) return
  try {
    const message = JSON.parse(event.newValue) as { kind: Kind; owner: string }
    if (message.owner === sessionOwnerKey()) listeners.get(message.kind)?.forEach(listener => listener())
  } catch { /* Ignore invalid or unrelated notifications. */ }
})
