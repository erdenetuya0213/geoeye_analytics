import { describe, expect, it } from 'vitest'
import { emptyClassTable, mergeClassImport, parseClassRows } from './classTables.js'
import { csvRows } from './tabularCsvImport.js'
import { classDatabaseDraft } from './classDatabaseDraft.js'
import { buildLocalTabularRmrSources, isPointLoadColumn, isSchmidtColumn, type Rmr76ParameterSourceMapping } from './geotechnicalDatabase.js'
import { pointLoadToUcsMpa, schmidtToUcsMpa } from '../analysis/schmidt.js'
import { buildCompositeRmrDataset } from './geotechnicalComposite.js'

const csv = 'Hole ID,Sample no,From,To,Test Type,Failure Type,P (kN),De (mm),Is (MPa),F,Is(50) (MPa),Valid\nDH_01,S1,3,3,DIAG,PL,0.623,63,0.16,1.11,0.17,true\nDH_01,S2,6,6,AXIS,PP,0.632,63,0.16,1.11,0.18,'
function imported(name: string, text: string) {
  return mergeClassImport(emptyClassTable(name, name), parseClassRows(csvRows(text))).table
}

describe('Strength import to geotechnical dataset', () => {
  it('makes local strength selectable and matches project holes before publishing', () => {
    const draft = { ...classDatabaseDraft('strength', [imported('My point load', csv)]), dirty: true, updatedAt: '2026-10-05T00:00:00.000Z' }
    const [source] = buildLocalTabularRmrSources([draft], new Map([['hole-uuid', 'DH01']]))
    expect(source!.sourceKind).toBe('local-csv')
    expect(source!.records.map(record => record.holeId)).toEqual(['hole-uuid', 'hole-uuid'])
    const column = source!.columns.find(column => column.sourceColumn === 'Is(50) (MPa)')!
    expect(isPointLoadColumn(column)).toBe(true)
    expect(source!.columns.find(column => column.sourceColumn === 'Failure Type')).toBeDefined()
    const mapping: Rmr76ParameterSourceMapping = { 'geotech.ucs': { sourceId: source!.dataset.id, columnKey: column.key, strengthMode: 'point-load', ucsFactor: 20 } }
    const composite = buildCompositeRmrDataset([source!], mapping, 'slope', { intervalLength: 3, startDepth: 0, boundarySourceId: '', population: 'mean' })
    expect(composite.dataset.intervals.map(interval => [interval.depthFrom, interval.depthTo])).toEqual([[3, 6], [6, 9]])
    expect(composite.coverage['geotech.ucs'].covered).toBe(2)
    expect(composite.dataset.intervals[0]!.candidates[0]!.value).toBeCloseTo(3.4)
    expect(composite.dataset.intervals[0]!.candidates[0]!.sourceLabel).toContain('point-load Is(50) · UCS factor 20')
  })
  it('puts every test in one table, sharing the columns that have the same name', () => {
    const draft = classDatabaseDraft('strength', [imported('A', 'Hole,Sample,From,To,UCS MPa,Notes\nDH1,S1,0,1,55,ok'), imported('B', 'Hole,Sample,From,To,notes,Smidth\nDH1,S2,1,2,dry,40')])
    expect(draft.columns).toEqual(['Strength test', 'Hole ID', 'Sample ID', 'From', 'To', 'UCS MPa', 'notes', 'Smidth'])
    expect(draft.rows).toEqual([['A', 'DH1', 'S1', '0', '1', '55', 'ok', ''], ['B', 'DH1', 'S2', '1', '2', '', 'dry', '40']])
  })
  it('does not join unknown or ambiguous hole identifiers, or invalid tests', () => {
    const draft = { ...classDatabaseDraft('strength', [imported('My point load', csv.replace(/,$/, ',false'))]), dirty: true, updatedAt: '2026-10-05T00:00:00.000Z' }
    expect(buildLocalTabularRmrSources([draft], new Map([['id1', 'DH01']]))[0]!.records).toHaveLength(1)
    expect(buildLocalTabularRmrSources([draft], new Map([['id1', 'OTHER']]))[0]!.records).toHaveLength(0)
    expect(buildLocalTabularRmrSources([draft], new Map([['id1', 'DH01'], ['id2', 'DH_01']]))[0]!.records).toHaveLength(0)
  })
})

describe('Schmidt rebound as the RMR76 strength input', () => {
  const schmidtCsv = 'Borehole,Sample,From,To,Smidth\nDH_01,S1,0,3,40\nDH_01,S2,3,6,3\nDH_01,S3,6,9,52'
  function schmidtSource() {
    const draft = { ...classDatabaseDraft('strength', [imported('Hammer', schmidtCsv)]), dirty: true, updatedAt: '2026-10-12T00:00:00.000Z' }
    const [source] = buildLocalTabularRmrSources([draft], new Map([['hole-uuid', 'DH01']]))
    return source!
  }
  const rules = { intervalLength: 3, startDepth: 0, boundarySourceId: '', population: 'mean' as const }

  it('recognises the Schmidt column and converts R to UCS with the chosen unit weight', () => {
    const source = schmidtSource()
    const column = source.columns.find(item => item.sourceColumn === 'Smidth')!
    expect(isSchmidtColumn(column)).toBe(true)
    const mapping: Rmr76ParameterSourceMapping = { 'geotech.ucs': { sourceId: source.dataset.id, columnKey: column.key, strengthMode: 'schmidt', unitWeightKnM3: 27 } }
    const composite = buildCompositeRmrDataset([source], mapping, 'slope', rules)
    const values = composite.dataset.intervals.map(interval => interval.candidates[0]?.value ?? null)
    expect(values[0]).toBeCloseTo(91.3, 0)
    expect(values[1]).toBeNull()
    expect(values[2]).toBeCloseTo(10 ** (0.00088 * 27 * 52 + 1.01), 3)
    expect(composite.dataset.intervals[0]!.candidates[0]!.sourceLabel).toContain('Schmidt rebound → UCS')
  })

  it('returns no UCS until a unit weight is set', () => {
    const source = schmidtSource()
    const column = source.columns.find(item => item.sourceColumn === 'Smidth')!
    const mapping: Rmr76ParameterSourceMapping = { 'geotech.ucs': { sourceId: source.dataset.id, columnKey: column.key, strengthMode: 'schmidt' } }
    expect(buildCompositeRmrDataset([source], mapping, 'slope', rules).coverage['geotech.ucs'].covered).toBe(0)
  })

  it('keeps the correlation inside its valid rebound range', () => {
    expect(schmidtToUcsMpa(9, 27)).toBeNull()
    expect(schmidtToUcsMpa(71, 27)).toBeNull()
    expect(schmidtToUcsMpa(40, 0)).toBeNull()
    expect(schmidtToUcsMpa(50, 27)!).toBeGreaterThan(schmidtToUcsMpa(40, 27)!)
    expect(pointLoadToUcsMpa(0.17)).toBeCloseTo(4.08, 2)
  })
})
