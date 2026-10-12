import { describe, it, expect } from 'vitest'
import { deriveLaubscher90Condition, deriveLaubscher90Interval, type Laubscher90Observation, L90_FF_TABLE } from '../src/structure-calculations/laubscher90.js'
import { deriveStructureCompositeExportRecords } from '../src/structure-calculations/structure-log-export.js'

const joint: Laubscher90Observation = { structureType: 'JN', l90Macro: 'ST', l90Micro: 'S_PL', l90Wall: 'N', l90Filling: 'SM', l90Water: 'D', l90Weight: 1 }

describe('Laubscher 1990 joint condition', () => {
  it('multiplies the actual dry table factors, independently of the project JCR crosswalk', () => {
    expect(deriveLaubscher90Condition(joint)).toEqual({ a: 75, b: 60, c: 100, d: 60, score: 10.8 })
  })
  it('uses the same groundwater column for all factors', () => {
    expect(deriveLaubscher90Condition({ ...joint, l90Water: 'H', l90Wall: 'W' })).toEqual({ a: 60, b: 45, c: 60, d: 45, score: 2.916 })
  })
  it.each(['l90Macro', 'l90Micro', 'l90Wall', 'l90Filling', 'l90Water'] as const)('keeps missing %s unscored', (field) => {
    expect(deriveLaubscher90Condition({ ...joint, [field]: null }).score).toBeNull()
    expect(deriveLaubscher90Condition({ ...joint, [field]: 'UNKNOWN' }).score).toBeNull()
  })
  it('requires explicit representative weights and complete observations', () => {
    const other = { ...joint, l90Filling: 'N', l90Weight: 3 }
    expect(deriveLaubscher90Interval([joint, other])).toBeCloseTo(16.2)
    expect(deriveLaubscher90Interval([joint, { ...other, l90Water: null }])).toBeNull()
    for (const weight of [undefined, null, 0, -1, NaN, Infinity]) expect(deriveLaubscher90Interval([{ ...joint, l90Weight: weight }])).toBeNull()
    expect(deriveLaubscher90Interval([])).toBeNull()
    expect(deriveLaubscher90Interval([joint, { structureType: 'VN' }])).toBe(10.8)
  })
  it('keeps export values separate from RMR76 and does not invent a total or FF score', () => {
    const composites = [{ depthFromM: 0, depthToM: 1, observations: [{ ...joint, depthM: 0.5 }] }]
    const result = deriveStructureCompositeExportRecords({ composites, ratingSystems: ['laubscher90'] })[0]
    expect(result.values['RMR90 joint condition']).toBe('10.80')
    expect(Object.keys(result.values).some((key) => /Project JCR|JRC median|RMR76/.test(key))).toBe(false)
    expect(deriveStructureCompositeExportRecords({ composites })[0].values['RMR90 joint condition']).toBeUndefined()
    expect(L90_FF_TABLE.scoreHeaders).toEqual(['1 set', '2 sets', '3 sets'])
  })
})
