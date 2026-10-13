import { describe, expect, it } from 'vitest'
import { chartSettingsFor } from './chartSettings.js'
import type {
  BoxPlotAnalysisResult,
  CorrelationAnalysisResult,
  DownholeTrackResult,
  HeatmapAnalysisResult,
  ScatterAnalysisResult,
  SwathAnalysisResult,
  VariogramAnalysisResult,
} from '../analysis/chartResults.js'
import type { DistributionResult } from '../analysis/distributionEngine.js'
import {
  buildBoxPlotOption,
  buildCdfOption,
  buildCorrelationOption,
  buildDownholeTrackOption,
  buildDistributionBoxPlotOption,
  buildHeatmapOption,
  buildHistogramOption,
  buildProbabilityPlotOption,
  buildScatterOption,
  buildSwathOption,
  buildVariogramOption,
} from './chartOptions.js'
import { fitFacetOption } from '../components/GeoEyeFacetChart.js'
import { GEOEYE_LINE_SMOOTHING } from './geoEyeTheme.js'

const summary = {
  coefficientOfVariation: 0.25,
  count: 2,
  effectiveCount: 2,
  geometricMean: 1.41,
  kurtosis: null,
  logMean: 0.35,
  logVariance: 0.06,
  maximum: 2,
  mean: 1.5,
  median: 1.5,
  minimum: 1,
  missing: 0,
  p95: 1.95,
  q1: 1.25,
  q3: 1.75,
  skewness: 0,
  standardDeviation: 0.71,
  variance: 0.5,
  weightSum: 2,
}

const distribution: DistributionResult = {
  diagnostics: {
    normalProbabilityRSquared: 0.99,
    normalProbabilityRSquaredRole: 'secondary diagnostic; not probability or confidence',
    weightedPlottingPosition: 'centered-cumulative-weight',
    weightedVarianceEstimator: 'frequency-unbiased',
  },
  histogram: [{ from: 1, midpoint: 1.5, rawCount: 2, representativeCount: 1.8, sourceObservationIds: ['obs-1', 'obs-2'], to: 2 }],
  provenance: {
    algorithmVersion: 'test',
    bootstrapMethod: 'hole',
    datasetId: 'dataset',
    filterSignature: 'none',
    snapshotAt: '2026-01-01T00:00:00.000Z',
    supportLabel: 'interval',
    variableKey: 'au',
    weightingMethod: 'cell-declustering',
  },
  representative: {
    ecdf: [{ probability: 1, sourceObservationId: 'obs-1', value: 1, weight: 0.8 }],
    probabilityPlot: [{ expectedQuantile: 0, probability: 0.5, sourceObservationId: 'obs-1', value: 1, weight: 0.8 }],
    summary,
  },
  sample: {
    ecdf: [{ probability: 1, sourceObservationId: 'obs-2', value: 2, weight: 1 }],
    probabilityPlot: [{ expectedQuantile: 0, probability: 0.5, sourceObservationId: 'obs-2', value: 2, weight: 1 }],
    summary,
  },
  uncertainty: {
    band: [{ lower: 0.1, upper: 0.9, value: 1.5 }],
    intervals: {
      mean: { estimate: 1.5, lower: 1, upper: 2 },
      median: { estimate: 1.5, lower: 1, upper: 2 },
      p95: { estimate: 1.95, lower: 1.5, upper: 2 },
    },
    iterations: 10,
    method: 'hole',
    resamplingUnits: 2,
    seed: 1,
  },
}

const distributionConfig = { decimals: 2, showDeclustered: true, unit: 'g/t', variableLabel: 'Gold', x: '', y: '' }

function seriesData(option: unknown) {
  if (typeof option !== 'object' || option === null || !('series' in option) || !Array.isArray(option.series)) return []
  return option.series.flatMap((series) => {
    if (typeof series !== 'object' || series === null || !('data' in series) || !Array.isArray(series.data)) return []
    return series.data
  })
}

function chartSeries(option: unknown): Array<Record<string, unknown>> {
  if (typeof option !== 'object' || option === null || !('series' in option) || !Array.isArray(option.series)) return []
  return option.series.filter((series): series is Record<string, unknown> => typeof series === 'object' && series !== null)
}

function expectSourceIds(option: unknown) {
  const data = seriesData(option)
  expect(data.length).toBeGreaterThan(0)
  data.forEach((item) => {
    expect(item).toEqual(expect.objectContaining({ sourceObservationIds: expect.any(Array) }))
    expect((item as { sourceObservationIds: string[] }).sourceObservationIds.length).toBeGreaterThan(0)
  })
}

describe('GeoEye analytical chart options', () => {
  it('reserves complete axis-title space in compact facet charts', () => {
    const option = fitFacetOption(buildHistogramOption(distribution, distributionConfig)) as Record<string, unknown>
    const grid = option.grid as Record<string, unknown>
    const xAxis = option.xAxis as Record<string, unknown>
    const yAxis = option.yAxis as Record<string, unknown>

    expect(grid).toEqual(expect.objectContaining({
      bottom: 12,
      containLabel: false,
      left: 12,
      outerBoundsContain: 'all',
      outerBoundsMode: 'same',
      right: 12,
    }))
    expect(xAxis.nameGap).toBe(30)
    expect(yAxis.nameGap).toBe(34)
  })

  it('keeps raw and declustered distribution overlays source-linked', () => {
    const histogram = buildHistogramOption(distribution, distributionConfig)
    expect((histogram as { series: unknown[] }).series).toHaveLength(2)
    ;[
      histogram,
      buildDistributionBoxPlotOption(distribution, distributionConfig),
      buildCdfOption(distribution, distributionConfig),
      buildProbabilityPlotOption(distribution, distributionConfig),
    ].forEach(expectSourceIds)
  })

  it('removes visible chart toolboxes while retaining drag brushing', () => {
    const swath: SwathAnalysisResult = {
      axis: 'easting',
      bins: [{ count: 1, from: 0, ids: ['obs-1'], mean: 1, median: 1, midpoint: 5, to: 10 }],
      kind: 'swath',
      sourceObservationIds: ['obs-1'],
      variableKey: 'au',
    }
    const option = buildSwathOption(swath, { x: 'Easting', y: 'Au' }) as Record<string, unknown>
    expect(option.toolbox).toBeUndefined()
    expect(option.brush).toEqual(expect.objectContaining({ brushMode: 'single' }))
  })

  it('carries source IDs through scatter, correlation, and swath marks', () => {
    const scatter: ScatterAnalysisResult = {
      correlation: 0.8,
      kind: 'scatter',
      matchMetadata: { matchedObservationCount: 1, method: 'interval-overlap' },
      points: [{ dimensions: { lithology: 'A' }, holeId: 'H1', id: 'pair', joinKey: 'join', sourceObservationIds: ['obs-1', 'obs-2'], x: 1, y: 2 }],
      regression: { intercept: 1, rSquared: 1, slope: 1 },
      sourceObservationIds: ['obs-1', 'obs-2'],
      spearman: 0.8,
    }
    const correlation: CorrelationAnalysisResult = {
      cells: [{ column: 0, count: 1, row: 0, sourceObservationIds: ['obs-1'], value: 1 }],
      kind: 'correlation',
      labels: ['Au'],
      method: 'pearson',
    }
    const swath: SwathAnalysisResult = {
      axis: 'easting',
      bins: [{ count: 1, from: 0, ids: ['obs-1'], mean: 1, median: 1, midpoint: 5, to: 10 }],
      kind: 'swath',
      sourceObservationIds: ['obs-1'],
      variableKey: 'au',
    }
    expectSourceIds(buildScatterOption(scatter, { x: 'X', y: 'Y' }))
    expectSourceIds(buildCorrelationOption(correlation))
    expectSourceIds(buildSwathOption(swath, { x: 'Easting', y: 'Au' }))
  })

  it('supports source-linked box, heatmap, variogram, and downhole results', () => {
    const box: BoxPlotAnalysisResult = {
      groups: [{ category: 'A', high: 5, low: 1, median: 3, q1: 2, q3: 4, sourceObservationIds: ['obs-1'] }],
      kind: 'box-plot',
    }
    const heatmap: HeatmapAnalysisResult = {
      cells: [{ column: 0, row: 0, sourceObservationIds: ['obs-1'], value: 4 }],
      columns: ['A'],
      kind: 'heatmap',
      rows: ['B'],
    }
    const variogram: VariogramAnalysisResult = {
      experimental: [{ lag: 10, semivariance: 0.4, sourceObservationIds: ['obs-1'] }],
      kind: 'variogram',
      model: [{ lag: 10, semivariance: 0.35, sourceObservationIds: ['obs-1'] }],
    }
    const downhole: DownholeTrackResult = {
      holeId: 'DD-01',
      kind: 'downhole-track',
      tracks: [{ name: 'Au', points: [{ depth: 10, sourceObservationIds: ['obs-1'], value: 1.2 }] }],
    }
    expectSourceIds(buildBoxPlotOption(box, { x: 'Group', y: 'Value' }))
    expectSourceIds(buildHeatmapOption(heatmap, { x: 'Column', y: 'Row' }))
    expectSourceIds(buildVariogramOption(variogram, { x: 'Lag', y: 'Semivariance' }))
    expectSourceIds(buildDownholeTrackOption(downhole, 'Au'))
  })

  it('smooths analytical data lines while preserving straight fitted references', () => {
    const cdfLines = chartSeries(buildCdfOption(distribution, distributionConfig))
    expect(cdfLines.every((series) => series.smooth === GEOEYE_LINE_SMOOTHING)).toBe(true)
    expect(cdfLines.every((series) => series.smoothMonotone === 'y')).toBe(true)

    const swath: SwathAnalysisResult = {
      axis: 'easting',
      bins: [{ count: 1, from: 0, ids: ['obs-1'], mean: 1, median: 1, midpoint: 5, to: 10 }],
      kind: 'swath',
      sourceObservationIds: ['obs-1'],
      variableKey: 'au',
    }
    expect(chartSeries(buildSwathOption(swath, { x: 'Easting', y: 'Au' })).every((series) => series.smooth === GEOEYE_LINE_SMOOTHING)).toBe(true)

    const scatter: ScatterAnalysisResult = {
      correlation: 1,
      kind: 'scatter',
      matchMetadata: { matchedObservationCount: 2, method: 'interval-overlap' },
      points: [
        { dimensions: { lithology: 'A' }, holeId: 'H1', id: 'pair', joinKey: 'join', sourceObservationIds: ['obs-1', 'obs-2'], x: 1, y: 2 },
        { dimensions: { lithology: 'A' }, holeId: 'H1', id: 'pair-2', joinKey: 'join-2', sourceObservationIds: ['obs-3'], x: 2, y: 3 },
      ],
      regression: { intercept: 1, rSquared: 1, slope: 1 },
      sourceObservationIds: ['obs-1', 'obs-2', 'obs-3'],
      spearman: 1,
    }
    const fittedLine = chartSeries(buildScatterOption(scatter, { x: 'X', y: 'Y' })).find((series) => series.type === 'line')
    expect(fittedLine?.smooth).toBe(false)
  })
})

const scatterFixture: ScatterAnalysisResult = {
  correlation: 0.82,
  kind: 'scatter',
  matchMetadata: { matchedObservationCount: 4, method: 'interval-overlap' },
  points: [
    { dimensions: {}, holeId: 'H1', id: 'a', joinKey: 'a', sourceObservationIds: ['o1'], x: 1, y: 2 },
    { dimensions: {}, holeId: 'H1', id: 'b', joinKey: 'b', sourceObservationIds: ['o2'], x: 2, y: 3 },
    { dimensions: {}, holeId: 'H1', id: 'c', joinKey: 'c', sourceObservationIds: ['o3'], x: 3, y: 5 },
    { dimensions: {}, holeId: 'H1', id: 'd', joinKey: 'd', sourceObservationIds: ['o4'], x: 4, y: 4 },
  ],
  regression: { intercept: 1, rSquared: 0.7, slope: 0.8 },
  sourceObservationIds: ['o1', 'o2', 'o3', 'o4'],
  spearman: 0.8,
}

describe('readability fixes', () => {
  const settings = chartSettingsFor('cdf')

  it('rounds the CDF tooltip to the variable decimals', () => {
    const option = buildCdfOption(distribution, distributionConfig, settings) as { tooltip: { formatter: (params: unknown) => string } }
    const text = option.tooltip.formatter({ data: { value: [1.2345678901, 0.227855833842] }, seriesName: 'Raw' })
    expect(text).toContain('1.23')
    expect(text).toContain('22.8% cumulative')
    expect(text).not.toContain('0.227855')
  })

  it('reports the CDF at the requested number of bins', () => {
    const binned = buildCdfOption(distribution, distributionConfig, { ...settings, binCount: 2 }) as { series: Array<{ data: unknown[] }> }
    expect(binned.series[0]?.data.length).toBeLessThanOrEqual(2)
  })

  it('puts the scatter stats box in a corner away from the points', () => {
    // Points climb to the top right, so the box belongs top left.
    const climbing: ScatterAnalysisResult = {
      correlation: 1,
      kind: 'scatter',
      matchMetadata: { matchedObservationCount: 3, method: 'interval-overlap' },
      points: Array.from({ length: 12 }, (_, index) => ({ dimensions: {}, holeId: 'H1', id: `p${index}`, joinKey: `j${index}`, sourceObservationIds: [`o${index}`], x: index, y: index })),
      regression: { intercept: 0, rSquared: 1, slope: 1 },
      sourceObservationIds: ['o1'],
      spearman: 1,
    }
    const option = buildScatterOption(climbing, { x: 'X', y: 'Y' }, { ...chartSettingsFor('scatter'), statsBox: true }) as { graphic: { elements: Array<Record<string, unknown>> } }
    const box = option.graphic.elements[0]
    expect(box?.left).toBe(58)
    expect(box?.top).toBe(34)
  })

  it('fills the scatter stats box with relationship diagnostics, not blanks', () => {
    const option = buildScatterOption(scatterFixture, { x: 'X', y: 'Y' }, { ...chartSettingsFor('scatter'), statsBox: true }) as { graphic: { elements: Array<{ children: Array<{ style: { text?: string } }> }> } }
    const labels = option.graphic.elements[0]?.children.flatMap((child) => child.style.text === undefined ? [] : [child.style.text]) ?? []
    expect(labels.join(' ')).toContain('Pearson r')
    expect(labels.join(' ')).not.toContain('—')
  })
})
