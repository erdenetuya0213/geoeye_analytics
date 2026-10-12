import { describe, it, expect } from 'vitest'
import {
  deriveRmr89Interval,
  rmr89ApertureScore,
  rmr89ConditionScore,
  rmr89InfillScore,
  rmr89PersistenceScore,
  rmr89RoughnessScore,
  rmr89SpacingScore,
  rmr89WeatheringScore,
  type Rmr89Observation,
} from '../src/structure-calculations/rmr89.js'
import { deriveStructureCompositeExportRecords } from '../src/structure-calculations/structure-log-export.js'

const base: Rmr89Observation = {
  depthM: 0.1, structureType: 'JN', jointSetId: 'A', persistenceM: 0.5, apertureMm: 0,
  roughness: 'VR', infillType: 'N', infillThicknessMm: 0, wallAlteration: 'FR',
}

describe('RMR89 discontinuity components from primary observations', () => {
  it.each([[0.5, 6], [1, 4], [2.9, 4], [3, 2], [9.9, 2], [10, 1], [20, 1], [20.1, 0]])('rates persistence %s m as %s', (metres, score) => {
    expect(rmr89PersistenceScore(metres)).toBe(score)
  })
  it.each([[0, 6], [0.05, 5], [0.1, 4], [0.99, 4], [1, 1], [5, 1], [5.1, 0]])('rates measured aperture %s mm as %s', (mm, score) => {
    expect(rmr89ApertureScore(mm)).toBe(score)
  })
  it('reads the aperture class on the adverse side of any boundary it straddles', () => {
    expect(rmr89ApertureScore(null, 'TG')).toBe(6)
    expect(rmr89ApertureScore(null, 'VN')).toBe(5)
    expect(rmr89ApertureScore(null, 'NA')).toBe(4)
    expect(rmr89ApertureScore(null, 'PO')).toBe(4)
    expect(rmr89ApertureScore(null, 'LA')).toBe(0)
    // Open (0.5–2.5 mm) and moderately large (2.5–10 mm) straddle a boundary: the adverse class applies.
    expect(rmr89ApertureScore(null, 'OP')).toBe(1)
    expect(rmr89ApertureScore(null, 'ML')).toBe(0)
    expect(rmr89ApertureScore(null, null)).toBeNull()
    expect(rmr89PersistenceScore(null, 'M')).toBe(2)
    expect(rmr89PersistenceScore(null, 'VH')).toBe(0)
    // A measurement always wins over the description.
    expect(rmr89ApertureScore(0.2, 'LA')).toBe(4)
  })
  it('rates roughness and joint-wall weathering from their codes', () => {
    expect(['VR', 'R', 'SR', 'S', 'K', 'X'].map(rmr89RoughnessScore)).toEqual([6, 5, 3, 1, 0, null])
    expect(['FR', 'SW', 'MW', 'HW', 'CW', 'RS'].map(rmr89WeatheringScore)).toEqual([6, 5, 3, 1, 0, null])
  })
  it('rates infill from material, hardness and thickness without guessing', () => {
    expect(rmr89InfillScore('N', null, 0)).toBe(6)
    expect(rmr89InfillScore('CL', 'H', 2)).toBe(4)
    expect(rmr89InfillScore('CL', 'H', 8)).toBe(2)
    expect(rmr89InfillScore('CL', 'S', 2)).toBe(2)
    expect(rmr89InfillScore('GG', 'G', 8)).toBe(0)
    expect(rmr89InfillScore('CL', 'H', 5)).toBeNull() // boundary: review
    expect(rmr89InfillScore('N', null, 2)).toBeNull() // conflicting
    expect(rmr89InfillScore('CL', 'S', 0)).toBeNull() // conflicting
    expect(rmr89InfillScore('CL', null, 2)).toBeNull() // mineral name alone is not hard or soft
  })
  it.each([[0.05, 5], [0.06, 8], [0.2, 10], [0.6, 15], [2, 15], [2.01, 20]])('scores spacing %s m as %s', (spacing, score) => {
    expect(rmr89SpacingScore(spacing)).toBe(score)
  })
  it.each([null, undefined, NaN, 0, -1])('leaves invalid spacing %s unscored', (spacing) => {
    expect(rmr89SpacingScore(spacing)).toBeNull()
  })
  it('sums the five sub-ratings per structure and leaves an incomplete row unrated', () => {
    expect(rmr89ConditionScore(base)).toEqual({ persistence: 6, aperture: 6, roughness: 6, infill: 6, weathering: 6, total: 30 })
    expect(rmr89ConditionScore({ ...base, roughness: 'K', apertureMm: 3, wallAlteration: 'HW' }).total).toBe(14)
    expect(rmr89ConditionScore({ ...base, persistenceM: null }).total).toBeNull()
  })
  it('takes the most adverse complete R4 and the closest reviewed set spacing', () => {
    const observations = [base, { ...base, depthM: 0.6, roughness: 'S' }]
    expect(deriveRmr89Interval(observations)).toEqual({ condition: 25, spacingM: 0.5, spacingScore: 10 })
    expect(deriveRmr89Interval([...observations, { ...base, depthM: 0.8, jointSetId: null, persistenceM: null }])).toEqual({ condition: null, spacingM: null, spacingScore: null })
    // Veins are recorded but never rated as discontinuity condition.
    expect(deriveRmr89Interval([...observations, { ...base, structureType: 'VN', persistenceM: null }])).toEqual({ condition: 25, spacingM: 0.5, spacingScore: 10 })
  })
  it('exports RMR89 beside RMR76 from the same observations', () => {
    const shared = { ...base, wallRockHardness: 'H', jointContinuity: 'D' }
    const [result] = deriveStructureCompositeExportRecords({
      ratingSystems: ['rmr76', 'rmr89'],
      composites: [{ depthFromM: 0, depthToM: 1, observations: [shared, { ...shared, depthM: 0.6 }] }],
    })
    expect(result.values).toMatchObject({
      'RMR76 JCR': '25', 'RMR76 spacing score': '20',
      'RMR89 condition (R4)': '30', 'RMR89 apparent spacing (m)': '0.500', 'RMR89 spacing score (R3)': '10',
    })
    expect(Object.keys(result.values).some((key) => /JRC median|Project JCR/.test(key))).toBe(false)
  })
})
