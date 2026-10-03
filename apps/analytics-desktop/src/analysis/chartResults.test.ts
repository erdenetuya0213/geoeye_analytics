import { describe, expect, it } from 'vitest'
import { analyzeCorrelationMatrix, analyzeQq, analyzeRelationship } from './chartResults.js'
import type { EdaObservation } from './eda.js'

function observation(id: string, value: number): EdaObservation {
  return {
    depthFrom: value,
    depthTo: value + 1,
    dimensions: {},
    easting: value,
    holeId: 'DD-01',
    id,
    joinKey: id,
    lithology: 'Test',
    northing: value,
    sampleId: id,
    sourceObservationId: `source-${id}`,
    values: { value },
  }
}

describe('Q-Q analysis', () => {
  it('pairs ordered empirical quantiles and retains source lineage', () => {
    const result = analyzeQq(
      [observation('left-3', 30), observation('left-1', 10), observation('left-2', 20)],
      [observation('right-3', 6), observation('right-1', 2), observation('right-2', 4)],
      'value',
      'value',
    )

    expect(result.kind).toBe('qq-plot')
    expect(result.points.map(({ x, y }) => [x, y])).toEqual([[10, 2], [20, 4], [30, 6]])
    expect(result.regression).toMatchObject({ slope: 0.2, rSquared: 1 })
    expect(result.sourceObservationIds).toHaveLength(6)
  })

  it('uses the smaller population size', () => {
    const result = analyzeQq(
      [observation('left-1', 1), observation('left-2', 2), observation('left-3', 3)],
      [observation('right-1', 10), observation('right-2', 20)],
      'value',
      'value',
    )
    expect(result.points).toHaveLength(2)
  })
})

describe('relationship analysis', () => {
  it('reports Pearson, Spearman, regression, and support matching metadata', () => {
    const left = [observation('one', 1), observation('two', 2), observation('three', 3)]
    const rightValues = [10, 20, 40]
    const right = left.map((sample, index) => ({ ...sample, sourceObservationId: `right-${sample.sourceObservationId}`, values: { value: rightValues[index]! } }))
    const result = analyzeRelationship(left, right, 'value', 'value')

    expect(result.matchMetadata).toEqual({ matchedObservationCount: 3, method: 'interval-overlap' })
    expect(result.correlation).toBeCloseTo(0.982)
    expect(result.spearman).toBeCloseTo(1)
    expect(result.regression?.rSquared).toBeCloseTo(result.correlation! ** 2)
  })

  it('builds pairwise matrices with matched n and the requested coefficient', () => {
    const samples = [observation('one', 1), observation('two', 2), observation('three', 3)]
    const matrix = analyzeCorrelationMatrix([
      { id: 'a', label: 'A', observations: samples, variableKey: 'value' },
      { id: 'b', label: 'B', observations: samples, variableKey: 'value' },
    ], 'spearman')

    expect(matrix.method).toBe('spearman')
    expect(matrix.cells).toHaveLength(4)
    expect(matrix.cells.every((cell) => cell.count === 3)).toBe(true)
    matrix.cells.forEach((cell) => expect(cell.value).toBeCloseTo(1))
  })
})
