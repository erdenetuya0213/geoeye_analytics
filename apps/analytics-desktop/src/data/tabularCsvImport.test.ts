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
