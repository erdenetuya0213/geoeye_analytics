import type { SceneBounds } from './scene3dProjection.js'

export interface ScenePoint3D { x: number; y: number; z: number }

export type ThreeCameraMode = 'east' | 'isometric' | 'north' | 'plan' | 'section'
export type SceneGridDensity = 'fine' | 'medium' | 'coarse'

export interface ThreeCameraFrame {
  far: number
  near: number
  position: ScenePoint3D
  target: ScenePoint3D
  up: ScenePoint3D
}

export interface ThreeSectionFrame {
  azimuth: number
  dip: number
}

export function cameraFrameTriggerKey(
  bounds: SceneBounds,
  mode: ThreeCameraMode,
  zoom = 1,
  verticalExaggeration = 1,
  section: ThreeSectionFrame = { azimuth: 0, dip: 90 },
) {
  return [
    bounds.minX, bounds.maxX,
    bounds.minY, bounds.maxY,
    bounds.minZ, bounds.maxZ,
    mode, zoom, verticalExaggeration, section.azimuth, section.dip,
  ].join('|')
}

export interface SceneAxisExtent {
  maximum: number
  minimum: number
  sceneLength: number
}

export interface SceneAxisExtents {
  x: SceneAxisExtent
  y: SceneAxisExtent
  z: SceneAxisExtent
}

// GeoEye data uses Easting/Northing/RL. Three.js is Y-up, so north maps to -Z.
export function dataPointToThree(
  point: ScenePoint3D,
  bounds: SceneBounds,
  verticalExaggeration = 1,
): ScenePoint3D {
  const centreX = (bounds.minX + bounds.maxX) / 2
  const centreY = (bounds.minY + bounds.maxY) / 2
  const centreZ = (bounds.minZ + bounds.maxZ) / 2
  return {
    x: point.x - centreX,
    y: (point.z - centreZ) * verticalExaggeration,
    z: -(point.y - centreY),
  }
}

export function niceGridStep(span: number, targetLines = 10) {
  if (!Number.isFinite(span) || span <= 0) return 1
  const raw = span / Math.max(1, targetLines)
  const power = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / power
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return niceFraction * power
}

export function gridStepForDensity(span: number, density: SceneGridDensity) {
  const targetLines: Record<SceneGridDensity, number> = { fine: 20, medium: 10, coarse: 5 }
  return niceGridStep(span, targetLines[density])
}

export function formatGridCoordinate(value: number) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString('en-US', {
    maximumFractionDigits: 6,
    useGrouping: true,
  })
}

export function gridCoordinateValues(minimum: number, maximum: number, spacing: number, maximumLabels: number) {
  const safeSpacing = Math.max(Number.EPSILON, Math.abs(spacing))
  const first = Math.ceil(minimum / safeSpacing) * safeSpacing
  const count = Math.max(0, Math.floor((maximum - first) / safeSpacing) + 1)
  const stride = Math.max(1, Math.ceil(count / Math.max(1, maximumLabels)))
  const labelSpacing = safeSpacing * stride
  const alignedFirst = Math.ceil(minimum / labelSpacing) * labelSpacing
  const range = Math.max(1e-6, maximum - minimum)
  const values: Array<{ offset: number; value: number }> = []
  for (let value = alignedFirst; value <= maximum + labelSpacing * .001; value += labelSpacing) {
    const offset = (value - minimum) / range
    if (offset > .045 && offset < .955) values.push({ offset, value: Math.round(value * 1e6) / 1e6 })
  }
  return values
}

export function sceneAxisExtents(bounds: SceneBounds, verticalExaggeration = 1): SceneAxisExtents {
  return {
    x: { maximum: bounds.maxX, minimum: bounds.minX, sceneLength: Math.max(1, bounds.maxX - bounds.minX) },
    y: { maximum: bounds.maxY, minimum: bounds.minY, sceneLength: Math.max(1, bounds.maxY - bounds.minY) },
    z: {
      maximum: bounds.maxZ,
      minimum: bounds.minZ,
      sceneLength: Math.max(1, (bounds.maxZ - bounds.minZ) * verticalExaggeration),
    },
  }
}

export function sceneAxisTicks(minimum: number, maximum: number, segments = 4) {
  const count = Math.max(1, Math.floor(segments))
  return Array.from({ length: count }, (_, index) => {
    const ratio = (index + 1) / count
    return { ratio, value: minimum + (maximum - minimum) * ratio }
  })
}

export function cameraFrameForBounds(
  bounds: SceneBounds,
  mode: ThreeCameraMode,
  aspect: number,
  zoom = 1,
  verticalExaggeration = 1,
  section: ThreeSectionFrame = { azimuth: 0, dip: 90 },
): ThreeCameraFrame {
  const sizeX = Math.max(1, bounds.maxX - bounds.minX)
  const sizeY = Math.max(1, (bounds.maxZ - bounds.minZ) * verticalExaggeration)
  const sizeZ = Math.max(1, bounds.maxY - bounds.minY)
  const radius = Math.hypot(sizeX, sizeY, sizeZ) / 2
  const verticalFov = 50 * Math.PI / 180
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(.1, aspect))

  let direction = { x: 1, y: .72, z: 1.08 }
  let up = { x: 0, y: 1, z: 0 }
  if (mode === 'plan') {
    direction = { x: 0, y: 1, z: 0 }
    up = { x: 0, y: 0, z: -1 }
  } else if (mode === 'north') {
    direction = { x: 0, y: 0, z: -1 }
  } else if (mode === 'east') {
    direction = { x: 1, y: 0, z: 0 }
  } else if (mode === 'section') {
    const azimuth = section.azimuth * Math.PI / 180
    const dip = Math.abs(section.dip) * Math.PI / 180
    const dipSign = section.dip < 0 ? -1 : 1
    direction = {
      x: Math.cos(azimuth) * Math.sin(dip),
      y: Math.cos(dip) * dipSign,
      z: Math.sin(azimuth) * Math.sin(dip),
    }
  }
  const magnitude = Math.hypot(direction.x, direction.y, direction.z) || 1
  const unit = { x: direction.x / magnitude, y: direction.y / magnitude, z: direction.z / magnitude }
  const upMagnitude = Math.hypot(up.x, up.y, up.z) || 1
  let normalizedUp = { x: up.x / upMagnitude, y: up.y / upMagnitude, z: up.z / upMagnitude }
  const upAlignment = unit.x * normalizedUp.x + unit.y * normalizedUp.y + unit.z * normalizedUp.z
  if (Math.abs(upAlignment) > .98) {
    up = { x: 0, y: 0, z: -1 }
    normalizedUp = up
  }
  const rawRight = {
    x: unit.y * normalizedUp.z - unit.z * normalizedUp.y,
    y: unit.z * normalizedUp.x - unit.x * normalizedUp.z,
    z: unit.x * normalizedUp.y - unit.y * normalizedUp.x,
  }
  const rightMagnitude = Math.hypot(rawRight.x, rawRight.y, rawRight.z) || 1
  const right = { x: rawRight.x / rightMagnitude, y: rawRight.y / rightMagnitude, z: rawRight.z / rightMagnitude }
  const viewUp = {
    x: right.y * unit.z - right.z * unit.y,
    y: right.z * unit.x - right.x * unit.z,
    z: right.x * unit.y - right.y * unit.x,
  }
  const halfExtents = { x: sizeX / 2, y: sizeY / 2, z: sizeZ / 2 }
  const tanHalfHorizontal = Math.max(.08, Math.tan(horizontalFov / 2))
  const tanHalfVertical = Math.max(.08, Math.tan(verticalFov / 2))
  let maximumDepth = 0
  let fitDistance = 0
  for (const x of [-halfExtents.x, halfExtents.x]) {
    for (const y of [-halfExtents.y, halfExtents.y]) {
      for (const z of [-halfExtents.z, halfExtents.z]) {
        const depth = x * unit.x + y * unit.y + z * unit.z
        const horizontal = Math.abs(x * right.x + y * right.y + z * right.z)
        const vertical = Math.abs(x * viewUp.x + y * viewUp.y + z * viewUp.z)
        maximumDepth = Math.max(maximumDepth, depth)
        fitDistance = Math.max(
          fitDistance,
          depth + horizontal / tanHalfHorizontal,
          depth + vertical / tanHalfVertical,
        )
      }
    }
  }
  const distance = maximumDepth
    + Math.max(1, fitDistance - maximumDepth) * 1.12 / Math.max(.25, zoom)
  return {
    far: Math.max(10_000, distance * 20 + radius * 10),
    near: Math.max(.1, Math.min(10, distance / 2_000)),
    position: { x: unit.x * distance, y: unit.y * distance, z: unit.z * distance },
    target: { x: 0, y: 0, z: 0 },
    up,
  }
}
