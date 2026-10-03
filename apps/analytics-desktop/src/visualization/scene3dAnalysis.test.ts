import { describe, expect, it } from 'vitest'
import type { EdaObservation } from '../analysis/eda.js'
import {
  anchoredSelection,
  createSavedSceneSelection,
  extractStructureObservations,
  numericClassBreaks,
  sectionCorridorState,
  structureDiscGeometry,
  uniqueSourceObservationIds,
} from './scene3dAnalysis.js'

const row = (overrides: Partial<EdaObservation> = {}): EdaObservation => ({
  depthFrom: 10,
  depthTo: 14,
  dimensions: { lithology: 'Diorite' },
  easting: 500,
  holeId: 'DD-01',
  id: 'row-1',
  joinKey: 'DD-01:10:14',
  lithology: 'Diorite',
  northing: 1_000,
  sampleId: 'S-1',
  sourceObservationId: 'source-1',
  values: {},
  ...overrides,
})

describe('3D analysis helpers', () => {
  it('classifies observations inside and outside an asymmetric section corridor', () => {
    const section = { azimuth: 0, back: 20, centreX: 500, centreY: 1_000, corridor: 40, front: 10 }
    expect(sectionCorridorState(row({ easting: 507 }), section).side).toBe('inside')
    expect(sectionCorridorState(row({ easting: 515 }), section).side).toBe('front')
    expect(sectionCorridorState(row({ easting: 475 }), section).side).toBe('back')
  })

  it('uses elevation when clipping a dipping or plan section', () => {
    const plan = { azimuth: 0, back: 5, centreX: 500, centreY: 1_000, centreZ: 1_500, corridor: 10, dip: 0, front: 5 }
    expect(sectionCorridorState(row({ easting: 900 }), plan, 1_503).inside).toBe(true)
    expect(sectionCorridorState(row({ easting: 500 }), plan, 1_512).side).toBe('front')
  })

  it('builds deterministic equal, quantile, and custom legend breaks', () => {
    expect(numericClassBreaks([0, 10], 'equal', 2)).toEqual([0, 5, 10])
    expect(numericClassBreaks([0, 1, 2, 100], 'quantile', 2)).toEqual([0, 2, 100])
    expect(numericClassBreaks([0, 1], 'custom', 5, [5, 1, 5, 3])).toEqual([1, 3, 5])
  })

  it('preserves unique source IDs through analytical selections and saved selections', () => {
    const joined = row({ sourceObservationIds: ['source-1', 'source-2'] })
    const neighbour = row({ id: 'row-2', sourceObservationId: 'source-3', depthFrom: 18 })
    expect(uniqueSourceObservationIds([joined, neighbour])).toEqual(['source-1', 'source-2', 'source-3'])
    expect(anchoredSelection([joined, neighbour], joined, 'rectangle')).toEqual(['source-1', 'source-2', 'source-3'])
    expect(createSavedSceneSelection('Low RMR', [joined], 'RMR76 < 40', '2026-10-01T00:00:00.000Z')).toMatchObject({
      expression: 'RMR76 < 40',
      label: 'Low RMR',
      sourceObservationIds: ['source-1', 'source-2'],
    })
  })

  it('extracts true-orientation structures at XYZ and scales discs by persistence', () => {
    const structureRow = row({
      dimensions: { joint_set: 'J2', structure_type: 'fault' },
      values: { 'structure.dip_direction': 120, 'structure.persistence': 4, 'structure.true_dip': 60 },
    })
    const structures = extractStructureObservations([structureRow], () => 1_520)
    expect(structures[0]).toMatchObject({ dipDirection: 120, jointSet: 'J2', kind: 'fault', trueDip: 60, x: 500, y: 1_000, z: 1_520 })
    const geometry = structureDiscGeometry(structures[0]!)
    expect(geometry).toMatchObject({ rotation: 120, rx: 16 })
    expect(geometry.ry).toBeCloseTo(8)
  })
})
