import { describe, expect, it } from 'vitest'
import { parseStrengthCsv } from './strengthCsvImport.js'

describe('Strength CSV import', () => {
  it('imports Smidth as Schmidt rebound data and skips blank duplicate rows', () => {
    const result = parseStrengthCsv([
      'Borehole,From,To,Smidth',
      'TT_2026_002GT,0,0.842,',
      'TT_2026_002GT,0,0.842,',
      'TT_2026_002GT,0,0.842,12',
      'TT_2026_002GT,0,0.842,',
      'TT_2026_002GT,0.842,1,45',
    ].join('\n'), 'strength.csv', '2026-10-01T00:00:00.000Z')

    expect(result).toMatchObject({ blankRows: 3, invalidRows: 0, kind: 'schmidt', sourceRows: 5 })
    expect(result.records).toHaveLength(2)
    expect(result.records[0]).toMatchObject({
      depthFromM: 0,
      depthToM: 0.842,
      holeId: 'TT_2026_002GT',
      reboundValue: 12,
      sampleId: 'TT_2026_002GT-0-0.842-SCH',
      sourceRow: 4,
    })
  })

  it('accepts quoted fields and the correctly-spelled Schmidt header', () => {
    const result = parseStrengthCsv('Hole ID,Depth From,Depth To,Schmidt\r\n"DD,01",1,2,38\r\n', 'quoted.csv')
    expect(result.records[0]).toMatchObject({ holeId: 'DD,01', reboundValue: 38 })
  })

  it('rejects a point-load-shaped file without Schmidt values', () => {
    expect(() => parseStrengthCsv('Sample ID,Hole ID,Peak Load kN,Equivalent Diameter mm\nP1,DD1,8,50', 'point-load.csv'))
      .toThrow('Missing: From, To, Schmidt/Smidth')
  })
})
