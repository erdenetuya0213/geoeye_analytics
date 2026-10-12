import { describe, expect, it } from 'vitest'
import { buildCompositeRmrDataset, type CompositeRules } from './geotechnicalComposite.js'
import type { DatabaseRmrSource, Rmr76ParameterSourceMapping } from './geotechnicalDatabase.js'
import { calculateRmr76Intervals, RMR76_METHOD_DEFINITION } from '../analysis/geotechnicalWorkflow.js'
const rules: CompositeRules = { intervalLength: 3, startDepth: 0, boundarySourceId: '', population: 'mean' }
const keys = RMR76_METHOD_DEFINITION.requiredInputs.map(input => input.key)
const mapping = Object.fromEntries(keys.map(key => [key, { sourceId: key, columnKey: 'value' }])) as Rmr76ParameterSourceMapping
function source(id: string, values: Array<[number, number, unknown]>): DatabaseRmrSource {
  return { columns: [{ key: 'value', displayName: 'Value', sourceColumn: null, dataType: 'numeric', canonicalUnit: null }],
    coveredHoleCount: 1, dataset: { id, name: id, currentVersion: 1, updatedAt: '2026-10-05T00:00:00.000Z' },
    holeNames: new Map([['hole', 'DH-1']]), parentTemplateId: null, sourceKind: 'database', recordCount: values.length,
    records: values.map(([depthFrom, depthTo, value], index) => ({ id: `${id}:${index}`, holeId: 'hole', depthFrom, depthTo, values: { value }, observationIds: { value: `${id}:${index}` } })) }
}
function sources() { return [source(keys[0]!, [[0, 2, 60], [2, 6, 90]]), source(keys[1]!, [[0, 6, 90]]),
  source(keys[2]!, [[0, 6, 0.5]]), source(keys[3]!, [[0, 3, 15]]), source(keys[4]!, [[0, 6, 'Moist']]),
  source(keys[5]!, [[0, 0, -5], [3, 3, -10]])] }
describe('RMR composites and per-parameter estimates', () => {
  it('uses only the selected boundary field, merges row fragments and restarts the grid', () => {
    const boundary = source('boundaries', [[0, 1, 'A'], [1, 2, 'A'], [2, 6, 'B']])
    const result = buildCompositeRmrDataset([...sources(), boundary], mapping, 'slope', { ...rules, boundarySourceId: 'boundaries', boundaryFieldKey: 'value' })
    expect(result.dataset.intervals.map(row => [row.depthFrom, row.depthTo])).toEqual([[0, 2], [2, 5], [5, 6]])
  })
  it('does not silently calculate across a missing selected boundary field', () => {
    const result = buildCompositeRmrDataset(sources(), mapping, 'slope', { ...rules, boundarySourceId: keys[0]!, boundaryFieldKey: 'absent' })
    expect(result.dataset.intervals).toHaveLength(0)
    expect(() => buildCompositeRmrDataset(sources(), mapping, 'slope', { ...rules, boundarySourceId: keys[0]!, boundaryFieldKey: '' })).toThrow('Choose the field')
  })
  it('splits at secondary field changes without importing values from that template', () => {
    const data = [...sources(), source('primary', [[0, 6, 'A']]), source('secondary', [[0, 1, 'X'], [1, 6, 'Y']])]
    const result = buildCompositeRmrDataset(data, mapping, 'slope', { ...rules, boundarySourceId: 'primary', boundaryFieldKey: 'value', secondaryBoundarySourceId: 'secondary', secondaryBoundaryFieldKey: 'value' })
    expect(result.dataset.intervals.map(row => [row.depthFrom, row.depthTo])).toEqual([[0, 1], [1, 4], [4, 6]])
  })
  it('aligns different source depths with weighted means and retains missing intervals', () => {
    const result = buildCompositeRmrDataset(sources(), mapping, 'slope', rules)
    expect(result.dataset.intervals.map(interval => [interval.depthFrom, interval.depthTo])).toEqual([[0, 3], [3, 6]])
    expect(result.dataset.intervals[0]!.candidates.find(input => input.canonicalKey === keys[0])?.value).toBe(70)
    expect(result.coverage[keys[3]!]).toMatchObject({ covered: 1, missing: 1, estimated: 0, mean: 15 })
    expect(result.diagnostics.matchedIntervalCount).toBe(1)
    const run = calculateRmr76Intervals(result.dataset.intervals, new Set(keys), 'run', '2026-10-05T00:00:00.000Z', result.dataset.snapshotId)
    expect(run.summary).toMatchObject({ valid: 1, missing: 1 })
  })
  it('splits composites at selected boundaries and assigns points to one interval', () => {
    const data = [...sources(), source('boundaries', [[0, 1, 'A'], [1, 6, 'B']])]
    const result = buildCompositeRmrDataset(data, mapping, 'slope', { ...rules, boundarySourceId: 'boundaries', boundaryFieldKey: 'value' })
    expect(result.dataset.intervals.map(interval => [interval.depthFrom, interval.depthTo])).toEqual([[0, 1], [1, 4], [4, 6]])
    expect(result.dataset.intervals.filter(interval => interval.candidates.some(input => input.canonicalKey === keys[5]))).toHaveLength(2)
  })
  it('fills only opted-in parameters and records estimates in calculation lineage', () => {
    const result = buildCompositeRmrDataset(sources(), mapping, 'slope', rules, { [keys[3]!]: true })
    expect(result.coverage[keys[3]!]).toMatchObject({ missing: 1, estimated: 1, mean: 15 })
    expect(result.diagnostics.matchedIntervalCount).toBe(2)
    expect(result.dataset.intervals[1]!.candidates.find(input => input.canonicalKey === keys[3])).toMatchObject({ value: 15, availability: 'fallback' })
    expect(result.dataset.intervals[0]!.candidates.find(input => input.canonicalKey === keys[3])).toMatchObject({ value: 15, availability: 'derived' })
  })
  it('does not invent means or replace invalid values', () => {
    const data = sources(); data[3] = source(keys[3]!, [[0, 3, 15], [3, 6, 99]])
    const invalid = buildCompositeRmrDataset(data, mapping, 'slope', rules, { [keys[3]!]: true })
    expect(invalid.coverage[keys[3]!].estimated).toBe(0)
    data[3] = source(keys[3]!, [])
    const empty = buildCompositeRmrDataset(data, mapping, 'slope', rules, { [keys[3]!]: true })
    expect(empty.coverage[keys[3]!]).toMatchObject({ mean: null, estimated: 0 })
  })
  it('keeps composite intervals and donor means inside the selected depth scope', () => {
    const data = sources().map(item => ({ ...item, records: item.records.map(record => ({ ...record, depthFrom: 0, depthTo: 90 })) }))
    const result = buildCompositeRmrDataset(data, mapping, 'slope', rules, {}, record => record.depthFrom! < 60)
    expect(result.dataset.intervals).toHaveLength(20)
    expect(result.dataset.intervals.every(interval => interval.depthTo <= 60)).toBe(true)
    expect(result.coverage[keys[0]!].samples).toBe(20)
  })
})


describe('sparse numeric strength sheets', () => {
  it('reads numeric text on separate rows without turning blanks into zero', () => {
    const data = sources()
    data[0] = source(keys[0]!, [[0, 3, '40'], [0, 3, ''], [3, 6, '  ']])
    const result = buildCompositeRmrDataset(data, mapping, 'slope', rules)
    expect(result.dataset.intervals[0]!.candidates.find(input => input.canonicalKey === keys[0])?.value).toBe(40)
    expect(result.coverage[keys[0]!]).toMatchObject({ covered: 1, missing: 1 })
  })
  it('requires an explicit factor for a point-load proxy and retains its lineage', () => {
    const proxy = { ...mapping, 'geotech.ucs': { ...mapping['geotech.ucs']!, strengthMode: 'point-load' as const } }
    const missing = buildCompositeRmrDataset(sources(), proxy, 'slope', rules)
    expect(missing.coverage['geotech.ucs'].covered).toBe(0)
    const result = buildCompositeRmrDataset(sources(), { ...proxy, 'geotech.ucs': { ...proxy['geotech.ucs'], ucsFactor: 2 } }, 'slope', rules)
    expect(result.dataset.intervals[0]!.candidates.find(input => input.canonicalKey === 'geotech.ucs')).toMatchObject({ value: 140, sourceLabel: expect.stringContaining('point-load Is(50) · UCS factor 2') })
    expect(result.dataset.snapshotId).not.toBe(missing.dataset.snapshotId)
  })
  it('does not use unconfirmed readings or invalid numeric text as UCS', () => {
    const data = sources()
    data[0] = source(keys[0]!, [[0, 3, 'R3'], [3, 6, '40 MPa']])
    expect(buildCompositeRmrDataset(data, mapping, 'slope', rules).coverage['geotech.ucs'].covered).toBe(0)
    expect(buildCompositeRmrDataset(sources(), { ...mapping, 'geotech.ucs': { ...mapping['geotech.ucs']!, strengthMode: 'unconfirmed' } }, 'slope', rules).coverage['geotech.ucs'].covered).toBe(0)
  })
})

it('uses original Field composites and never fills or averages an omitted zone', () => {
  const data = sources()
  data[1]!.composite = { intervalLength: 3, startDepth: 0, boundaryRules: ['geotech::weathering'], intervals: [
    { holeId: 'hole', depthFrom: 0, depthTo: 2, exclusionReason: 'Field omission rule' },
    { holeId: 'hole', depthFrom: 2, depthTo: 5 }, { holeId: 'hole', depthFrom: 5, depthTo: 6 },
  ] }
  const result = buildCompositeRmrDataset(data, mapping, 'slope', { ...rules, boundarySourceId: `field:${keys[1]}` }, { [keys[3]!]: true })
  expect(result.dataset.intervals.map(row => [row.depthFrom, row.depthTo])).toEqual([[0, 2], [2, 5], [5, 6]])
  expect(result.coverage[keys[3]!]).toMatchObject({ covered: 1, missing: 1, estimated: 1, samples: 1 })
  expect(result.dataset.intervals[0]?.exclusionReason).toBe('Field omission rule')
})
it('uses a logged strength grade without inventing a UCS measurement', () => {
  const data = sources(); data[0] = source(keys[0]!, [[0, 6, 'R3 · Medium strong rock']])
  const gradeMapping = { ...mapping, 'geotech.ucs': { ...mapping['geotech.ucs']!, strengthMode: 'field-grade' as const } }
  const result = buildCompositeRmrDataset(data, gradeMapping, 'slope', rules, { 'geotech.joint_condition': true })
  const run = calculateRmr76Intervals(result.dataset.intervals, new Set(keys), 'run', '2026-10-05T00:00:00.000Z', result.dataset.snapshotId)
  expect(run.summary.valid).toBe(2)
  expect(run.intervals[0]?.calculation?.scores.strength).toBe(4)
  expect(run.intervals[0]?.inputValues.ucsMpa).toBeNull()
})

it('uses the logged grade fallback only where the chosen laboratory input cannot resolve', () => {
  const data = sources(); data[0] = source(keys[0]!, [[0, 3, 0.2]])
  data.push(source('grades', [[0, 6, 'R4']]))
  const fallbackMapping = { ...mapping, 'geotech.ucs': { sourceId: keys[0]!, columnKey: 'value', strengthMode: 'point-load' as const, fallback: { sourceId: 'grades', columnKey: 'value', strengthMode: 'field-grade' as const } } }
  const result = buildCompositeRmrDataset(data, fallbackMapping, 'slope', rules, { 'geotech.joint_condition': true })
  expect(result.coverage['geotech.ucs'].covered).toBe(2)
  expect(result.dataset.sources.map(source => source.id)).toContain('grades')
  expect(result.dataset.intervals[0]?.candidates.find(input => input.canonicalKey === 'geotech.ucs')).toMatchObject({ sourceTemplateId: 'grades', value: { strengthRating: 7 } })
  const calibrated = buildCompositeRmrDataset(data, { ...fallbackMapping, 'geotech.ucs': { ...fallbackMapping['geotech.ucs'], ucsFactor: 25 } }, 'slope', rules)
  expect(calibrated.dataset.intervals[0]?.candidates.find(input => input.canonicalKey === 'geotech.ucs')).toMatchObject({ sourceTemplateId: keys[0], value: 5 })
})
