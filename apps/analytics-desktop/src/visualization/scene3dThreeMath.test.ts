import { describe, expect, it } from 'vitest'
import {
  cameraFrameForBounds,
  cameraFrameTriggerKey,
  dataPointToThree,
  formatGridCoordinate,
  gridCoordinateValues,
  gridStepForDensity,
  niceGridStep,
  sceneAxisExtents,
  sceneAxisTicks,
} from './scene3dThreeMath.js'

const bounds = { maxX: 200, maxY: 500, maxZ: 80, minX: 100, minY: 300, minZ: 20 }

describe('Three.js scene coordinates', () => {
  it('keeps the camera frame trigger stable when equivalent bounds are recreated', () => {
    const trigger = cameraFrameTriggerKey(bounds, 'isometric', 1, 1, { azimuth: 0, dip: 90 })

    expect(cameraFrameTriggerKey({ ...bounds }, 'isometric', 1, 1, { azimuth: 0, dip: 90 })).toBe(trigger)
    expect(cameraFrameTriggerKey({ ...bounds, maxX: bounds.maxX + 1 }, 'isometric', 1, 1, { azimuth: 0, dip: 90 })).not.toBe(trigger)
    expect(cameraFrameTriggerKey(bounds, 'plan', 1, 1, { azimuth: 0, dip: 90 })).not.toBe(trigger)
  })

  it('centres Easting/Northing/RL data in a Y-up scene', () => {
    expect(dataPointToThree({ x: 150, y: 400, z: 50 }, bounds, 2)).toEqual({ x: 0, y: 0, z: -0 })
    expect(dataPointToThree({ x: 200, y: 500, z: 80 }, bounds, 2)).toEqual({ x: 50, y: 60, z: -100 })
  })

  it('chooses stable human-scale grid spacing', () => {
    expect(niceGridStep(840)).toBe(100)
    expect(niceGridStep(42)).toBe(5)
    expect(niceGridStep(0)).toBe(1)
  })

  it('offers fine, medium and coarse grid density in increasing spacing', () => {
    const fine = gridStepForDensity(840, 'fine')
    const medium = gridStepForDensity(840, 'medium')
    const coarse = gridStepForDensity(840, 'coarse')
    expect(fine).toBeLessThan(medium)
    expect(medium).toBeLessThan(coarse)
  })

  it('creates aligned coordinate labels without overcrowding the viewport', () => {
    const values = gridCoordinateValues(498_930, 499_410, 50, 6)

    expect(values.map((tick) => tick.value)).toEqual([499_000, 499_100, 499_200, 499_300])
    expect(values.every((tick) => tick.offset > 0 && tick.offset < 1)).toBe(true)
  })

  it('formats grid coordinates with their complete value', () => {
    expect(formatGridCoordinate(499_100)).toBe('499,100')
    expect(formatGridCoordinate(4_768_200)).toBe('4,768,200')
    expect(formatGridCoordinate(499_100.25)).toBe('499,100.25')
  })

  it('sizes axes to the complete scene bounds and applies vertical exaggeration only to Z', () => {
    expect(sceneAxisExtents(bounds, 2)).toEqual({
      x: { maximum: 200, minimum: 100, sceneLength: 100 },
      y: { maximum: 500, minimum: 300, sceneLength: 200 },
      z: { maximum: 80, minimum: 20, sceneLength: 120 },
    })
  })

  it('places coordinate ticks across the full axis including its maximum', () => {
    expect(sceneAxisTicks(100, 200, 4)).toEqual([
      { ratio: .25, value: 125 },
      { ratio: .5, value: 150 },
      { ratio: .75, value: 175 },
      { ratio: 1, value: 200 },
    ])
  })

  it('frames plan and section cameras on different axes', () => {
    const plan = cameraFrameForBounds(bounds, 'plan', 16 / 9)
    const section = cameraFrameForBounds(bounds, 'section', 16 / 9, 1, 1, { azimuth: 90, dip: 90 })
    expect(plan.position.x).toBe(0)
    expect(plan.position.y).toBeGreaterThan(0)
    expect(plan.up).toEqual({ x: 0, y: 0, z: -1 })
    expect(section.position.z).toBeGreaterThan(0)
    expect(Math.abs(section.position.y)).toBeLessThan(.001)
  })

  it('frames the additional Dispatch split panes from north and east', () => {
    const north = cameraFrameForBounds(bounds, 'north', 1)
    const east = cameraFrameForBounds(bounds, 'east', 1)
    expect(north.position.z).toBeLessThan(0)
    expect(Math.abs(north.position.x)).toBeLessThan(.001)
    expect(east.position.x).toBeGreaterThan(0)
    expect(Math.abs(east.position.z)).toBeLessThan(.001)
  })

  it('fits each orthogonal view to its own projected bounds and pane aspect', () => {
    const deepBounds = { maxX: 200, maxY: 10_300, maxZ: 80, minX: 100, minY: 300, minZ: 20 }
    const northWide = cameraFrameForBounds(deepBounds, 'north', 2)
    const northNarrow = cameraFrameForBounds(deepBounds, 'north', .5)
    const plan = cameraFrameForBounds(deepBounds, 'plan', 2)
    const distance = (frame: typeof northWide) => Math.hypot(frame.position.x, frame.position.y, frame.position.z)

    expect(distance(northNarrow)).toBeGreaterThan(distance(northWide))
    expect(distance(northWide)).toBeLessThan(distance(plan))
  })
})
