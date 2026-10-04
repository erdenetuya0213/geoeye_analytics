import { describe, expect, it } from 'vitest'
import {
  buildRmr76SourceSignature,
  calculateRmr76Intervals,
  DeterministicCalculator,
  InputResolver,
  RMR76_METHOD_DEFINITION,
  type GeotechnicalInterval,
  type InputCandidate,
  type Rmr76CanonicalInputKey,
} from './geotechnicalWorkflow.js'

const sourceIds = new Set(['direct', 'derived', 'fallback', 'structure'])

function candidate(
  canonicalKey: Rmr76CanonicalInputKey,
  value: unknown,
  availability: InputCandidate['availability'],
  sourceTemplateId: string = availability,
): InputCandidate {
  return {
    availability,
    canonicalKey,
    observationId: `${sourceTemplateId}-${canonicalKey}`,
    sourceFieldId: `${canonicalKey}.field`,
    sourceLabel: sourceTemplateId,
    sourceTemplateId,
    value,
  }
}

function completeInterval(overrides: Partial<GeotechnicalInterval> = {}): GeotechnicalInterval {
  return {
    candidates: [
      candidate('geotech.ucs', 120, 'direct'),
      candidate('geotech.rqd', 90, 'direct'),
      candidate('structure.joint_spacing', 1.2, 'derived', 'structure'),
      candidate('geotech.joint_condition', 'slightly-rough-hard-wall', 'direct'),
      candidate('geotech.groundwater', 'moist', 'direct'),
      candidate('structure.orientation_rating', { excavationType: 'tunnel', orientation: 'fair' }, 'derived', 'structure'),
    ],
    depthFrom: 10,
    depthTo: 20,
    holeId: 'DH-1',
    id: 'DH-1-10-20',
    lithology: 'Granite',
    ...overrides,
  }
}

describe('RMR76 canonical input resolver', () => {
  it('uses direct, derived, then fallback priority independent of candidate order', () => {
    const interval = completeInterval({
      candidates: [
        candidate('geotech.ucs', 35, 'fallback'),
        candidate('geotech.ucs', 75, 'derived'),
        candidate('geotech.ucs', 125, 'direct'),
        ...completeInterval().candidates.filter((item) => item.canonicalKey !== 'geotech.ucs'),
      ],
    })
    const resolved = new InputResolver().resolve(interval, sourceIds)
    expect(resolved.inputs['geotech.ucs']).toMatchObject({ availability: 'direct', value: 125 })
  })

  it('accepts mapped numeric component ratings in their documented ranges', () => {
    const interval = completeInterval({
      candidates: completeInterval().candidates.map((item) => {
        if (item.canonicalKey === 'geotech.joint_condition') return { ...item, value: 12 }
        if (item.canonicalKey === 'geotech.groundwater') return { ...item, value: 4 }
        if (item.canonicalKey === 'structure.orientation_rating') return { ...item, value: -7 }
        return item
      }),
    })
    const result = calculateRmr76Intervals([interval], sourceIds, 'run-ratings', '2026-10-01T00:00:00.000Z').intervals[0]
    expect(result?.calculation).toMatchObject({ orientationAdjustment: -7, total: 66 })
  })

  it('reports a canonical variable as missing when no selected source provides it', () => {
    const selected = new Set(['direct', 'derived', 'fallback'])
    const resolved = new InputResolver().resolve(completeInterval(), selected)
    expect(resolved.missing).toEqual(['structure.joint_spacing', 'structure.orientation_rating'])
    expect(resolved.inputs['structure.orientation_rating'].availability).toBe('missing')
  })
})

describe('RMR76 interval workflow', () => {
  it('applies the orientation adjustment and final class deterministically', () => {
    const run = calculateRmr76Intervals([completeInterval()], sourceIds, 'run-1', '2026-10-01T00:00:00.000Z')
    expect(run.intervals[0]?.calculation).toMatchObject({
      basic: 84,
      classification: 'Class II · good',
      orientationAdjustment: -5,
      total: 79,
    })
  })

  it('excludes intervals before publishing a result', () => {
    const interval = completeInterval({ exclusionReason: 'Core loss exceeds threshold' })
    const result = calculateRmr76Intervals([interval], sourceIds, 'run-2', '2026-10-01T00:00:00.000Z').intervals[0]
    expect(result).toMatchObject({ calculation: null, exclusionReason: 'Core loss exceeds threshold', status: 'excluded' })
  })

  it('keeps incomplete intervals visible but does not calculate a total', () => {
    const interval = completeInterval({ candidates: completeInterval().candidates.filter((item) => item.canonicalKey !== 'geotech.groundwater') })
    const result = calculateRmr76Intervals([interval], sourceIds, 'run-3', '2026-10-01T00:00:00.000Z').intervals[0]
    expect(result?.status).toBe('missing')
    expect(result?.calculation).toBeNull()
    expect(result?.missing).toContain('geotech.groundwater')
  })

  it('reproduces identical engineering output and source signatures', () => {
    const intervals = [completeInterval()]
    const first = calculateRmr76Intervals(intervals, sourceIds, 'run-a', '2026-10-01T00:00:00.000Z')
    const second = calculateRmr76Intervals(intervals, sourceIds, 'run-b', '2026-10-02T00:00:00.000Z')
    expect(first.sourceSignature).toBe(second.sourceSignature)
    expect(first.intervals).toEqual(second.intervals)
    expect(buildRmr76SourceSignature(intervals, sourceIds)).toBe(first.sourceSignature)
  })

  it('does not calculate a method when resolved inputs remain missing', () => {
    const resolved = new InputResolver().resolve(completeInterval(), new Set())
    expect(new DeterministicCalculator().calculate(RMR76_METHOD_DEFINITION, resolved)).toBeNull()
  })
})
