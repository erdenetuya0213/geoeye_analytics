import { describe, expect, it } from 'vitest'
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
  maximum: 2,
  mean: 1.5,
  median: 1.5,
  minimum: 1,
  missing: 0,
  p95: 1.95,
  q1: 1.25,
  q3: 1.75,
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
      points: [{ id: 'pair', joinKey: 'join', sourceObservationIds: ['obs-1', 'obs-2'], x: 1, y: 2 }],
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
      matchMetadata: { matchedObservationCount: 1, method: 'interval-overlap' },
      points: [{ id: 'pair', joinKey: 'join', sourceObservationIds: ['obs-1', 'obs-2'], x: 1, y: 2 }],
      regression: { intercept: 1, rSquared: 1, slope: 1 },
      sourceObservationIds: ['obs-1', 'obs-2'],
      spearman: 1,
    }
    const fittedLine = chartSeries(buildScatterOption(scatter, { x: 'X', y: 'Y' })).find((series) => series.type === 'line')
    expect(fittedLine?.smooth).toBe(false)
  })
})
