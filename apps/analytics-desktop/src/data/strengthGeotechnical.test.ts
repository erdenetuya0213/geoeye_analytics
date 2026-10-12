import { describe, expect, it } from 'vitest'
import { parseStrengthCsv } from './strengthCsvImport.js'
import { readPointLoadRecords, writePointLoadRecords } from './pointLoadStore.js'
import { strengthDatabaseDraft } from './strengthDatabaseDraft.js'
import { buildLocalTabularRmrSources, isPointLoadColumn, type Rmr76ParameterSourceMapping } from './geotechnicalDatabase.js'
import { buildCompositeRmrDataset } from './geotechnicalComposite.js'

const csv = 'Hole ID,Sample no,Depth (m),Test Type,Failure Type,P (kN),De (mm),Is (MPa),F,Is(50) (MPa)\nDH_01,S1,3,DIAG,PL,0.623,63,0.16,1.11,0.17\nDH_01,S2,6,AXIS,PP,0.632,63,0.16,1.11,0.18'
function imported() {
  const result = parseStrengthCsv(csv, 'lab.csv')
  if (result.kind !== 'point-load') throw new Error('Expected point load')
  return result.records
}

describe('Strength import to geotechnical dataset', () => {
  it('persists laboratory results without recalculating their rounded reported values', () => {
    let stored = ''
    const storage = { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value } }
    const records = imported()
    expect(writePointLoadRecords(storage, records)).toBe(true)
    expect(readPointLoadRecords(storage)).toEqual(records)
  })
  it('makes local strength selectable and matches project holes before publishing', () => {
    const draft = { ...strengthDatabaseDraft(imported(), []), dirty: true, updatedAt: '2026-10-05T00:00:00.000Z' }
    const [source] = buildLocalTabularRmrSources([draft], new Map([['hole-uuid', 'DH01']]))
    expect(source!.sourceKind).toBe('local-csv')
    expect(source!.records.map(record => record.holeId)).toEqual(['hole-uuid', 'hole-uuid'])
    const column = source!.columns.find(column => column.sourceColumn === 'Is50 MPa')!
    expect(isPointLoadColumn(column)).toBe(true)
    expect(source!.columns.find(column => column.sourceColumn === 'Lab: Failure Type')).toBeDefined()
    const mapping: Rmr76ParameterSourceMapping = { 'geotech.ucs': { sourceId: source!.dataset.id, columnKey: column.key, strengthMode: 'point-load', ucsFactor: 20 } }
    const composite = buildCompositeRmrDataset([source!], mapping, 'slope', { intervalLength: 3, startDepth: 0, boundarySourceId: '', population: 'mean' })
    expect(composite.dataset.intervals.map(interval => [interval.depthFrom, interval.depthTo])).toEqual([[3, 6], [6, 9]])
    expect(composite.coverage['geotech.ucs'].covered).toBe(2)
    expect(composite.dataset.intervals[0]!.candidates[0]!.value).toBeCloseTo(3.4)
    expect(composite.dataset.intervals[0]!.candidates[0]!.sourceLabel).toContain('point-load Is(50) · UCS factor 20')
  })
  it('does not join unknown or ambiguous hole identifiers, or invalid tests', () => {
    const records = imported()
    records[1]!.validBreak = false
    const draft = { ...strengthDatabaseDraft(records, []), dirty: true, updatedAt: '2026-10-05T00:00:00.000Z' }
    expect(buildLocalTabularRmrSources([draft], new Map([['id1', 'DH01']]))[0]!.records).toHaveLength(1)
    expect(buildLocalTabularRmrSources([draft], new Map([['id1', 'OTHER']]))[0]!.records).toHaveLength(0)
    expect(buildLocalTabularRmrSources([draft], new Map([['id1', 'DH01'], ['id2', 'DH_01']]))[0]!.records).toHaveLength(0)
  })
})
