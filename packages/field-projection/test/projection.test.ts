import { describe, expect, it } from 'vitest'
import { CORE_VARIABLES, VariableRegistry } from '@geoeye/variable-registry'
import {
  projectFieldLoggingStructure,
  type FieldLoggingStructure,
  type FieldProjectionBinding,
} from '../src/index.js'

const registry = new VariableRegistry(CORE_VARIABLES)
const bindings: FieldProjectionBinding[] = [
  { variableKey: 'structure.alpha', source: { kind: 'selection', key: 'alpha' } },
  { variableKey: 'structure.beta', source: { kind: 'selection', key: 'beta' } },
  { variableKey: 'joint.aperture', source: { kind: 'selection', key: 'aperture' } },
  { variableKey: 'joint.roughness', source: { kind: 'selection', key: 'roughness' } },
  { variableKey: 'structure.apparent_angle', source: { kind: 'column', column: 'angleDeg' } },
  { variableKey: 'structure.type', source: { kind: 'column', column: 'structureType' } },
]

const source: FieldLoggingStructure = {
  id: 'structure-1',
  projectId: '11111111-1111-4111-8111-111111111111',
  holeId: '22222222-2222-4222-8222-222222222222',
  rowId: 'row-1',
  depthFrom: 27.73,
  depthTo: 27.74,
  angleDeg: 41.5,
  structureType: 'joint',
  selectionsJson: JSON.stringify({
    alpha: '38',
    beta: '126',
    aperture: '0.2',
    roughness: 'Rough',
  }),
  reviewStatus: 'accepted',
  updatedAt: '2026-09-29T08:00:00.000Z',
}

describe('projectFieldLoggingStructure', () => {
  it('normalizes accepted Field JSONB selections without changing the source model', () => {
    const result = projectFieldLoggingStructure(source, bindings, registry, {
      datasetId: '33333333-3333-4333-8333-333333333333',
      datasetVersionId: '44444444-4444-4444-8444-444444444444',
    })

    expect(result.issues).toEqual([])
    expect(result.observations).toHaveLength(6)
    expect(result.observations.find((item) => item.variableKey === 'structure.alpha')).toMatchObject({
      numericValue: 38,
      unit: 'deg',
      quality: 'accepted',
      sourceType: 'field.logging_structure',
    })
    expect(result.observations.find((item) => item.variableKey === 'joint.roughness')).toMatchObject({
      categoryValue: 'Rough',
      numericValue: null,
    })
    expect(result.observations.find((item) => item.variableKey === 'structure.type')).toMatchObject({
      categoryValue: 'joint',
      numericValue: null,
    })
  })

  it('does not publish draft Field observations by default', () => {
    const result = projectFieldLoggingStructure(
      { ...source, reviewStatus: 'draft' },
      bindings,
      registry,
      {
        datasetId: '33333333-3333-4333-8333-333333333333',
        datasetVersionId: null,
      },
    )

    expect(result.observations).toEqual([])
    expect(result.issues[0]?.code).toBe('unaccepted_source')
  })

  it('reports invalid numeric values instead of silently coercing them', () => {
    const result = projectFieldLoggingStructure(
      { ...source, selectionsJson: { alpha: 'not-a-number' } },
      [bindings[0]!],
      registry,
      {
        datasetId: '33333333-3333-4333-8333-333333333333',
        datasetVersionId: null,
      },
    )

    expect(result.observations).toEqual([])
    expect(result.issues[0]?.code).toBe('invalid_value')
  })
})
