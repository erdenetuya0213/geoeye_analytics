import { describe, expect, it } from 'vitest'
import { emptyClassTable, mergeClassImport, parseClassRows } from './classTables.js'
import { csvRows } from './tabularCsvImport.js'

const parse = (text: string) => parseClassRows(csvRows(text))

describe('Lab CSV import', () => {
  it('matches the four required headers by alias in any order and keeps every other column under its own name', () => {
    const result = parse('Is(50) (MPa),To (m),BHID,Sample no,Start depth (m),Failure Type\n0.17,3.2,DH1,S1,3,PL\n0,6.25,DH1,S2,6,')
    expect(result.columns).toEqual(['Hole ID', 'Sample ID', 'From', 'To', 'Is(50) (MPa)', 'Failure Type'])
    expect(result.rows).toEqual([['DH1', 'S1', '3', '3.2', '0.17', 'PL'], ['DH1', 'S2', '6', '6.25', '0', '']])
  })

  it('lists the required columns a file is missing', () => {
    expect(() => parse('Borehole,From,To,Smidth\nDH1,0,1,40')).toThrow('CSV is missing required columns: Sample ID.')
    expect(() => parse('Sample,Value\nS1,4')).toThrow('Hole ID, From, To')
  })

  it('skips rows without test values or with a bad location, and says which', () => {
    const result = parse('Hole,Sample,From,To,UCS MPa\nDH1,S1,0,1,\nDH1,,1,2,55\nDH1,S3,5,4,60\n"DD,01",S4,2,3,48')
    expect(result).toMatchObject({ skipped: 3, rows: [['DD,01', 'S4', '2', '3', '48']] })
    expect(result.issues).toEqual(['Row 2: no measured values.', 'Row 3: Sample ID is required.', 'Row 4: From and To must be depths with To ≥ From ≥ 0.'])
  })

  it('matches imported headers to the columns a class already has and replaces re-imported samples', () => {
    const first = mergeClassImport(emptyClassTable('t1', 'Point load'), parse('Hole,Sample,From,To,Is(50) (MPa)\nDH1,S1,0,1,0.17\nDH1,S2,1,2,0.18'))
    expect(first.added).toBe(2)
    const second = mergeClassImport(first.table, parse('Hole,Sample,From,To,Lithology,is50 mpa\nDH1,S2,1,2,LST,0.2\nDH1,S3,2,3,LST,0.3'))
    expect(second.added).toBe(1)
    expect(second.table.columns).toEqual(['Hole ID', 'Sample ID', 'From', 'To', 'Is(50) (MPa)', 'Lithology'])
    expect(second.table.rows).toEqual([['DH1', 'S2', '1', '2', '0.2', 'LST'], ['DH1', 'S3', '2', '3', '0.3', 'LST'], ['DH1', 'S1', '0', '1', '0.17', '']])
  })
})
