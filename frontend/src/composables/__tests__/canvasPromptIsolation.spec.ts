import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }))
beforeEach(() => { vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); localStorage.clear(); localStorage.setItem('auth_user', JSON.stringify({ id: 1 })) })
afterEach(() => { window.dispatchEvent(new Event('studio-session-ended')); vi.unstubAllGlobals() })
describe('prompt ownership', () => {
 it('keeps each owner’s edits and ignores the shared legacy database', async () => {
  const prompts = await import('../useInfiniteCanvas')
  await prompts.addPrompt('private', 'work', 'only user one')
  const id = prompts.prompts.value.find(p => p.content === 'only user one')!.id
  localStorage.setItem('auth_user', JSON.stringify({id:2}))
  window.dispatchEvent(new Event('studio-session-ended'))
  await prompts.loadPrompts()
  expect(prompts.prompts.value.some(p => p.content === 'only user one')).toBe(false)
  await prompts.deletePrompt(id)
  localStorage.setItem('auth_user', JSON.stringify({id:1}))
  window.dispatchEvent(new Event('studio-session-ended'))
  await prompts.loadPrompts()
  expect(prompts.prompts.value.some(p => p.content === 'only user one')).toBe(true)
 })
 it('requires an explicit import for unowned prompts and skips existing imports', async () => {
  const db = await new Promise<IDBDatabase>((resolve,reject) => {
   const req = indexedDB.open('canvas-db',3)
   req.onupgradeneeded = () => req.result.createObjectStore('prompts',{keyPath:'id'})
   req.onsuccess = () => resolve(req.result)
   req.onerror = () => reject(req.error)
  })
  await new Promise<void>(resolve => {
   const tx = db.transaction('prompts','readwrite')
   tx.objectStore('prompts').put({id:'old',name:'old prompt',category:'work',content:'unowned old prompt',updatedAt:1})
   tx.oncomplete = () => resolve()
  })
  db.close()
  const prompts = await import('../useInfiniteCanvas')
  await prompts.loadPrompts()
  expect(prompts.prompts.value.some(p => p.content === 'unowned old prompt')).toBe(false)
  await prompts.recoverLegacyPrompts()
  await prompts.recoverLegacyPrompts()
  expect(prompts.prompts.value.filter(p => p.content === 'unowned old prompt')).toHaveLength(1)
  localStorage.setItem('auth_user',JSON.stringify({id:2}))
  window.dispatchEvent(new Event('studio-session-ended'))
  await prompts.loadPrompts()
  expect(prompts.prompts.value.some(p => p.content === 'unowned old prompt')).toBe(false)
 })

})
