import { describe, expect, it } from 'vitest'
import type { EChartsCoreOption } from 'echarts/core'
import { applyChartDesign, chartDesigns, isChartDesignId } from './chartDesigns.js'

describe('GeoEye chart designs', () => {
  it('exposes validated persistent design identifiers', () => {
    expect(chartDesigns).toHaveLength(21)
    expect(new Set(chartDesigns.map((design) => design.id))).toHaveProperty('size', 21)
    expect(chartDesigns.map((design) => design.id)).toEqual(expect.arrayContaining(['analytical', 'executive', 'high-contrast', 'obsidian-amber', 'ocean-depths', 'violet-surge', 'editorial-warm', 'arctic-slate', 'viridian', 'mineral-pastel', 'core-heat', 'midnight-copper', 'aurora-borealis', 'gemstone', 'desert-bloom', 'alpine-lake', 'rainforest', 'rose-quartz', 'seismic', 'night-signal', 'monochrome']))
    chartDesigns.forEach((design) => expect(design.palette).toHaveLength(6))
    expect(isChartDesignId('night-signal')).toBe(true)
    expect(isChartDesignId('unknown')).toBe(false)
  })

  it('applies palette, transparent canvas, fitted axes, and surface colors without changing chart data', () => {
    const option = {
      grid: { top: 40 },
      series: [{ data: [{ sourceObservationIds: ['obs-1'], value: 4 }], lineStyle: { type: 'dashed' }, type: 'line' }],
      xAxis: { type: 'value' },
      yAxis: { type: 'value' },
    } as EChartsCoreOption
    const styled = applyChartDesign(option, 'night-signal', {
      grid: 'rgba(255, 255, 255, 0.08)',
      gridStrong: 'rgba(255, 255, 255, 0.18)',
      muted: '#a0a8b0',
      surface: '#171b1e',
      text: '#eef1f3',
    }) as Record<string, unknown>
    const series = (styled.series as Array<Record<string, unknown>>)[0]
    const xAxis = styled.xAxis as Record<string, unknown>
    const grid = styled.grid as Record<string, unknown>

    expect(styled.backgroundColor).toBe('transparent')
    expect((series?.itemStyle as Record<string, unknown>).color).toBe('#20d6c7')
    expect((series?.lineStyle as Record<string, unknown>).type).toBe('dashed')
    expect((xAxis.axisLabel as Record<string, unknown>).color).toBe('#eef1f3')
    expect(xAxis.boundaryGap).toEqual(['3%', '6%'])
    expect(xAxis.scale).toBe(true)
    expect(grid).toEqual(expect.objectContaining({ containLabel: false, outerBoundsContain: 'all', outerBoundsMode: 'same', top: 40 }))
    expect((series?.data as unknown[])).toEqual([{ sourceObservationIds: ['obs-1'], value: 4 }])
  })

  it('adds richer marks while retaining series-specific behavior', () => {
    const styled = applyChartDesign({
      series: [
        { data: [2, 4], itemStyle: { opacity: 0.7 }, type: 'bar' },
        { data: [[1, 2]], symbolSize: 9, type: 'scatter' },
      ],
      xAxis: { data: ['A', 'B'], type: 'category' },
      yAxis: { min: 0, type: 'value' },
    } as EChartsCoreOption, 'analytical') as Record<string, unknown>
    const series = styled.series as Array<Record<string, unknown>>
    const barStyle = series[0]?.itemStyle as Record<string, unknown>
    const pointStyle = series[1]?.itemStyle as Record<string, unknown>

    expect(barStyle.color).toEqual(expect.objectContaining({ type: 'linear' }))
    expect(barStyle.opacity).toBe(0.7)
    expect(pointStyle.color).toEqual(expect.objectContaining({ type: 'radial' }))
    expect(series[1]?.symbolSize).toBe(9)
  })

  it('removes chart tool icons while retaining active drag brushing', () => {
    const styled = applyChartDesign({
      brush: { brushMode: 'single', toolbox: ['rect', 'polygon', 'keep', 'clear'] },
      series: [{ data: [[1, 2]], type: 'scatter' }],
      toolbox: { feature: { saveAsImage: {} } },
      xAxis: { type: 'value' },
      yAxis: { type: 'value' },
    } as EChartsCoreOption, 'analytical') as Record<string, unknown>

    expect(styled.brush).toEqual(expect.objectContaining({ brushMode: 'single', toolbox: [] }))
    expect(styled.toolbox).toEqual(expect.objectContaining({ show: false }))
  })

  it('adds adaptive text colors to labeled heatmap cells', () => {
    const styled = applyChartDesign({
      series: [{ data: [{ value: [0, 0, 0.95] }, { value: [0, 1, null] }], label: { show: true }, type: 'heatmap' }],
      visualMap: { max: 1, min: -1 },
      xAxis: { data: ['X'], type: 'category' },
      yAxis: { data: ['X'], type: 'category' },
    } as EChartsCoreOption, 'high-contrast') as Record<string, unknown>
    const series = (styled.series as Array<Record<string, unknown>>)[0]
    const data = series?.data as Array<Record<string, unknown>>

    expect(series?.label).toEqual(expect.objectContaining({ color: expect.stringMatching(/^#/), fontSize: 12, fontWeight: 700, opacity: 1, position: 'inside', show: true }))
    expect(series?.labelLayout).toEqual(expect.objectContaining({ hideOverlap: false }))
    data.forEach((datum) => expect(datum.label).toEqual(expect.objectContaining({
      color: expect.stringMatching(/^#/),
      textBorderColor: expect.stringMatching(/^rgba/),
      textBorderWidth: 1.5,
    })))
  })

  it('preserves explicitly contained axis labels for matrix charts', () => {
    const styled = applyChartDesign({
      grid: { containLabel: true },
      series: [{ data: [[0, 0, 1]], type: 'heatmap' }],
      xAxis: { data: ['Long X label'], type: 'category' },
      yAxis: { data: ['Long Y label'], type: 'category' },
    } as EChartsCoreOption, 'analytical') as Record<string, unknown>

    expect(styled.grid).toEqual(expect.objectContaining({ containLabel: true }))
  })

  it('leaves category axes on the ECharts band default so heatmaps can render', () => {
    const styled = applyChartDesign({
      series: [{ data: [[0, 0, 1]], type: 'heatmap' }],
      xAxis: { data: ['X'], type: 'category' },
      yAxis: { boundaryGap: true, data: ['Y'], type: 'category' },
    } as EChartsCoreOption, 'analytical') as Record<string, unknown>

    expect('boundaryGap' in (styled.xAxis as object)).toBe(false)
    expect((styled.yAxis as Record<string, unknown>).boundaryGap).toBe(true)
  })

  it('raises low-contrast palette colors against both dark and light chart surfaces', () => {
    const option = {
      series: [{ data: [1], type: 'line' }],
      xAxis: { type: 'value' },
      yAxis: { type: 'value' },
    } as EChartsCoreOption
    const dark = applyChartDesign(option, 'ocean-depths', {
      grid: '#27313a', gridStrong: '#46515b', muted: '#aab3ba', surface: '#090b0d', text: '#f2f5f7',
    }) as Record<string, unknown>
    const light = applyChartDesign(option, 'aurora-borealis', {
      grid: '#d8dde1', gridStrong: '#aeb7bf', muted: '#53606a', surface: '#ffffff', text: '#16212a',
    }) as Record<string, unknown>
    const seriesColor = (styled: Record<string, unknown>) => (((styled.series as Array<Record<string, unknown>>)[0]?.itemStyle as Record<string, unknown>).color)

    expect(seriesColor(dark)).not.toBe('#071a52')
    expect(seriesColor(light)).not.toBe('#22d3ee')
  })
})
