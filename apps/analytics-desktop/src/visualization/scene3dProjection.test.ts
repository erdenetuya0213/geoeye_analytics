import { describe, expect, it } from 'vitest'
import { projectScenePoint, sceneCollarRenderPoint, sceneElevation, type SceneBounds } from './scene3dProjection.js'

const bounds: SceneBounds = { maxX: 100, maxY: 100, maxZ: 100, minX: 0, minY: 0, minZ: 0 }

describe('scene 3D projection', () => {
  it('keeps the scene centre fixed in plan view', () => {
    expect(projectScenePoint({ x: 50, y: 50, z: 30 }, bounds, 'plan')).toEqual({ x: 500, y: 335 })
  })

  it('projects elevation upward in isometric view', () => {
    const low = projectScenePoint({ x: 50, y: 50, z: 10 }, bounds, 'isometric')
    const high = projectScenePoint({ x: 50, y: 50, z: 90 }, bounds, 'isometric')
    expect(high.y).toBeLessThan(low.y)
    expect(high.x).toBe(low.x)
  })

  it('converts downhole depth to elevation below the collar datum', () => {
    expect(sceneElevation(1_650, 125)).toBe(1_525)
  })

  it('anchors the rendered collar to the first available interval', () => {
    const sourceCollar = { x: 499_135, y: 4_768_168, z: 1_428 }
    const firstIntervalStart = { x: 499_140.7, y: 4_768_170.1, z: 1_404 }

    expect(sceneCollarRenderPoint(sourceCollar, firstIntervalStart)).toBe(firstIntervalStart)
    expect(sceneCollarRenderPoint(sourceCollar)).toBe(sourceCollar)
  })
})
