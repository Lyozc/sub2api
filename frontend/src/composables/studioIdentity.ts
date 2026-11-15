/** Unique client IDs also work on public HTTP, where randomUUID is unavailable. */
export function studioId(): string {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto?.getRandomValues === 'function') {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
  }
  throw new Error('Secure random generation unavailable')
}
export function videoSubmissionKey(): string { return `${Date.now()}-${studioId()}` }
