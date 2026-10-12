import { describe, expect, it } from 'vitest'
import { computeCorrelationMatrix, prepareCorrelationMatrix } from './correlationWorker.js'
import { analyzeCorrelationMatrix } from './chartResults.js'
import type { EdaObservation } from './eda.js'
const samples = [1, 2, 3, 4].map((value): EdaObservation => ({ depthFrom: value, depthTo: value + 1, dimensions: { zone: value === 4 ? 'B' : 'A' }, easting: value, northing: value, holeId: 'H', id: String(value), joinKey: String(value), lithology: 'Test', sampleId: String(value), sourceObservationId: String(value), values: { a: value, b: value * value } }))
const variables = ['a', 'b'].map(key => ({ id: key, label: key, observations: samples, variableKey: key }))
describe('background correlation preparation', () => {
  it.each(['pearson', 'spearman'] as const)('preserves %s results and selected population lineage', method => {
    const result = computeCorrelationMatrix({ variables, method, activeFilterKeys: ['zone'], filterValues: { zone: 'A' } })
    const expected = analyzeCorrelationMatrix(variables.map(variable => ({ ...variable, observations: samples.slice(0, 3) })), method)
    expect(result).toEqual(expected)
    expect(result.cells.every(cell => cell.count === 3)).toBe(true)
  })
  it('cancels superseded calculations', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(prepareCorrelationMatrix({ variables, method: 'pearson', activeFilterKeys: [], filterValues: {} }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
