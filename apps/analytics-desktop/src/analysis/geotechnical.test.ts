import { describe, expect, it } from 'vitest'
import {
  calculateLaubscherRmr,
  calculateMrmr,
  calculateQ,
  calculateRmr76,
  classifyRmr76,
  estimateRqdFromFractureFrequency,
  scoreLaubscherJointCondition,
  scoreLaubscherJointSpacing,
  scoreRmr76Rqd,
  scoreRmr76Spacing,
  scoreRmr76Strength,
  summarizeJointSetSpacing,
} from './geotechnical.js'

describe('RMR76', () => {
  it.each([
    [2.99, 0], [3, 1], [10, 2], [25, 4], [50, 7], [100, 12], [200.01, 15],
  ])('rates UCS threshold %s MPa as %s points', (ucs, score) => {
    expect(scoreRmr76Strength(ucs)).toBe(score)
  })

  it.each([
    [24.99, 3], [25, 8], [50, 13], [75, 17], [90, 20],
  ])('rates RQD threshold %s%% as %s points', (rqd, score) => {
    expect(scoreRmr76Rqd(rqd)).toBe(score)
  })

  it.each([
    [0.049, 5], [0.05, 10], [0.3, 20], [1, 25], [3.01, 30],
  ])('rates spacing threshold %s m as %s points', (spacing, score) => {
    expect(scoreRmr76Spacing(spacing)).toBe(score)
  })

  it('uses the documented upper-quality boundary convention', () => {
    expect(scoreRmr76Strength(25)).toBe(4)
    expect(scoreRmr76Rqd(90)).toBe(20)
    expect(scoreRmr76Spacing(0.3)).toBe(20)
  })

  it('calculates the basic and orientation-adjusted rating', () => {
    expect(calculateRmr76({
      excavationType: 'tunnel',
      groundwater: 'moist',
      jointCondition: 'slightly-rough-soft-wall',
      jointSpacingM: 0.5,
      orientation: 'fair',
      rqdPercent: 85,
      ucsMpa: 37,
    })).toMatchObject({
      basic: 60,
      classification: 'Class III · fair',
      missing: [],
      orientationAdjustment: -5,
      total: 55,
    })
  })

  it.each([
    [20, 'Class V · very poor'],
    [21, 'Class IV · poor'],
    [41, 'Class III · fair'],
    [61, 'Class II · good'],
    [81, 'Class I · very good'],
  ])('classifies boundary score %s', (score, classification) => {
    expect(classifyRmr76(score)).toBe(classification)
  })

  it('does not publish an incomplete total', () => {
    const result = calculateRmr76({ ucsMpa: 37 })
    expect(result.basic).toBeNull()
    expect(result.total).toBeNull()
    expect(result.missing).toContain('rqd')
    expect(result.missing).toContain('orientationAdjustment')
  })
})

describe('RQD estimate', () => {
  it('implements the Priest-Hudson negative-exponential estimate', () => {
    expect(estimateRqdFromFractureFrequency(10)).toBeCloseTo(73.5759, 4)
  })
})

describe('Laubscher 1990 RMR and MRMR', () => {
  it('matches the published joint-spacing equations', () => {
    expect(scoreLaubscherJointSpacing([0.5])).toBe(22)
    expect(scoreLaubscherJointSpacing([0.5, 1])).toBe(18)
    expect(scoreLaubscherJointSpacing([0.5, 1, 3])).toBe(14)
  })

  it('matches the published joint-condition worked example', () => {
    expect(scoreLaubscherJointCondition([70, 65, 60])).toBe(11)
  })

  it('keeps the RQD-plus-spacing and fracture-frequency paths exclusive', () => {
    expect(() => calculateLaubscherRmr({
      fractureFrequencyPerM: 5,
      jointConditionFactorsPercent: [70, 65, 60],
      jointSetCount: 3,
      jointSpacingsM: [0.5, 1, 3],
      rqdPercent: 80,
      ucsMpa: 60,
    })).toThrow('either')
  })

  it('multiplies MRMR adjustment factors as fractions', () => {
    expect(calculateMrmr(70, { blasting: 0.94, inducedStress: 0.9, orientation: 0.85, weathering: 0.9 })).toBe(45)
  })
})

describe('Q-system', () => {
  it('uses 10 as the minimum RQD only inside the Q equation', () => {
    expect(calculateQ({ ja: 2, jn: 9, jr: 2, jw: 1, rqdPercent: 5, srf: 2.5 })).toBeCloseTo(0.4444, 4)
  })
})

describe('joint-set spacing summaries', () => {
  it('uses consecutive unique depths within each clustered set', () => {
    expect(summarizeJointSetSpacing([
      { depth: 1, setId: 'J1' },
      { depth: 1, setId: 'J1' },
      { depth: 3, setId: 'J1' },
      { depth: 8, setId: 'J1' },
      { depth: 2, setId: 'J2' },
    ])).toEqual([
      { count: 3, meanSpacingM: 3.5, setId: 'J1' },
      { count: 1, meanSpacingM: null, setId: 'J2' },
    ])
  })
})
