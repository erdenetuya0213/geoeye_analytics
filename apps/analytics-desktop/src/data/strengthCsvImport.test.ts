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

  it('reports missing point-load location and test headers', () => {
    expect(() => parseStrengthCsv('Sample ID,Hole ID,Peak Load kN,Equivalent Diameter mm\nP1,DD1,8,50', 'point-load.csv'))
      .toThrow('Point-load CSV is missing: Depth (m) or From, Test Type')
  })
})


const labCsv = 'Hole ID,Sample no,Depth (m),Test Type,Failure Type,W (mm),D (mm),A (mm²),Gauge Reading (MPa),P (kN),Sample Description/Unit,De² (mm²),De (mm),Is (MPa),F,Is(50) (MPa)\n' +
  'TT_2026_004_GT,PL-08-02-PL,147.4,DIAG,PL,126,63,3116,22.37,0.623,LST,3969,63.00,0.16,1.11,0.17\n' +
  'TT_2026_004_GT,PL-08-02-PP,147.56,AXIS,PP,40,63,3116,23.93,0.632,LST,3969,63.00,0.16,1.11,0.18\n'

describe('point-load laboratory CSV', () => {
  it('imports the provided header layout and retains reported rounded values', () => {
    const result = parseStrengthCsv(labCsv, 'lab.csv', '2026-10-05T00:00:00.000Z')
    expect(result.kind).toBe('point-load')
    if (result.kind !== 'point-load') throw new Error('Wrong import kind')
    expect(result.records).toHaveLength(2)
    expect(result.records[0]).toMatchObject({ holeId: 'TT_2026_004_GT', sampleId: 'PL-08-02-PL', depthFromM: 147.4, depthToM: 147.4,
      testType: 'diametral', peakLoadKn: 0.623, equivalentDiameterMm: 63, isMpa: 0.16, correctionFactor: 1.11, is50Mpa: 0.17,
      labName: '', testedAt: '', sourceValues: { 'Failure Type': 'PL', 'Gauge Reading (MPa)': '22.37' } })
    expect(result.records[1]!.testType).toBe('axial')
  })
  it('calculates missing indices from load and diameter and supports squared diameter', () => {
    const result = parseStrengthCsv('Hole ID,Sample no,Depth (m),Test Type,P (kN),De² (mm²)\nDH1,S1,0,DIAG,1,2500', 'minimal.csv')
    expect(result.records[0]).toMatchObject({ equivalentDiameterMm: 50, isMpa: 0.4, correctionFactor: 1, is50Mpa: 0.4 })
  })
  it('skips invalid rows with clear diagnostics', () => {
    const result = parseStrengthCsv(labCsv + ',bad,1,DIAG,PL,126,63,3116,22.37,0.623,LST,3969,63,0.16,1.11,0.17', 'invalid.csv')
    expect(result).toMatchObject({ invalidRows: 1, sourceRows: 3 })
    expect(result.issues[0]).toContain('Row 4')
  })
})


it('matches the four Smidth headers in any order and preserves zeros and decimals', () => {
  const result = parseStrengthCsv('Smidth value,To (m),Hole_ID,From (m)\n0,1.01,DH1,0\n35.25,2.033,DH1,1.01\n,3,DH1,2.033', 'smidth.csv')
  expect(result).toMatchObject({ kind: 'schmidt', blankRows: 1, invalidRows: 0 })
  expect(result.records).toHaveLength(2)
  expect(result.records[0]).toMatchObject({ holeId: 'DH1', depthFromM: 0, depthToM: 1.01, reboundValue: 0 })
  expect(result.records[1]).toMatchObject({ holeId: 'DH1', depthFromM: 1.01, depthToM: 2.033, reboundValue: 35.25 })
})

it('matches equivalent Smidth header names alongside unrelated sheet columns', () => {
  const result = parseStrengthCsv('BHID,Start depth (m),End depth (m),Schmidt value,Weathering\nDH1,0,1,40,W3', 'aliases.csv')
  expect(result.records[0]).toMatchObject({ holeId: 'DH1', depthFromM: 0, depthToM: 1, reboundValue: 40 })
})
