import { afterEach, describe, expect, it, vi } from 'vitest'
import { studioId, videoSubmissionKey } from '../studioIdentity'

afterEach(() => vi.unstubAllGlobals())
describe('public HTTP submission IDs', () => {
  it('uses cryptographic entropy without requiring randomUUID', () => {
    let sequence = 0
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.fill(++sequence); return bytes } })
    const ids = new Set(Array.from({ length: 4 }, () => videoSubmissionKey()))
    expect(ids.size).toBe(4)
    for (const id of ids) expect(id).toMatch(/^\d+-[a-f0-9]{32}$/)
  })
  it('reports unavailable entropy before any task is marked busy', () => {
    vi.stubGlobal('crypto', {})
    expect(studioId).toThrow('Secure random')
  })
})
