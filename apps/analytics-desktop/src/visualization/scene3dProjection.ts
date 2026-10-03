export type SceneViewMode = 'plan' | 'isometric'

export interface SceneBounds {
  maxX: number
  maxY: number
  maxZ: number
  minX: number
  minY: number
  minZ: number
}

export interface ScenePoint3D {
  x: number
  y: number
  z: number
}

export interface ScreenPoint {
  x: number
  y: number
}

function normalized(value: number, minimum: number, maximum: number) {
  return (value - minimum) / Math.max(1, maximum - minimum)
}

export function projectScenePoint(point: ScenePoint3D, bounds: SceneBounds, mode: SceneViewMode): ScreenPoint {
  const x = normalized(point.x, bounds.minX, bounds.maxX) - .5
  const y = normalized(point.y, bounds.minY, bounds.maxY) - .5
  const z = normalized(point.z, bounds.minZ, bounds.maxZ)

  if (mode === 'plan') {
    return { x: 500 + x * 790, y: 335 - y * 510 }
  }

  return {
    x: 500 + x * 600 - y * 220,
    y: 435 + (x + y) * 165 - z * 300,
  }
}

export function sceneElevation(collarElevation: number, depth: number) {
  return collarElevation - depth
}

export function sceneCollarRenderPoint(collar: ScenePoint3D, firstIntervalStart?: ScenePoint3D) {
  return firstIntervalStart ?? collar
}
