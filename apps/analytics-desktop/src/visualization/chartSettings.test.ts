import { describe, expect, it } from 'vitest'
import { chartSettingsDelta, chartSettingsFor, defaultChartSettings } from './chartSettings.js'

describe('chartSettingsFor', () => {
  it('applies the defaults of the chart kind', () => {
    expect(chartSettingsFor('histogram').statsBox).toBe(true)
    expect(chartSettingsFor('scatter').statsBox).toBe(false)
    expect(chartSettingsFor('box').whiskerMode).toBe('tukey')
    expect(chartSettingsFor('qq').showOneToOne).toBe(true)
  })

  it('lets a saved value win over the defaults', () => {
    expect(chartSettingsFor('histogram', { statsBox: false, logX: true }).statsBox).toBe(false)
    expect(chartSettingsFor('histogram', { logX: true }).logX).toBe(true)
  })

  it('keeps defaults for fields a saved record does not mention', () => {
    expect(chartSettingsFor('scatter', { logX: true }).symbolSize).toBe(defaultChartSettings.symbolSize)
  })
})

describe('chartSettingsDelta', () => {
  it('saves nothing when the settings match the kind defaults', () => {
    expect(chartSettingsDelta('histogram', chartSettingsFor('histogram'))).toEqual({})
  })

  it('saves only what the user changed', () => {
    const settings = { ...chartSettingsFor('scatter'), logX: true, showOneToOne: true }
    expect(chartSettingsDelta('scatter', settings)).toEqual({ logX: true, showOneToOne: true })
  })

  it('compares list settings by content', () => {
    const settings = { ...chartSettingsFor('histogram'), referenceLines: ['mean' as const] }
    expect(chartSettingsDelta('histogram', settings)).toEqual({ referenceLines: ['mean'] })
  })

  it('round-trips through the defaults', () => {
    const settings = { ...chartSettingsFor('box'), decimals: 4, showPoints: true }
    expect(chartSettingsFor('box', chartSettingsDelta('box', settings))).toEqual(settings)
  })
})
