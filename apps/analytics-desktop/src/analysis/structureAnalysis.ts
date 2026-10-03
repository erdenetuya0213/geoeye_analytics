export interface CollarRecord {
  elevation: number
  easting: number
  holeId: string
  northing: number
}

export interface SurveyStation {
  azimuth: number
  depth: number
  dip: number
  holeId: string
}

export type StructureTypeId = 'fault' | 'fz-bottom' | 'fz-top' | 'joint' | 'unclassified'

export interface StructureObservation {
  alpha: number
  beta: number
  depth: number
  holeId: string
  id: string
  structureType: StructureTypeId
}

export interface StructurePoint extends StructureObservation {
  dipDirection: number
  setId: string
  trueDip: number
  x: number
  y: number
}

export interface JointSetResult {
  color: string
  count: number
  dip: number
  direction: number
  id: string
}

export interface StructureAnalysisResult {
  jointSets: JointSetResult[]
  points: StructurePoint[]
  rejected: number
}

const setColors = ['#e1843f', '#31968b', '#7a68a6'] as const
const radians = (degrees: number) => degrees * Math.PI / 180
const degrees = (value: number) => value * 180 / Math.PI
const clamp = (value: number, min = -1, max = 1) => Math.max(min, Math.min(max, value))
const normalizeAngle = (value: number) => (value % 360 + 360) % 360

type Vector = readonly [number, number, number]

function add(a: Vector, b: Vector): Vector {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scale(vector: Vector, factor: number): Vector {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor]
}

function dot(a: Vector, b: Vector) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vector, b: Vector): Vector {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function normalize(vector: Vector): Vector {
  const length = Math.sqrt(dot(vector, vector))
  return length < 1e-9 ? [0, 0, 1] : scale(vector, 1 / length)
}

function holeVector(azimuth: number, dip: number): Vector {
  const azimuthRadians = radians(azimuth)
  const dipRadians = radians(dip)
  return normalize([
    Math.cos(dipRadians) * Math.sin(azimuthRadians),
    Math.cos(dipRadians) * Math.cos(azimuthRadians),
    Math.sin(dipRadians),
  ])
}

function vectorToHoleOrientation(vector: Vector) {
  const normalized = normalize(vector)
  return {
    azimuth: normalizeAngle(degrees(Math.atan2(normalized[0], normalized[1]))),
    dip: degrees(Math.asin(clamp(normalized[2]))),
  }
}

function slerp(a: Vector, b: Vector, ratio: number): Vector {
  const angle = Math.acos(clamp(dot(a, b)))
  if (angle < 1e-7) return normalize(add(scale(a, 1 - ratio), scale(b, ratio)))
  const denominator = Math.sin(angle)
  return normalize(add(
    scale(a, Math.sin((1 - ratio) * angle) / denominator),
    scale(b, Math.sin(ratio * angle) / denominator),
  ))
}

export function interpolateSurvey(stations: readonly SurveyStation[], depth: number) {
  const sorted = [...stations].sort((a, b) => a.depth - b.depth)
  const first = sorted[0]
  const last = sorted.at(-1)
  if (first === undefined || last === undefined) return undefined
  if (depth <= first.depth) return { azimuth: first.azimuth, dip: first.dip }
  if (depth >= last.depth) return { azimuth: last.azimuth, dip: last.dip }

  const upperIndex = sorted.findIndex((station) => station.depth >= depth)
  const upper = sorted[upperIndex]
  const lower = sorted[upperIndex - 1]
  if (upper === undefined || lower === undefined) return undefined
  const ratio = (depth - lower.depth) / (upper.depth - lower.depth)
  return vectorToHoleOrientation(slerp(
    holeVector(lower.azimuth, lower.dip),
    holeVector(upper.azimuth, upper.dip),
    ratio,
  ))
}

export function convertAlphaBeta(alpha: number, beta: number, holeAzimuth: number, holeDip: number) {
  const hole = holeVector(holeAzimuth, holeDip)
  const globalUp: Vector = [0, 0, 1]
  const highSideCandidate = add(globalUp, scale(hole, -dot(globalUp, hole)))
  const highSide = dot(highSideCandidate, highSideCandidate) < 1e-8 ? [0, 1, 0] as const : normalize(highSideCandidate)
  const right = normalize(cross(hole, highSide))
  const normalFromHole = radians(90 - alpha)
  const betaRadians = radians(beta)
  const radial = add(scale(highSide, Math.cos(betaRadians)), scale(right, Math.sin(betaRadians)))
  let normal = normalize(add(scale(hole, Math.cos(normalFromHole)), scale(radial, Math.sin(normalFromHole))))
  if (normal[2] < 0) normal = scale(normal, -1)

  const trueDip = degrees(Math.acos(clamp(normal[2], 0, 1)))
  const dipDirection = normalizeAngle(degrees(Math.atan2(normal[0], normal[1])))
  return { dipDirection, normal, trueDip }
}

function normalFromOrientation(dipDirection: number, trueDip: number): Vector {
  const direction = radians(dipDirection)
  const dip = radians(trueDip)
  return normalize([
    Math.sin(dip) * Math.sin(direction),
    Math.sin(dip) * Math.cos(direction),
    Math.cos(dip),
  ])
}

function orientationFromNormal(normal: Vector) {
  const up = normal[2] < 0 ? scale(normal, -1) : normal
  return {
    dip: degrees(Math.acos(clamp(up[2], 0, 1))),
    direction: normalizeAngle(degrees(Math.atan2(up[0], up[1]))),
  }
}

function projectedCoordinates(dipDirection: number, trueDip: number) {
  const radius = 44 * Math.SQRT2 * Math.sin(radians(trueDip) / 2)
  const direction = radians(dipDirection)
  return {
    x: 50 + radius * Math.sin(direction),
    y: 50 - radius * Math.cos(direction),
  }
}

function clusterNormals(normals: readonly Vector[]) {
  if (normals.length === 0) return { assignments: [] as number[], centers: [] as Vector[] }
  const centers: Vector[] = [normals[0] ?? [0, 0, 1]]
  while (centers.length < Math.min(3, normals.length)) {
    const next = normals.reduce((best, candidate) => {
      const distance = Math.min(...centers.map((center) => 1 - dot(center, candidate)))
      return distance > best.distance ? { distance, vector: candidate } : best
    }, { distance: -1, vector: normals[0] ?? [0, 0, 1] })
    centers.push(next.vector)
  }

  let assignments = normals.map(() => 0)
  for (let iteration = 0; iteration < 16; iteration += 1) {
    assignments = normals.map((normal) => centers.reduce((best, center, index) => {
      const similarity = dot(center, normal)
      return similarity > best.similarity ? { index, similarity } : best
    }, { index: 0, similarity: -Infinity }).index)
    centers.forEach((_, centerIndex) => {
      const members = normals.filter((__, index) => assignments[index] === centerIndex)
      if (members.length > 0) centers[centerIndex] = normalize(members.reduce<Vector>((sum, member) => add(sum, member), [0, 0, 0]))
    })
  }

  const order = centers.map((center, index) => ({ center, index, count: assignments.filter((value) => value === index).length }))
    .sort((a, b) => b.count - a.count)
  const remap = new Map(order.map((item, index) => [item.index, index]))
  return {
    assignments: assignments.map((assignment) => remap.get(assignment) ?? assignment),
    centers: order.map((item) => item.center),
  }
}

export function analyzeStructure(
  observations: readonly StructureObservation[],
  collars: readonly CollarRecord[],
  surveys: readonly SurveyStation[],
): StructureAnalysisResult {
  const converted = observations.flatMap((observation) => {
    const hasCollar = collars.some((collar) => collar.holeId === observation.holeId)
    const holeSurvey = surveys.filter((station) => station.holeId === observation.holeId)
    const orientation = interpolateSurvey(holeSurvey, observation.depth)
    if (!hasCollar || orientation === undefined) return []
    const result = convertAlphaBeta(observation.alpha, observation.beta, orientation.azimuth, orientation.dip)
    return [{ observation, ...result }]
  })

  const clustering = clusterNormals(converted.map((item) => item.normal))
  const points = converted.map((item, index) => {
    const setIndex = clustering.assignments[index] ?? 0
    return {
      ...item.observation,
      ...projectedCoordinates(item.dipDirection, item.trueDip),
      dipDirection: item.dipDirection,
      setId: `J${setIndex + 1}`,
      trueDip: item.trueDip,
    }
  })
  const jointSets = clustering.centers.map((center, index) => {
    const orientation = orientationFromNormal(center)
    return {
      color: setColors[index] ?? '#9ba39f',
      count: points.filter((point) => point.setId === `J${index + 1}`).length,
      dip: orientation.dip,
      direction: orientation.direction,
      id: `J${index + 1}`,
    }
  })

  return { jointSets, points, rejected: observations.length - converted.length }
}
