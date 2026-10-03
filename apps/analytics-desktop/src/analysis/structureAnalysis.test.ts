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

  it('rejects observations without matching collar and survey support', () => {
    const result = analyzeStructure(fieldStructureObservations.slice(0, 3), [], [])
    expect(result.points).toHaveLength(0)
    expect(result.rejected).toBe(3)
  })
})
