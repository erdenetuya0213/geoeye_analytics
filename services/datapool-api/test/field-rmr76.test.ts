import { describe, it, expect } from 'vitest'
import { deriveRmr76Interval, rmr76JointConditionScore, rmr76SpacingScore, type Rmr76Observation } from '../src/structure-calculations/rmr76.js'
import { deriveStructureCompositeExportRecords } from '../src/structure-calculations/structure-log-export.js'

const base: Rmr76Observation = { depthM: 0.1, structureType: 'JN', jointSetId: 'A', roughness: 'VR', apertureMm: 0, infillType: 'N', infillThicknessMm: 0, wallRockHardness: 'H', jointContinuity: 'D' }

describe('RMR76 component calculations', () => {
  it.each([[0.049, 5], [0.05, 10], [0.3, 20], [1, 25], [3, 25], [3.01, 30]])('scores spacing %s m as %s', (spacing, score) => {
    expect(rmr76SpacingScore(spacing)).toBe(score)
  })
  it.each([null, undefined, NaN, Infinity, 0, -1])('leaves invalid spacing %s unscored', (spacing) => {
    expect(rmr76SpacingScore(spacing)).toBeNull()
  })
  it('matches all five joint-condition scores from observations, without a JRC conversion', () => {
    expect(rmr76JointConditionScore(base)).toBe(25)
    expect(rmr76JointConditionScore({ ...base, roughness: 'R', apertureMm: 0.5 })).toBe(20)
    expect(rmr76JointConditionScore({ ...base, roughness: 'SR', apertureMm: 0.5, wallRockHardness: 'S' })).toBe(12)
    expect(rmr76JointConditionScore({ ...base, roughness: 'K' })).toBe(6)
    expect(rmr76JointConditionScore({ ...base, infillType: 'GG', infillThicknessMm: 6, infillHardness: 'S' })).toBe(0)
  })
  it('treats any soft filling as gouge and a hard filling as the separation it holds open', () => {
    // 2 mm soft clay: gouge <5 mm → 6. 8 mm soft clay: soft gouge >5 mm → 0.
    expect(rmr76JointConditionScore({ ...base, roughness: 'SR', apertureMm: 0, infillType: 'CL', infillThicknessMm: 2, infillHardness: 'S' })).toBe(6)
    expect(rmr76JointConditionScore({ ...base, roughness: 'SR', apertureMm: 0, infillType: 'CL', infillThicknessMm: 8, infillHardness: 'S' })).toBe(0)
    // 0.5 mm hard calcite: walls slightly rough, separation <1 mm, hard wall → 20; 3 mm hard on a continuous joint → 6.
    expect(rmr76JointConditionScore({ ...base, roughness: 'SR', apertureMm: 0, infillType: 'CC', infillThicknessMm: 0.5, infillHardness: 'H' })).toBe(20)
    expect(rmr76JointConditionScore({ ...base, roughness: 'SR', apertureMm: 0, infillType: 'CC', infillThicknessMm: 3, infillHardness: 'H', jointContinuity: 'C' })).toBe(6)
  })
  it('does not guess unknown, conflicting or unmatched conditions', () => {
    expect(rmr76JointConditionScore({ ...base, apertureMm: null })).toBeNull()
    expect(rmr76JointConditionScore({ ...base, wallRockHardness: null })).toBeNull()
    expect(rmr76JointConditionScore({ ...base, infillThicknessMm: 2 })).toBeNull()
    expect(rmr76JointConditionScore({ ...base, infillType: 'GG', infillThicknessMm: 5, infillHardness: 'S' })).toBeNull()
    expect(rmr76JointConditionScore({ ...base, apertureMm: 5, jointContinuity: 'C' })).toBe(6)
    expect(rmr76JointConditionScore({ ...base, apertureMm: 5.01, jointContinuity: 'C' })).toBe(0)
  })
  it('does not put a 0.3 m spacing in the lower band because of depth subtraction noise', () => {
    expect(deriveRmr76Interval([{ ...base, depthM: 100 }, { ...base, depthM: 100.3 }]).spacingScore).toBe(20)
  })
  it('uses reviewed sets and complete evidence for interval scores', () => {
    const observations = [base, { ...base, depthM: 0.6, roughness: 'R', apertureMm: 0.5 }]
    expect(deriveRmr76Interval(observations)).toEqual({ jcr: 20, spacingM: 0.5, spacingScore: 20 })
    expect(deriveRmr76Interval([...observations, { ...base, depthM: 0.8, jointSetId: null, apertureMm: null }])).toEqual({ jcr: null, spacingM: null, spacingScore: null })
    expect(deriveRmr76Interval([...observations, { ...base, structureType: 'VN' }])).toEqual({ jcr: 20, spacingM: 0.5, spacingScore: 20 })
  })
  it('exports RMR76 components without JRC or project JCR when only 76 is selected', () => {
    const [result] = deriveStructureCompositeExportRecords({ ratingSystems: ['rmr76'], composites: [{ depthFromM: 0, depthToM: 1, observations: [base, { ...base, depthM: 0.6 }] }] })
    expect(result.values).toMatchObject({ 'RMR76 JCR': '25', 'RMR76 spacing score': '20', 'RMR76 apparent spacing (m)': '0.500' })
    expect(Object.keys(result.values).some((key) => key.includes('JRC') || key.includes('Project JCR'))).toBe(false)
  })
})
