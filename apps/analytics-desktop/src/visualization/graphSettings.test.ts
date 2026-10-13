import { describe, expect, it } from 'vitest'
import { DEFAULT_GRAPH_SETTINGS, applyGraphSettings, normalizeGraphSettings } from './graphSettings.js'

const option = {
  legend: { top: 0 },
  series: [{ type: 'heatmap', label: { show: true } }],
  xAxis: { type: 'value', name: 'Strength (MPa)', splitLine: { lineStyle: { color: '#ccc' } } },
  yAxis: [{ type: 'value', name: 'E (GPa)', axisLabel: { show: false } }],
}

describe('graph settings', () => {
  it('applies font family and size to axes, legend, labels and text', () => {
    const result = applyGraphSettings(option, { ...DEFAULT_GRAPH_SETTINGS, font: 'arial', fontSize: 14 }) as Record<string, any>
    expect(result.xAxis.axisLabel).toMatchObject({ fontFamily: expect.stringContaining('Arial'), fontSize: 14, show: true })
    expect(result.xAxis.nameTextStyle.fontSize).toBe(14)
    expect(result.legend.textStyle.fontSize).toBe(14)
    expect(result.series[0].label).toMatchObject({ fontSize: 14, show: true })
    expect(result.yAxis[0].axisLabel.show).toBe(false) // an axis the chart hides stays hidden
  })

  it('hides legend, axis titles, labels, grid and axis lines on request', () => {
    const result = applyGraphSettings(option, { ...DEFAULT_GRAPH_SETTINGS, axisLabels: false, axisLines: false, axisTitles: false, gridLines: false, legend: false }) as Record<string, any>
    expect(result.legend.show).toBe(false)
    expect(result.xAxis).toMatchObject({ name: '', axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } })
    expect((applyGraphSettings({ series: [] }, { ...DEFAULT_GRAPH_SETTINGS, legend: false }) as Record<string, any>).legend).toEqual({ show: false })
  })

  it('normalizes stored values', () => {
    expect(normalizeGraphSettings({ fontSize: 99, font: 'comic', legend: 'no' })).toEqual({ ...DEFAULT_GRAPH_SETTINGS, fontSize: 24 })
    expect(normalizeGraphSettings(null)).toEqual(DEFAULT_GRAPH_SETTINGS)
  })
})
