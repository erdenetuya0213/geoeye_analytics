import type { CollarRecord, SurveyStation } from '../analysis/structureAnalysis.js'
import { normalizeStructureHoleId } from '../analysis/structureAnalysis.js'
import type { SceneBounds, ScenePoint3D } from './scene3dProjection.js'

export function surveyGeometry(collar: CollarRecord, surveys: readonly SurveyStation[], depths: readonly number[] = []) {
  const stations = surveys.filter((s) => normalizeStructureHoleId(s.holeId) === normalizeStructureHoleId(collar.holeId) && Number.isFinite(s.depth) && s.depth >= 0 && Number.isFinite(s.azimuth) && Number.isFinite(s.dip)).sort((a, b) => a.depth - b.depth)
  const vector = (station: SurveyStation | undefined) => {
    if (!station) return { x: 0, y: 0, z: -1 }
    const az = station.azimuth * Math.PI / 180
    const dip = -Math.abs(station.dip) * Math.PI / 180
    return { x: Math.cos(dip) * Math.sin(az), y: Math.cos(dip) * Math.cos(az), z: Math.sin(dip) }
  }
  const pointAt = (depth: number): ScenePoint3D => {
    const point = { x: collar.easting, y: collar.northing, z: collar.elevation }
    let previousDepth = 0
    let previous = vector(stations[0])
    for (const station of stations) {
      const end = Math.min(depth, station.depth)
      if (end > previousDepth) {
        const next = vector(station)
        const fraction = (end - previousDepth) / (station.depth - previousDepth)
        for (const axis of ['x', 'y', 'z'] as const) point[axis] += (end - previousDepth) * (previous[axis] + (next[axis] - previous[axis]) * fraction / 2)
      }
      if (station.depth >= depth) return point
      previousDepth = station.depth
      previous = vector(station)
    }
    for (const axis of ['x', 'y', 'z'] as const) point[axis] += (depth - previousDepth) * previous[axis]
    return point
  }
  const traceDepths = [...new Set([0, ...stations.map((s) => s.depth), ...depths.filter((d) => Number.isFinite(d) && d >= 0)])].sort((a, b) => a - b)
  return { pointAt, trajectory: traceDepths.map(pointAt) }
}

/** Zero/zero is the local dataset placeholder for an unknown collar location. */
export function sceneHoleIsLocated(holeId: string, easting: number, northing: number, collars: readonly CollarRecord[]) {
  return collars.some((collar) => normalizeStructureHoleId(collar.holeId) === normalizeStructureHoleId(holeId)
    && [collar.easting, collar.northing, collar.elevation].every(Number.isFinite))
    || (Number.isFinite(easting) && Number.isFinite(northing) && (easting !== 0 || northing !== 0))
}

/** Frame the geometry actually drawn, rather than dataset coordinate placeholders. */
export function sceneBoundsForPoints(points: readonly ScenePoint3D[]): SceneBounds {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }
  for (const point of points) {
    if (![point.x, point.y, point.z].every(Number.isFinite)) continue
    bounds.minX = Math.min(bounds.minX, point.x)
    bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y)
    bounds.maxY = Math.max(bounds.maxY, point.y)
    bounds.minZ = Math.min(bounds.minZ, point.z)
    bounds.maxZ = Math.max(bounds.maxZ, point.z)
  }
  if (!Number.isFinite(bounds.minX)) return { minX: -30, maxX: 30, minY: -30, maxY: 30, minZ: -10, maxZ: 10 }
  return { minX: bounds.minX - 30, maxX: bounds.maxX + 30, minY: bounds.minY - 30, maxY: bounds.maxY + 30, minZ: bounds.minZ - 10, maxZ: bounds.maxZ }
}
