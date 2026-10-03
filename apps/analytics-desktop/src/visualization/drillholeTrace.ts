export interface DrillholeTraceStation {
  azimuth: number
  depth: number
  dip: number
}

export interface DrillholeTracePoint {
  depth: number
  x: number
  y: number
}

export interface DrillholeTrace {
  depthTicks: number[]
  path: string
  points: DrillholeTracePoint[]
  totalDepth: number | null
}

const top = 12
const bottom = 278
const left = 20
const right = 160

function radians(value: number) {
  return value * Math.PI / 180
}

function direction(station: DrillholeTraceStation) {
  const azimuth = radians(station.azimuth)
  const dip = radians(station.dip)
  const horizontal = Math.cos(dip)
  return {
    east: horizontal * Math.sin(azimuth),
    north: horizontal * Math.cos(azimuth),
  }
}

function validStations(stations: readonly DrillholeTraceStation[]) {
  const byDepth = new Map<number, DrillholeTraceStation>()
  stations.forEach((station) => {
    if (
      Number.isFinite(station.depth)
      && station.depth >= 0
      && Number.isFinite(station.azimuth)
      && Number.isFinite(station.dip)
    ) {
      byDepth.set(station.depth, station)
    }
  })
  return [...byDepth.values()].sort((a, b) => a.depth - b.depth)
}

function depthTicks(totalDepth: number) {
  return Array.from({ length: 5 }, (_, index) => totalDepth * index / 4)
}

/** Builds a measured-depth profile from the selected hole's actual survey stations. */
export function buildDrillholeTrace(stations: readonly DrillholeTraceStation[]): DrillholeTrace {
  const sorted = validStations(stations)
  const finalStation = sorted.at(-1)
  if (finalStation === undefined || finalStation.depth <= 0) {
    return { depthTicks: [], path: '', points: [], totalDepth: finalStation?.depth ?? null }
  }

  let east = 0
  let north = 0
  let previousDepth = 0
  let previousDirection = direction(sorted[0] ?? finalStation)
  const positions = [{ depth: 0, east, north, isStation: sorted[0]?.depth === 0 }]

  sorted.forEach((station) => {
    const currentDirection = direction(station)
    const interval = station.depth - previousDepth
    if (interval > 0) {
      // Average the bounding survey vectors so changes in azimuth and dip bend the trace.
      east += interval * (previousDirection.east + currentDirection.east) / 2
      north += interval * (previousDirection.north + currentDirection.north) / 2
      positions.push({ depth: station.depth, east, north, isStation: true })
    }
    previousDepth = station.depth
    previousDirection = currentDirection
  })

  const totalDepth = finalStation.depth
  const origin = positions[0]!
  const finalPosition = positions.at(-1)!
  const finalDeparture = Math.hypot(finalPosition.east, finalPosition.north)
  const furthest = positions.reduce((best, position) => (
    Math.hypot(position.east, position.north) > Math.hypot(best.east, best.north) ? position : best
  ), origin)
  const reference = finalDeparture > 1e-6 ? finalPosition : furthest
  const referenceLength = Math.hypot(reference.east, reference.north)
  const axis = referenceLength > 1e-6
    ? { east: reference.east / referenceLength, north: reference.north / referenceLength }
    : { east: 1, north: 0 }
  const projected = positions.map((position) => ({
    ...position,
    departure: position.east * axis.east + position.north * axis.north,
  }))
  const departures = projected.map((position) => position.departure)
  const minDeparture = Math.min(...departures)
  const maxDeparture = Math.max(...departures)
  const verticalScale = (bottom - top) / totalDepth
  const horizontalSpan = maxDeparture - minDeparture
  const horizontalScale = horizontalSpan > 1e-6
    ? Math.min(verticalScale, (right - left) / horizontalSpan)
    : verticalScale
  const xOrigin = (left + right - (minDeparture + maxDeparture) * horizontalScale) / 2
  const rendered = projected.map((position) => ({
    depth: position.depth,
    isStation: position.isStation,
    x: xOrigin + position.departure * horizontalScale,
    y: top + position.depth * verticalScale,
  }))

  return {
    depthTicks: depthTicks(totalDepth),
    path: rendered.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(''),
    points: rendered.filter((point) => point.isStation).map(({ depth, x, y }) => ({ depth, x, y })),
    totalDepth,
  }
}

export function formatTraceDepth(value: number) {
  const digits = value < 10 && !Number.isInteger(value) ? 1 : 0
  return value.toLocaleString('en-US', { maximumFractionDigits: digits })
}
