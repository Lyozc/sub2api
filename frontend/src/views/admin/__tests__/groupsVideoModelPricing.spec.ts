import { describe, expect, it } from 'vitest'

import {
  createVideoModelPricesForm,
  serializeVideoModelPrices,
  videoPriceResolutions,
  videoModelSupportsResolution,
  videoModelPriceFamilyRows
} from '../groupsVideoModelPricing'

describe('Grok video model pricing form', () => {
  it('provides editable rows for both canonical Grok video families', () => {
    const form = createVideoModelPricesForm()

    expect(videoModelPriceFamilyRows(form).map(({ key }) => key)).toEqual([
      'grok-imagine-video',
      'grok-imagine-video-1.5'
    ])
    expect(form['grok-imagine-video']['480p']).toBeNull()
    expect(form['grok-imagine-video-1.5']['1080p']).toBeNull()
  })

  it('serializes only finite non-negative prices and preserves future families', () => {
    const form = createVideoModelPricesForm({
      'grok-imagine-video-2': { '1080p': 0.4 }
    })
    form['grok-imagine-video']['480p'] = 0.05
    form['grok-imagine-video']['720p'] = ''
    form['grok-imagine-video-1.5']['1080p'] = -1

    expect(serializeVideoModelPrices(form)).toEqual({
      'grok-imagine-video': { '480p': 0.05 },
      'grok-imagine-video-2': { '1080p': 0.4 }
    })
  })

  it('round-trips unknown model families so editing does not discard them', () => {
    const form = createVideoModelPricesForm({
      'grok-imagine-video-2': { '480p': 0.2 }
    })

    expect(videoModelPriceFamilyRows(form).map(({ key }) => key)).toContain(
      'grok-imagine-video-2'
    )
    expect(serializeVideoModelPrices(form)).toMatchObject({
      'grok-imagine-video-2': { '480p': 0.2 }
    })
  })
})


describe('Kling video model pricing form', () => {
  it('provides Kling model rows and valid resolution tiers separately from Grok', () => {
    const form = createVideoModelPricesForm(undefined,'kling')
    expect(videoModelPriceFamilyRows(form,'kling').map(row=>row.key)).toEqual(['kling-v4','kling-v4-flash','kling-v3','kling-v3-omni','kling-o1','kling-v2-6'])
    expect(videoPriceResolutions('kling').map(row=>row.key)).toEqual(['720p','1080p','4k'])
    expect(form['kling-v4']['720p']).toBeNull()
    expect(videoModelSupportsResolution('kling-v4-flash','1080p','kling')).toBe(false)
    expect(videoModelSupportsResolution('kling-v4','4k','kling')).toBe(false)
    expect(videoModelSupportsResolution('kling-v3-omni','4k','kling')).toBe(true)
  })
  it('merges legacy aliases, preserves zero and custom prices, and clears only blank cells', () => {
    const form=createVideoModelPricesForm({'kling-4.0':{'720p':0.12},'kling-video-v4_0':{'1080p':0.25},'future-video':{'4k':1.1}},'kling')
    expect(form['kling-v4']).toMatchObject({'720p':0.12,'1080p':0.25})
    form['kling-v4-flash']['720p']=0
    form['kling-v4']['1080p']=''
    expect(serializeVideoModelPrices(form)).toEqual({'kling-v4':{'720p':0.12},'kling-v4-flash':{'720p':0},'future-video':{'4k':1.1}})
    expect(videoModelPriceFamilyRows(form,'kling').some(row=>row.key==='grok-imagine-video')).toBe(false)
  })
})
