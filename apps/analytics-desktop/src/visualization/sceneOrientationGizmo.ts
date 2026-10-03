import { Euler, Quaternion, Vector3 } from 'three'

export type OrientationPreset = 'bottom' | 'east' | 'isometric' | 'north' | 'south' | 'top' | 'west'
export type OrientationQuaternion = readonly [number, number, number, number]

export interface OrientationPointerBounds {
  height: number
  left: number
  top: number
  width: number
}

export interface OrientationTilt {
  x: number
  y: number
}

export interface OrientationFaceGeometry {
  className: string
  depth: number
  facing: number
  key: Exclude<OrientationPreset, 'isometric'>
  label: string
  labelX: number
  labelY: number
  points: string
  visible: boolean
}

export interface OrientationAxisGeometry {
  depth: number
  endX: number
  endY: number
  headPoints: string | null
  key: 'x' | 'y' | 'z'
  label: 'E' | 'N' | 'RL'
  labelX: number
  labelY: number
}

export interface OrientationGizmoGeometry {
  axes: OrientationAxisGeometry[]
  faces: OrientationFaceGeometry[]
  origin: { x: number; y: number }
}

export type OrientationViewLetter = 'D' | 'E' | 'N' | 'S' | 'U' | 'W'

interface FaceDefinition {
  className: string
  key: Exclude<OrientationPreset, 'isometric'>
  label: string
  normal: readonly [number, number, number]
  vertices: readonly (keyof typeof CUBE_VERTICES)[]
}

const CUBE_VERTICES = {
  nnn: [-1, -1, -1],
  nnp: [-1, -1, 1],
  npn: [-1, 1, -1],
  npp: [-1, 1, 1],
  pnn: [1, -1, -1],
  pnp: [1, -1, 1],
  ppn: [1, 1, -1],
  ppp: [1, 1, 1],
} as const

const FACE_DEFINITIONS: readonly FaceDefinition[] = [
  { className: 'is-bottom', key: 'bottom', label: 'U', normal: [0, -1, 0], vertices: ['nnn', 'pnn', 'pnp', 'nnp'] },
  { className: 'is-west', key: 'west', label: 'W', normal: [-1, 0, 0], vertices: ['nnn', 'nnp', 'npp', 'npn'] },
  { className: 'is-north', key: 'north', label: 'N', normal: [0, 0, -1], vertices: ['nnn', 'npn', 'ppn', 'pnn'] },
  { className: 'is-east', key: 'east', label: 'E', normal: [1, 0, 0], vertices: ['pnn', 'ppn', 'ppp', 'pnp'] },
  { className: 'is-south', key: 'south', label: 'S', normal: [0, 0, 1], vertices: ['nnp', 'pnp', 'ppp', 'npp'] },
  { className: 'is-top', key: 'top', label: 'D', normal: [0, 1, 0], vertices: ['npn', 'npp', 'ppp', 'ppn'] },
]

const AXIS_DEFINITIONS = [
  { key: 'x', label: 'E', vector: [1, 0, 0] },
  { key: 'y', label: 'N', vector: [0, 0, -1] },
  { key: 'z', label: 'RL', vector: [0, 1, 0] },
] as const

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

export function orientationViewLetter(cameraQuaternion: OrientationQuaternion): OrientationViewLetter {
  const direction = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...cameraQuaternion).normalize())
  const horizontalX = Math.abs(direction.x)
  const vertical = Math.abs(direction.y)
  const horizontalZ = Math.abs(direction.z)
  if (vertical >= horizontalX && vertical >= horizontalZ) return direction.y >= 0 ? 'D' : 'U'
  if (horizontalX >= horizontalZ) return direction.x >= 0 ? 'E' : 'W'
  return direction.z >= 0 ? 'S' : 'N'
}

export function orientationTiltFromPointer(
  clientX: number,
  clientY: number,
  bounds: OrientationPointerBounds,
): OrientationTilt {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 }
  return {
    x: clamp((clientX - bounds.left) / bounds.width * 2 - 1, -1, 1),
    y: clamp((clientY - bounds.top) / bounds.height * 2 - 1, -1, 1),
  }
}

export function createOrientationGizmoGeometry(
  cameraQuaternion: OrientationQuaternion,
  hover: OrientationTilt,
): OrientationGizmoGeometry {
  const cameraInverse = new Quaternion(...cameraQuaternion).normalize().invert()
  const hoverRotation = new Quaternion().setFromEuler(new Euler(-hover.y * .14, -hover.x * .14, 0, 'XYZ'))
  const transform = (value: readonly [number, number, number]) => new Vector3(...value)
    .applyQuaternion(cameraInverse)
    .applyQuaternion(hoverRotation)
  const projected = new Map<keyof typeof CUBE_VERTICES, { x: number; y: number; z: number }>()

  Object.entries(CUBE_VERTICES).forEach(([key, value]) => {
    const point = transform(value)
    const perspective = 3.8 / (3.8 - point.z * .34)
    projected.set(key as keyof typeof CUBE_VERTICES, {
      x: 60 + point.x * 20.5 * perspective,
      y: 54 - point.y * 20.5 * perspective,
      z: point.z,
    })
  })

  const axes = AXIS_DEFINITIONS.map((axis) => {
    const direction = transform(axis.vector)
    const deltaX = direction.x * 38
    const deltaY = -direction.y * 38
    const projectedLength = Math.hypot(deltaX, deltaY)
    const labelOffsetX = projectedLength < 4 ? 5 : deltaX / projectedLength * 5
    const labelOffsetY = projectedLength < 4 ? -5 : deltaY / projectedLength * 5
    const endX = 60 + deltaX
    const endY = 54 + deltaY
    const unitX = projectedLength < 4 ? 0 : deltaX / projectedLength
    const unitY = projectedLength < 4 ? 0 : deltaY / projectedLength
    const perpendicularX = -unitY * 2.4
    const perpendicularY = unitX * 2.4
    return {
      depth: direction.z,
      endX,
      endY,
      headPoints: projectedLength < 4 ? null : [
        `${endX.toFixed(2)},${endY.toFixed(2)}`,
        `${(endX - unitX * 6 + perpendicularX).toFixed(2)},${(endY - unitY * 6 + perpendicularY).toFixed(2)}`,
        `${(endX - unitX * 6 - perpendicularX).toFixed(2)},${(endY - unitY * 6 - perpendicularY).toFixed(2)}`,
      ].join(' '),
      key: axis.key,
      label: axis.label,
      labelX: endX + labelOffsetX,
      labelY: endY + labelOffsetY,
    }
  }).sort((left, right) => left.depth - right.depth)

  const faces = FACE_DEFINITIONS.map((face) => {
    const points = face.vertices.map((vertex) => projected.get(vertex) as { x: number; y: number; z: number })
    const normal = transform(face.normal)
    return {
      className: face.className,
      depth: points.reduce((total, point) => total + point.z, 0) / points.length,
      facing: normal.z,
      key: face.key,
      label: face.label,
      labelX: points.reduce((total, point) => total + point.x, 0) / points.length,
      labelY: points.reduce((total, point) => total + point.y, 0) / points.length + 2.5,
      points: points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '),
      visible: normal.z > .025,
    }
  }).sort((left, right) => left.depth - right.depth)

  return { axes, faces, origin: { x: 60, y: 54 } }
}
