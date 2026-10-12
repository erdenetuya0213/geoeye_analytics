import { describe, expect, it } from 'vitest'
import { parseTabularCsv } from './tabularCsvImport.js'

describe('tabular CSV imports', () => {
  it('parses quoted cells and pads short rows for local drafts', () => {
    expect(parseTabularCsv('Hole ID,From,Result\nDH-1,10,"12,400"\nDH-2,20', 'assay.csv', 'laboratory')).toEqual({
      columns: ['Hole ID', 'From', 'Result'],
      fileName: 'assay.csv',
      rows: [['DH-1', '10', '12,400'], ['DH-2', '20', '']],
      section: 'laboratory',
    })
  })

  it('rejects duplicate headers before anything is saved', () => {
    expect(() => parseTabularCsv('Result,result\n1,2', 'xrf.csv', 'xrf')).toThrow('unique')
  })
})


it.each([',', ';', '\t'])('detects the %s delimiter and preserves existing lab headers', delimiter => {
  const csv = ['Hole_ID', 'Depth (m)', 'Fe (%)', 'Laboratory note'].join(delimiter) + '\n' + ['DH1', '10.5', '4.21', '"Lab, A; batch"'].join(delimiter)
  const parsed = parseTabularCsv(csv, 'lab.csv', 'laboratory')
  expect(parsed.columns).toEqual(['Hole_ID', 'Depth (m)', 'Fe (%)', 'Laboratory note'])
  expect(parsed.rows[0]).toEqual(['DH1', '10.5', '4.21', 'Lab, A; batch'])
})

it('detects headers after empty lines and preserves multiline quoted values', () => {
  const parsed = parseTabularCsv('\n\nHole_ID;Note\nDH1;"first\nsecond"', 'xrf.csv', 'xrf')
  expect(parsed.columns).toEqual(['Hole_ID', 'Note'])
  expect(parsed.rows).toEqual([['DH1', 'first\nsecond']])
})
