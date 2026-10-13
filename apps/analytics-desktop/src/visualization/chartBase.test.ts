import { describe, expect, it } from 'vitest'
import type { EChartsCoreOption } from 'echarts/core'
import { applyViewSettings, axisValues, chartCsv, nonPositiveCount, valueAxis } from './chartBase.js'
import { chartSettingsFor } from './chartSettings.js'

const scatter = {
  series: [{
    data: [{ sourceObservationIds: ['a'], value: [1, 10] }, { sourceObservationIds: ['b'], value: [0, 20] }],
    name: 'Observations',
    type: 'scatter',
  }],
  xAxis: valueAxis('Au (g/t)'),
  yAxis: valueAxis('Cu (%)'),
} as EChartsCoreOption

const bars = {
  series: [{ data: [{ name: '0–1', sourceObservationIds: [], value: 40 }, { name: '1–2', sourceObservationIds: [], value: 60 }], name: 'Raw', type: 'bar' }],
  xAxis: { data: ['0–1', '1–2'], name: 'Au (g/t)', type: 'category' },
  yAxis: valueAxis('Relative frequency (%)'),
} as EChartsCoreOption

describe('axisValues', () => {
  it('reads paired values per axis', () => {
    expect(axisValues(scatter, 'x')).toEqual([1, 0])
    expect(axisValues(scatter, 'y')).toEqual([10, 20])
  })

  it('reads scalar bar values as the y axis', () => {
    expect(axisValues(bars, 'y')).toEqual([40, 60])
  })
})

describe('nonPositiveCount', () => {
  it('counts what a log axis would drop', () => {
    expect(nonPositiveCount(scatter, 'x')).toBe(1)
    expect(nonPositiveCount(scatter, 'y')).toBe(0)
  })
})

describe('applyViewSettings', () => {
  it('switches a value axis to log only on the requested side', () => {
    const option = applyViewSettings(scatter, { ...chartSettingsFor('scatter'), logX: true }) as Record<string, Record<string, unknown>>
    expect(option.xAxis?.type).toBe('log')
    expect(option.yAxis?.type).toBe('value')
  })

  it('leaves a category axis alone', () => {
    const option = applyViewSettings(bars, { ...chartSettingsFor('histogram'), logX: true }) as Record<string, Record<string, unknown>>
    expect(option.xAxis?.type).toBe('category')
  })

  it('applies mark settings to scatter series only', () => {
    const settings = { ...chartSettingsFor('scatter'), opacity: 0.4, symbol: 'cross' as const, symbolSize: 11 }
    const option = applyViewSettings(scatter, settings) as Record<string, Array<Record<string, unknown>>>
    expect(option.series?.[0]?.symbolSize).toBe(11)
    expect((option.series?.[0]?.itemStyle as Record<string, unknown>).opacity).toBe(0.4)
    const barOption = applyViewSettings(bars, settings) as Record<string, Array<Record<string, unknown>>>
    expect(barOption.series?.[0]?.symbolSize).toBeUndefined()
  })
})

describe('chartCsv', () => {
  it('writes paired series with the axis names as headers', () => {
    expect(chartCsv(scatter).split('\n')).toEqual([
      'series,category,Au (g/t),Cu (%)',
      'Observations,,1,10',
      'Observations,,0,20',
    ])
  })

  it('writes category series with their labels', () => {
    expect(chartCsv(bars).split('\n')).toEqual([
      'series,category,Au (g/t),Relative frequency (%)',
      'Raw,0–1,0–1,40',
      'Raw,1–2,1–2,60',
    ])
  })

  it('quotes values containing a comma', () => {
    const option = { series: [{ data: [{ name: 'a,b', value: 1 }], name: 'S', type: 'bar' }], xAxis: { data: ['a,b'], type: 'category' } } as EChartsCoreOption
    expect(chartCsv(option)).toContain('"a,b"')
  })
})
