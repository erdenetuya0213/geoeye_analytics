import { describe, expect, it } from 'vitest'
import type { EdaDataset, EdaVariableDefinition } from '../data/edaTypes.js'
import type { EdaObservation } from './eda.js'
import { schmidtToUcsMpa } from './schmidt.js'
import {
  DEFAULT_STRENGTH_SETTINGS,
  analyzeStrength,
  guessStrengthSources,
  isrmGrade,
  pointLoadVsSchmidt,
  schmidtByGrade,
  unitCheck,
  type PliSchmidtPair,
} from './strengthCorrelation.js'

let counter = 0
const obs = (holeId: string, depthFrom: number, depthTo: number, values: Record<string, number | null>, dimensions: Record<string, string> = {}): EdaObservation => {
  counter += 1
  return { id: `o${counter}`, joinKey: `${holeId}:${depthFrom}:${depthTo}:${counter}`, dimensions, sourceObservationId: `s${counter}`, sampleId: `S${counter}`, holeId, depthFrom, depthTo, easting: 0, northing: 0, lithology: 'Sandstone', values }
}
const numericVariable = (key: string, label: string): EdaVariableDefinition => ({ dataType: 'numeric', decimals: 1, key, label, shortLabel: label, unit: '' })
const dataset = (id: string, name: string, observations: EdaObservation[], variables: EdaVariableDefinition[], dimensions: { key: string; label: string }[] = []): EdaDataset => ({
  dimensions, id, name, observations, producer: 'test', project: 'test', snapshotAt: '2026-10-07', source: 'live', support: 'interval', variables,
})

describe('isrmGrade', () => {
  it('reads the R-code from a logged strength class and ignores anything else', () => {
    expect(isrmGrade('R3 Medium strong rock')).toBe('R3')
    expect(isrmGrade('r5')).toBe('R5')
    expect(isrmGrade('R7 Beyond scale')).toBeNull()
    expect(isrmGrade('relog-unassigned:3')).toBeNull()
    expect(isrmGrade(undefined)).toBeNull()
  })
})

describe('schmidtByGrade', () => {
  const grades = [
    obs('H1', 0, 5, {}, { field_strength: 'R2 Weak rock' }),
    obs('H1', 5, 10, {}, { field_strength: 'R4 Strong rock' }),
    obs('H1', 10, 15, {}, { field_strength: 'not logged' }),
  ]
  it('groups Schmidt readings by the ISRM grade logged at the same hole and depth, either support', () => {
    const schmidt = [
      obs('H1', 1, 2, { r: 20 }), obs('H1', 3, 4, { r: 24 }), obs('H1', 4, 4, { r: 28 }), // two intervals + one point inside R2
      obs('H1', 6, 7, { r: 44 }), obs('H1', 8, 8, { r: 48 }), // R4
      obs('H1', 11, 12, { r: 99 }), // grade not an ISRM class → dropped
      obs('H9', 1, 2, { r: 77 }), // other hole → dropped
    ]
    const rows = schmidtByGrade(schmidt, 'r', grades, 'field_strength')
    expect(rows.map((row) => [row.grade, row.n])).toEqual([['R2', 3], ['R4', 2]])
    expect(rows[0]).toMatchObject({ median: 24, min: 20, max: 28 })
    expect(rows[1]).toMatchObject({ median: 46 })
  })

  it('matches hole-id spelling variants', () => {
    const rows = schmidtByGrade([obs('TT2026-006GT', 1, 2, { r: 30 })], 'r', [obs('TT_2026_006GT', 0, 5, {}, { g: 'R3 Medium strong' })], 'g')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ grade: 'R3', n: 1 })
  })
})

describe('pointLoadVsSchmidt', () => {
  it('averages the Schmidt readings within the window around each point-load test', () => {
    const schmidt = [obs('H1', 9, 9.5, { r: 30 }), obs('H1', 10.2, 10.4, { r: 40 }), obs('H1', 14, 15, { r: 60 })]
    const pli = [obs('H1', 10, 10, { is: 0.4 })]
    const pairs = pointLoadVsSchmidt(pli, 'is', schmidt, 'r', 1)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ pointLoad: 0.4, schmidt: 35, schmidtReadings: 2, depth: 10 })
  })

  it('skips tests without any Schmidt reading nearby or without a depth, and normalises hole ids', () => {
    const schmidt = [obs('TT2026-006GT', 5, 6, { r: 33 })]
    const pli = [obs('TT_2026_006GT', 5.5, 5.5, { is: 0.3 }), obs('TT_2026_006GT', 50, 50, { is: 0.3 }), obs('TT_2026_006GT', Number.NaN, Number.NaN, { is: 0.3 }), obs('H2', 5.5, 5.5, { is: 0.3 })]
    const pairs = pointLoadVsSchmidt(pli, 'is', schmidt, 'r', 1)
    expect(pairs.map((pair) => pair.schmidt)).toEqual([33])
  })
})

describe('unitCheck', () => {
  const pairsAt = (schmidt: number, pointLoad: number, n = 5): PliSchmidtPair[] => Array.from({ length: n }, (_, i) => ({ depth: i, hole: 'H1', pointLoad, schmidt, schmidtReadings: 1 }))
  it('flags point-load values far below what the Schmidt readings imply', () => {
    const implied = schmidtToUcsMpa(40, 27)! / 24
    const check = unitCheck(pairsAt(40, implied / 22), DEFAULT_STRENGTH_SETTINGS)!
    expect(check.flag).toBe('measured-low')
    expect(check.ratio).toBeCloseTo(22, 0)
  })
  it('flags point-load values far above, and accepts consistent ones', () => {
    const implied = schmidtToUcsMpa(40, 27)! / 24
    expect(unitCheck(pairsAt(40, implied * 10), DEFAULT_STRENGTH_SETTINGS)!.flag).toBe('measured-high')
    expect(unitCheck(pairsAt(40, implied * 1.2), DEFAULT_STRENGTH_SETTINGS)!.flag).toBe('ok')
  })
  it('needs at least three pairs and ignores Schmidt values outside the valid range', () => {
    expect(unitCheck(pairsAt(40, 1, 2), DEFAULT_STRENGTH_SETTINGS)).toBeNull()
    expect(unitCheck(pairsAt(5, 1), DEFAULT_STRENGTH_SETTINGS)).toBeNull()
  })
})

describe('analyzeStrength', () => {
  const schmidtRows = [
    obs('H1', 1, 2, { r: 20 }), obs('H1', 2, 3, { r: 22 }), obs('H1', 3, 4, { r: 24 }), obs('H1', 4, 5, { r: 26 }), obs('H1', 5, 6, { r: 28 }),
    obs('H1', 6, 7, { r: 40 }), obs('H1', 7, 8, { r: 42 }), obs('H1', 8, 9, { r: 44 }), obs('H1', 9, 10, { r: 46 }), obs('H1', 10, 11, { r: 48 }),
    obs('H1', 11, 12, { r: 56 }), obs('H1', 12, 13, { r: 58 }), obs('H1', 13, 14, { r: 60 }), obs('H1', 14, 15, { r: 62 }), obs('H1', 15, 16, { r: 64 }),
  ]
  const gradeRows = [
    obs('H1', 0, 6, {}, { field_strength: 'R2 Weak rock' }),
    obs('H1', 6, 11, {}, { field_strength: 'R4 Strong rock' }),
    obs('H1', 11, 20, {}, { field_strength: 'R5 Very strong rock' }),
  ]
  const pliRows = [1.5, 5.5, 8.5, 12.5, 14.5].map((depth, i) => obs('H1', depth, depth, { is: 0.1 + i * 0.02 }))
  const labRows = [
    obs('Project', Number.NaN, Number.NaN, { ucs: 30 }, { test_type: 'UCS' }),
    obs('Project', Number.NaN, Number.NaN, { ucs: 50 }, { test_type: 'UCS' }),
    obs('Project', Number.NaN, Number.NaN, { ucs: 12 }, { test_type: 'Brazilian' }),
  ]
  const datasets = [
    dataset('neguun', 'Geotechnical by Neguun', [...schmidtRows, ...gradeRows], [numericVariable('r', 'Smidth')], [{ key: 'field_strength', label: 'Field strength' }]),
    dataset('pli', 'Point load', pliRows, [numericVariable('is', 'Is(50)')]),
    dataset('lab', 'Laboratory strength', labRows, [numericVariable('ucs', 'Strength')], [{ key: 'test_type', label: 'Test type' }]),
  ]
  const sources = {
    grade: { datasetId: 'neguun', key: 'field_strength' },
    lab: { datasetId: 'lab', key: 'ucs', testType: 'UCS', testTypeKey: 'test_type' },
    pointLoad: { datasetId: 'pli', key: 'is' },
    schmidt: { datasetId: 'neguun', key: 'r' },
  }

  it('builds the grade table, pairs, UCS groups and per-hole table', () => {
    const result = analyzeStrength(datasets, sources, DEFAULT_STRENGTH_SETTINGS)
    expect(result.grades.map((row) => row.grade)).toEqual(['R2', 'R4', 'R5'])
    expect(result.gradeMonotonic).toBe(true)
    expect(result.pairs).toHaveLength(5)
    expect(result.spearman).not.toBeNull()
    expect(result.ucs.map((group) => group.stats.count)).toEqual([15, 5, 2]) // lab filtered to UCS tests only
    expect(result.ucs[2]!.stats.median).toBe(40)
    expect(result.holes).toHaveLength(1)
    expect(result.holes[0]).toMatchObject({ hole: 'H1', labTests: 0, pliTests: 5, schmidtReadings: 15 })
  })

  it('warns that the point-load units look wrong when Is(50) is far below what Schmidt implies', () => {
    const result = analyzeStrength(datasets, sources, DEFAULT_STRENGTH_SETTINGS)
    expect(result.unitCheck?.flag).toBe('measured-low')
    const warning = result.findings.find((finding) => finding.level === 'warn' && finding.text.includes('lower'))
    expect(warning?.text).toContain('point-load sheet units')
  })

  it('reports a rising Schmidt median with grade as ok, and a broken ordering as a warning', () => {
    const ok = analyzeStrength(datasets, sources, DEFAULT_STRENGTH_SETTINGS)
    expect(ok.findings[0]).toMatchObject({ level: 'ok' })
    const swapped = dataset('neguun', 'Geotechnical by Neguun', [...schmidtRows, ...gradeRows.map((row, i) => ({ ...row, dimensions: { field_strength: ['R5 Very strong rock', 'R4 Strong rock', 'R2 Weak rock'][i]! } }))], [numericVariable('r', 'Smidth')], [{ key: 'field_strength', label: 'Field strength' }])
    const result = analyzeStrength([swapped, datasets[1]!, datasets[2]!], sources, DEFAULT_STRENGTH_SETTINGS)
    expect(result.gradeMonotonic).toBe(false)
    expect(result.findings[0]).toMatchObject({ level: 'warn' })
  })

  it('returns an empty result when nothing is selected', () => {
    const result = analyzeStrength(datasets, {}, DEFAULT_STRENGTH_SETTINGS)
    expect(result.grades).toEqual([])
    expect(result.pairs).toEqual([])
    expect(result.holes).toEqual([])
    expect(result.findings).toEqual([])
  })
})

describe('guessStrengthSources', () => {
  it('finds Schmidt, point load, ISRM grade and lab UCS by name', () => {
    const datasets = [
      dataset('neguun', 'Geotechnical by Neguun', [obs('H1', 0, 1, { smidth: 30 }, { field_strength: 'R3 Medium strong' })], [numericVariable('smidth', 'Smidth'), numericVariable('rqd', 'RQD')], [{ key: 'field_strength', label: 'Field strength' }]),
      dataset('pli', 'Imported PLI', [obs('H1', 0, 1, { is50: 0.3 })], [numericVariable('is50', 'Is(50)')]),
      dataset('lab', 'Laboratory strength', [obs('Project', Number.NaN, Number.NaN, { ucs: 40 }, { test_type: 'UCS' })], [numericVariable('ucs', 'Strength')], [{ key: 'test_type', label: 'Test type' }]),
    ]
    expect(guessStrengthSources(datasets)).toEqual({
      grade: { datasetId: 'neguun', key: 'field_strength' },
      lab: { datasetId: 'lab', key: 'ucs', testType: 'UCS', testTypeKey: 'test_type' },
      pointLoad: { datasetId: 'pli', key: 'is50' },
      schmidt: { datasetId: 'neguun', key: 'smidth' },
    })
  })

  it('leaves sources empty when the project has none of them', () => {
    const guess = guessStrengthSources([dataset('a', 'Assays', [obs('H1', 0, 1, { cu: 1 })], [numericVariable('cu', 'Cu')])])
    expect(guess.schmidt).toBeUndefined()
    expect(guess.pointLoad).toBeUndefined()
    expect(guess.grade).toBeUndefined()
    expect(guess.lab).toBeUndefined()
  })
})
