import { describe, expect, it } from 'vitest'
import { sceneBoundsForPoints, sceneHoleIsLocated, surveyGeometry } from './sceneDrillholes.js'

const collar = { holeId: 'DH-01', easting: 100, northing: 200, elevation: 500 }
describe('3D drillhole survey geometry', () => {
  it('keeps collar-only holes at their actual elevation', () => {
    expect(surveyGeometry(collar, []).trajectory).toEqual([{ x: 100, y: 200, z: 500 }])
  })
  it('matches hole spelling and renders inclined surveys beyond analysis intervals', () => {
    const geometry = surveyGeometry(collar, [{ holeId: 'dh_01', depth: 100, dip: -30, azimuth: 90 }], [20])
    expect(geometry.trajectory).toHaveLength(3)
    expect(geometry.pointAt(100).x).toBeCloseTo(100 + 100 * Math.cos(Math.PI / 6))
    expect(geometry.pointAt(100).y).toBeCloseTo(200)
    expect(geometry.pointAt(100).z).toBeCloseTo(450)
    expect(geometry.pointAt(20).z).toBeCloseTo(490)
  })
  it('integrates changes in direction and extrapolates the final station', () => {
    const geometry = surveyGeometry(collar, [
      { holeId: 'DH-01', depth: 0, dip: -90, azimuth: 0 },
      { holeId: 'DH-01', depth: 100, dip: 0, azimuth: 90 },
    ])
    expect(geometry.pointAt(100).x).toBeCloseTo(150)
    expect(geometry.pointAt(100).z).toBeCloseTo(450)
    expect(geometry.pointAt(150).x).toBeCloseTo(200)
    expect(geometry.pointAt(150).z).toBeCloseTo(450)
  })
})

describe('scene location and framing', () => {
  it('excludes unknown zero coordinates but keeps a known collar at the origin', () => {
    expect(sceneHoleIsLocated('unknown', 0, 0, [collar])).toBe(false)
    expect(sceneHoleIsLocated('dh_01', 0, 0, [collar])).toBe(true)
    expect(sceneHoleIsLocated('origin', 0, 0, [{ ...collar, holeId: 'origin', easting: 0, northing: 0 }])).toBe(true)
    expect(sceneHoleIsLocated('unknown', NaN, 200, [])).toBe(false)
  })
  it('fits actual survey points at projected coordinates without a phantom origin', () => {
    const projected = { ...collar, easting: 585358, northing: 5461553.1, elevation: 985.6 }
    const trace = surveyGeometry(projected, [{ holeId: collar.holeId, depth: 150, azimuth: 335, dip: 62 }])
    const bounds = sceneBoundsForPoints(trace.trajectory)
    expect(bounds.minX).toBeGreaterThan(585000)
    expect(bounds.minY).toBeGreaterThan(5461000)
    expect(bounds.maxX - bounds.minX).toBeLessThan(200)
    expect(trace.pointAt(150).z).toBeLessThan(projected.elevation)
    expect(trace.pointAt(150)).toEqual(surveyGeometry(projected, [{ holeId: collar.holeId, depth: 150, azimuth: 335, dip: -62 }]).pointAt(150))
  })
  it('provides finite bounds for empty and invalid geometry', () => {
    expect(Object.values(sceneBoundsForPoints([])).every(Number.isFinite)).toBe(true)
    expect(sceneBoundsForPoints([{ x: NaN, y: 1, z: 2 }])).toEqual(sceneBoundsForPoints([]))
  })
})
