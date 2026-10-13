import { expect, it } from 'vitest'
import { emptyClassTable } from './classTables.js'
import { readClassTables, tableFromImport, writeClassTables } from './classTableStore.js'

function memory(entries: Record<string, string> = {}) {
  return { getItem: (key: string) => entries[key] ?? null, setItem: (key: string, value: string) => { entries[key] = value } }
}

it('round-trips user-named classes without touching their lab values', () => {
  const storage = memory()
  const tests = [{ ...emptyClassTable('t1', 'Brazilian'), columns: ['Hole ID', 'Sample ID', 'From', 'To', 'BTS (MPa)'], rows: [['DH1', 'S1', '1.010', '2', '4.50']] }]
  expect(writeClassTables(storage, 'strength', tests)).toBe(true)
  expect(readClassTables(storage, 'strength')).toEqual(tests)
})

it('carries over records of the former point-load and Schmidt tables once', () => {
  const storage = memory({
    'geoeye.analytics.point-load.v1': JSON.stringify([{ id: 'p1', holeId: 'DH1', sampleId: 'S1', depthFromM: 3, depthToM: 3, testType: 'diametral', peakLoadKn: 0.623,
      equivalentDiameterMm: 63, isMpa: 0.16, correctionFactor: 1.11, is50Mpa: 0.17, validBreak: true, labName: '', testedAt: '',
      sourceValues: { 'Hole ID': 'DH1', 'Sample no': 'S1', 'P (kN)': '0.623', 'Failure Type': 'PL' } }]),
    'geoeye.analytics.schmidt.v1': JSON.stringify([{ id: 's1', holeId: 'DH1', sampleId: 'DH1-0-1-SCH', depthFromM: 0, depthToM: 1, reboundValue: 40 }]),
  })
  const [pointLoad, schmidt] = readClassTables(storage, 'strength')
  expect(pointLoad).toMatchObject({ name: 'Point load', rows: [['DH1', 'S1', '3', '3', 'diametral', '0.623', '63', '0.16', '1.11', '0.17', 'true', '', '', 'PL']] })
  expect(pointLoad!.columns.slice(-2)).toEqual(['Test date', 'Failure Type'])
  expect(schmidt).toMatchObject({ name: 'Schmidt rebound', columns: ['Hole ID', 'Sample ID', 'From', 'To', 'Schmidt rebound'], rows: [['DH1', 'DH1-0-1-SCH', '0', '1', '40']] })
  writeClassTables(storage, 'strength', [])
  expect(readClassTables(storage, 'strength')).toEqual([])
})

it('turns a single-table import from an earlier build into the first class', () => {
  const [table] = tableFromImport('assays-2026.csv', ['Sample no', 'Hole', 'From', 'To', 'Au g/t'], [['S1', 'DH1', '0', '1', '0.4']])
  expect(table).toMatchObject({ name: 'assays-2026', columns: ['Hole ID', 'Sample ID', 'From', 'To', 'Au g/t'], rows: [['DH1', 'S1', '0', '1', '0.4']] })
  expect(tableFromImport('x.csv', ['Reading', 'Cu ppm'], [['R1', '12']])).toEqual([])
})
