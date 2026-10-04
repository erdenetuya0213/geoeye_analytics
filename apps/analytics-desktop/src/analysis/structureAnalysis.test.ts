import { describe, expect, it } from 'vitest'
import { analyzeStructure, convertAlphaBeta, interpolateSurvey } from './structureAnalysis.js'
import {
  fallbackStructureCollars,
  fallbackStructureSurveys,
  fieldStructureObservations,
} from '../data/structureDemo.js'

describe('structure analysis', () => {
  it('interpolates the downhole survey continuously', () => {
    const orientation = interpolateSurvey(fallbackStructureSurveys, 75)
    expect(orientation).toBeDefined()
    expect(orientation?.azimuth).toBeGreaterThan(44.3)
    expect(orientation?.azimuth).toBeLessThan(45.5)
    expect(orientation?.dip).toBeGreaterThan(-60.4)
    expect(orientation?.dip).toBeLessThan(-59.6)
  })

  it('converts alpha and beta to a valid true orientation', () => {
    const result = convertAlphaBeta(42, 282, 42.6, -62)
    expect(result.trueDip).toBeGreaterThanOrEqual(0)
    expect(result.trueDip).toBeLessThanOrEqual(90)
    expect(result.dipDirection).toBeGreaterThanOrEqual(0)
    expect(result.dipDirection).toBeLessThan(360)
  })

  it('treats signed-down dip and positive-down inclination as the same survey orientation', () => {
    const signedDip = convertAlphaBeta(42, 282, 42.6, -62)
    const positiveInclination = convertAlphaBeta(42, 282, 42.6, 62)

    expect(positiveInclination.trueDip).toBeCloseTo(signedDip.trueDip, 10)
    expect(positiveInclination.dipDirection).toBeCloseTo(signedDip.dipDirection, 10)
  })

  it('calculates all complete Field observations and clusters J1 to J3', () => {
    const result = analyzeStructure(fieldStructureObservations, fallbackStructureCollars, fallbackStructureSurveys)
    expect(fieldStructureObservations).toHaveLength(200)
    expect(result.points).toHaveLength(200)
    expect(result.rejected).toBe(0)
    expect(result.jointSets).toHaveLength(3)
    expect(result.jointSets.reduce((sum, set) => sum + set.count, 0)).toBe(200)
    expect(new Set(result.points.map((point) => point.setId))).toEqual(new Set(['J1', 'J2', 'J3']))
    expect(result.points.every((point) => point.x >= 6 && point.x <= 94 && point.y >= 6 && point.y <= 94)).toBe(true)
    expect(result.points.filter((point) => point.structureType === 'joint')).toHaveLength(18)
    expect(result.points.filter((point) => point.structureType === 'fz-top')).toHaveLength(4)
    expect(result.points.filter((point) => point.structureType === 'fz-bottom')).toHaveLength(5)
    expect(result.points.filter((point) => point.structureType === 'fault')).toHaveLength(1)
  })

  it('rejects observations without matching survey support', () => {
    const result = analyzeStructure(fieldStructureObservations.slice(0, 3), [], [])
    expect(result.points).toHaveLength(0)
    expect(result.rejected).toBe(3)
  })

  it('matches locally imported surveys despite hole-id separators and does not require a collar', () => {
    const observation = {
      ...fieldStructureObservations[0]!,
      holeId: 'TT_2026_002GT',
    }
    const result = analyzeStructure([observation], [], [
      { azimuth: 42.6, depth: 0, dip: -62, holeId: 'TT2026-002-GT' },
      { azimuth: 43.4, depth: 30, dip: -61.2, holeId: 'TT2026-002-GT' },
    ])

    expect(result.points).toHaveLength(1)
    expect(result.points[0]).toMatchObject({ holeId: 'TT_2026_002GT', setId: 'J1' })
    expect(result.rejected).toBe(0)
  })
})
