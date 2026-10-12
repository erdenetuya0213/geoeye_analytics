import { expect, it } from 'vitest'
import { parseStrengthCsv } from './strengthCsvImport.js'
import { editPointLoadRecord, editSchmidtRecord } from './strengthRecordEdits.js'
import { readPointLoadRecords, writePointLoadRecords } from './pointLoadStore.js'
import { strengthDatabaseDraft } from './strengthDatabaseDraft.js'

function imported() {
  const result = parseStrengthCsv('Hole ID,Sample no,Depth (m),Test Type,P (kN),De (mm),Is (MPa),F,Is(50) (MPa)\nDH1,S1,3,DIAG,0.623,63,0.16,1.11,0.17', 'lab.csv')
  if (result.kind !== 'point-load') throw new Error('Expected point load')
  return result.records[0]!
}
it('preserves reported laboratory results when editing hole or interval and survives reload', () => {
  const record = imported()
  const edited = editPointLoadRecord(record, { ...record, holeId: ' DH2 ', depthFromM: 4, depthToM: 5 })
  expect(edited).toMatchObject({ id: record.id, holeId: 'DH2', depthFromM: 4, depthToM: 5, isMpa: 0.16, correctionFactor: 1.11, is50Mpa: 0.17, sourceValues: record.sourceValues })
  let raw = ''
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } }
  writePointLoadRecords(storage, [edited])
  expect(readPointLoadRecords(storage)).toEqual([edited])
  const draft = strengthDatabaseDraft([edited], [])
  expect(draft.rows[0]![draft.columns.indexOf('Hole ID')]).toBe('DH2')
})
it('recalculates point-load indices when load or diameter changes', () => {
  const record = imported()
  expect(editPointLoadRecord(record, { ...record, peakLoadKn: 1, equivalentDiameterMm: 50 })).toMatchObject({ isMpa: 0.4, correctionFactor: 1, is50Mpa: 0.4 })
})
it('validates Smidth edits and preserves record identity and source information', () => {
  const result = parseStrengthCsv('Hole ID,From,To,Smidth\nDH1,0,1,35', 'smidth.csv')
  if (result.kind !== 'schmidt') throw new Error('Expected Schmidt')
  const record = result.records[0]!
  const edited = editSchmidtRecord(record, { holeId: 'DH2', depthFromM: 1, depthToM: 2, reboundValue: 0 })
  expect(edited).toMatchObject({ id: record.id, sourceFile: 'smidth.csv', holeId: 'DH2', depthFromM: 1, depthToM: 2, reboundValue: 0 })
  expect(() => editSchmidtRecord(record, { ...record, depthFromM: 2, depthToM: 1 })).toThrow('To')
  expect(() => editSchmidtRecord(record, { ...record, reboundValue: -1 })).toThrow('Smidth value')
})
it('can represent a deleted final record as an empty local dataset', () => {
  expect(strengthDatabaseDraft([], []).rows).toEqual([])
})
