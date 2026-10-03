import { describe, expect, it } from 'vitest'
import {
  buildCdf,
  buildHistogram,
  buildProbabilityPlot,
  buildSwath,
  correlationMatrix,
  linearRegression,
  pairedDatasetSamples,
  spearmanCorrelation,
  summarizeValues,
  type EdaObservation,
} from './eda.js'

const observations: EdaObservation[] = [
  { id: 'a', joinKey: 'H1:0:1', dimensions: { drillhole: 'H1' }, sourceObservationId: 'source-a', sampleId: 'A', holeId: 'H1', depthFrom: 0, depthTo: 1, easting: 0, northing: 0, lithology: 'A', values: { x: 1, y: 2 } },
  { id: 'b', joinKey: 'H1:1:2', dimensions: { drillhole: 'H1' }, sourceObservationId: 'source-b', sampleId: 'B', holeId: 'H1', depthFrom: 1, depthTo: 2, easting: 10, northing: 5, lithology: 'A', values: { x: 2, y: 4 } },
  { id: 'c', joinKey: 'H2:2:3', dimensions: { drillhole: 'H2' }, sourceObservationId: 'source-c', sampleId: 'C', holeId: 'H2', depthFrom: 2, depthTo: 3, easting: 20, northing: 10, lithology: 'B', values: { x: 3, y: 6 } },
  { id: 'd', joinKey: 'H2:3:4', dimensions: { drillhole: 'H2' }, sourceObservationId: 'source-d', sampleId: 'D', holeId: 'H2', depthFrom: 3, depthTo: 4, easting: 30, northing: 15, lithology: 'B', values: { x: null, y: 8 } },
]

describe('EDA statistics', () => {
  it('reports sample statistics without converting missing values to zero', () => {
    expect(summarizeValues([1, 2, 3], 4)).toMatchObject({
      count: 3,
      mean: 2,
      median: 2,
      missing: 1,
      standardDeviation: 1,
    })
  })

  it('retains observation lineage in histogram, CDF, and probability points', () => {
    const samples = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }]
    expect(buildHistogram(samples, 2).flatMap((bin) => bin.ids).sort()).toEqual(['a', 'b', 'c'])
    expect(buildCdf(samples).at(-1)).toMatchObject({ id: 'c', probability: 1 })
    expect(buildProbabilityPlot(samples).map((point) => point.expectedQuantile)).toEqual([
      expect.any(Number), expect.any(Number), expect.any(Number),
    ])
  })

  it('calculates the pairwise-complete correlation matrix', () => {
    const matrix = correlationMatrix(observations, ['x', 'y'])
    expect(matrix[0]?.[1]).toBeCloseTo(1)
    expect(matrix[1]?.[0]).toBeCloseTo(1)
  })

  it('calculates Spearman correlation with average ranks for ties', () => {
    expect(spearmanCorrelation([10, 20, 20, 40], [1, 2, 2, 4])).toBeCloseTo(1)
    expect(spearmanCorrelation([1, 2, 3], [9, 4, 1])).toBeCloseTo(-1)
  })

  it('joins variables from separate datasets and keeps lineage from both axes', () => {
    const right = observations.map((observation) => ({
      ...observation,
      sourceObservationId: `right-${observation.sourceObservationId}`,
      values: { z: (observation.values.y ?? 0) * 10 },
    }))
    const pairs = pairedDatasetSamples(observations, right, 'x', 'z')

    expect(pairs).toHaveLength(3)
    expect(pairs[0]).toMatchObject({
      joinKey: 'H1:0:1',
      sourceObservationIds: ['source-a', 'right-source-a'],
      x: 1,
      y: 20,
    })
  })

  it('creates swath bins at the requested analysis axis', () => {
    const swath = buildSwath(observations, 'x', 'easting', 2)
    expect(swath).toHaveLength(2)
    expect(swath.reduce((sum, bin) => sum + bin.count, 0)).toBe(3)
    expect(swath.flatMap((bin) => bin.ids).sort()).toEqual(['source-a', 'source-b', 'source-c'])
  })

  it('fits a deterministic least-squares line', () => {
    expect(linearRegression([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }])).toMatchObject({
      intercept: 0,
      rSquared: 1,
      slope: 2,
    })
  })
})
