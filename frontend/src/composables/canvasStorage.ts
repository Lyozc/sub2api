import { sessionOwnerKey } from './studioSession'

export function openCanvasDb(owner = sessionOwnerKey()): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`canvas-db-${owner}`, 1)
    request.onupgradeneeded = () => {
      for (const store of ['prompts', 'online-prompts']) request.result.createObjectStore(store, { keyPath: 'id' })
    }
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(request.error)
  })
}
