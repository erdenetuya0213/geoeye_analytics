import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { createOrientationGizmoGeometry, orientationTiltFromPointer, orientationViewLetter } from './sceneOrientationGizmo.js'

describe('scene orientation gizmo', () => {
  it('normalizes and clamps cursor position for the live tilt', () => {
    const bounds = { height: 100, left: 20, top: 10, width: 200 }
    expect(orientationTiltFromPointer(120, 60, bounds)).toEqual({ x: 0, y: 0 })
    expect(orientationTiltFromPointer(500, -20, bounds)).toEqual({ x: 1, y: -1 })
  })

  it('projects the world-facing cube side from the camera quaternion', () => {
    const identity = createOrientationGizmoGeometry([0, 0, 0, 1], { x: 0, y: 0 })
    expect(identity.faces.find((face) => face.key === 'south')?.visible).toBe(true)
    expect(identity.faces.find((face) => face.key === 'south')?.facing).toBeCloseTo(1)
    expect(identity.faces.find((face) => face.key === 'north')?.visible).toBe(false)

    const turned = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI)
    const rotated = createOrientationGizmoGeometry([turned.x, turned.y, turned.z, turned.w], { x: 0, y: 0 })
    expect(rotated.faces.find((face) => face.key === 'north')?.visible).toBe(true)
    expect(rotated.faces.find((face) => face.key === 'south')?.visible).toBe(false)
  })

  it('changes the projected cube continuously with cursor tilt', () => {
    const still = createOrientationGizmoGeometry([0, 0, 0, 1], { x: 0, y: 0 })
    const tilted = createOrientationGizmoGeometry([0, 0, 0, 1], { x: .75, y: -.5 })
    expect(tilted.faces.map((face) => face.points)).not.toEqual(still.faces.map((face) => face.points))
  })

  it('projects the scene Easting, Northing and RL axes with the cube', () => {
    const geometry = createOrientationGizmoGeometry([0, 0, 0, 1], { x: 0, y: 0 })
    expect(Object.fromEntries(geometry.axes.map((axis) => [axis.key, axis.label]))).toEqual({ x: 'E', y: 'N', z: 'RL' })
    expect(geometry.axes.find((axis) => axis.key === 'x')?.endX).toBeGreaterThan(geometry.origin.x)
    expect(geometry.axes.find((axis) => axis.key === 'z')?.endY).toBeLessThan(geometry.origin.y)
  })

  it('tilts toward the cursor and exposes the shortcut letters on cube faces', () => {
    const right = createOrientationGizmoGeometry([0, 0, 0, 1], { x: 1, y: 0 })
    expect(right.faces.find((face) => face.key === 'east')?.visible).toBe(true)
    expect(right.faces.find((face) => face.key === 'west')?.visible).toBe(false)
    expect(Object.fromEntries(right.faces.map((face) => [face.key, face.label]))).toMatchObject({
      bottom: 'U', east: 'E', north: 'N', south: 'S', top: 'D', west: 'W',
    })
  })

  it('shows the nearest current view letter instead of an isometric marker', () => {
    const forDirection = (x: number, y: number, z: number) => {
      const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(x, y, z))
      return orientationViewLetter([quaternion.x, quaternion.y, quaternion.z, quaternion.w])
    }
    expect(forDirection(0, 1, 0)).toBe('D')
    expect(forDirection(0, -1, 0)).toBe('U')
    expect(forDirection(1, 0, 0)).toBe('E')
    expect(forDirection(-1, 0, 0)).toBe('W')
    expect(forDirection(0, 0, -1)).toBe('N')
    expect(forDirection(0, 0, 1)).toBe('S')
  })
})
