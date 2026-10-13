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

  it('joins un-located rows (no hole or depth) by row identity instead of dropping them', () => {
    const lab = ['u1', 'u2', 'u3'].map((id, index): EdaObservation => ({
      id, joinKey: `unmatched:${id}`, dimensions: {}, sourceObservationId: id, sampleId: index === 2 ? 'DUP' : id.toUpperCase(),
      holeId: 'Project', depthFrom: Number.NaN, depthTo: Number.NaN, locationValid: false, easting: 0, northing: 0, lithology: 'Unassigned',
      values: { density: Number((2.6 + index * 0.1).toFixed(1)), strength: 80 + index * 40 },
    }))
    const sameTable = pairedDatasetSamples(lab, lab, 'density', 'strength')
    expect(sameTable).toHaveLength(3)
    expect(sameTable.map((pair) => [pair.x, pair.y])).toEqual([[2.6, 80], [2.7, 120], [2.8, 160]])
    expect(sameTable.every((pair) => pair.matchMethod === 'row-identity')).toBe(true)

    // A different table only joins on a sample ID that is unique on its side.
    const other = [...lab, lab[2]!].map((row, index) => ({ ...row, sourceObservationId: `o-${index}`, id: `o-${index}`, values: { ucs: 100 } }))
    const crossTable = pairedDatasetSamples(lab, other, 'density', 'ucs')
    expect(crossTable.map((pair) => pair.joinKey)).toEqual(['U1', 'U2'])
  })

  it('pairs a Schmidt interval with a point-load point in the same mixed-method table, either way round', () => {
    const base = { dimensions: {}, easting: 0, northing: 0, lithology: '', sampleId: '' }
    const schmidt: EdaObservation = { ...base, id: 's', joinKey: 'S', sourceObservationId: 's', holeId: 'TT2026-006GT', depthFrom: 59, depthTo: 60, values: { schmidt: 41, is50: null } }
    const otherSchmidt: EdaObservation = { ...schmidt, id: 's2', sourceObservationId: 's2', depthFrom: 60, depthTo: 61, values: { schmidt: 44, is50: null } }
    const pointLoad: EdaObservation = { ...base, id: 'p', joinKey: 'P', sourceObservationId: 'p', holeId: 'TT_2026_006GT', depthFrom: 59.6, depthTo: 59.6, values: { schmidt: null, is50: 0.17 } }
    const table = [schmidt, otherSchmidt, pointLoad]

    const schmidtFirst = pairedDatasetSamples(table, table, 'schmidt', 'is50')
    expect(schmidtFirst.map((pair) => [pair.x, pair.y])).toEqual([[41, 0.17]])

    const pointFirst = pairedDatasetSamples(table, table, 'is50', 'schmidt')
    expect(pointFirst.map((pair) => [pair.x, pair.y])).toEqual([[0.17, 41]])
    expect(pointFirst[0]?.sourceObservationIds).toEqual(['p', 's'])
  })

  it('never matches a row to a candidate that lacks the wanted value', () => {
    const row = (id: string, values: Record<string, number | null>): EdaObservation => ({ id, joinKey: id, dimensions: {}, sourceObservationId: id, sampleId: id, holeId: 'H', depthFrom: 0, depthTo: 1, easting: 0, northing: 0, lithology: '', values })
    const pairs = pairedDatasetSamples([row('a', { x: 1, y: null }), row('b', { x: null, y: 5 })], [row('a', { x: 1, y: null }), row('b', { x: null, y: 5 })], 'x', 'y')
    expect(pairs.map((pair) => [pair.x, pair.y])).toEqual([[1, 5]])
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
