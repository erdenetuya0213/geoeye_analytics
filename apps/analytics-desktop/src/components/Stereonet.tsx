import { useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { StructurePoint } from '../analysis/structureAnalysis.js'
import { useStereonetTheme } from '../state/StereonetThemeContext.js'

export interface PlotCoordinate {
  x: number
  y: number
}

export type StereonetPlotMode = 'density' | 'planes' | 'poles'
export type StereonetProjection = 'equalAngle' | 'equalArea'
export type BoundaryDrawingMode = 'polygon' | 'trapezoid'
export type DensityPalettePreset = 'geoeye' | 'spectrum'
export type DensitySurfaceMode = 'filled' | 'lines'
export type DensityDistribution = 'fisher' | 'schmidt'

interface SetBoundary {
  color: string
  id: string
  points: readonly PlotCoordinate[]
}

interface StereonetProps {
  activeGroup?: string
  categories: readonly { color: string; id: string }[]
  colorBy: 'jointSet' | 'structureType'
  compact?: boolean
  countCirclePercent?: number
  densityDistribution?: DensityDistribution
  densityPalette?: DensityPalettePreset
  densitySurface?: DensitySurfaceMode
  hiddenGroupIds?: ReadonlySet<string>
  onPointSelect?: (id: string) => void
  onPolygonChange?: (points: PlotCoordinate[]) => void
  onPolygonComplete?: (points: PlotCoordinate[]) => void
  planeWidth?: number
  plotMode?: StereonetPlotMode
  pointSize?: number
  points: readonly StructurePoint[]
  projection?: StereonetProjection
  polygonVertices?: readonly PlotCoordinate[]
  selectedIds?: ReadonlySet<string>
  selectionMode?: 'point' | BoundaryDrawingMode | null
  setBoundaries?: readonly SetBoundary[]
}

const azimuthLabels = Array.from({ length: 12 }, (_, index) => index * 30)
const radialLines = Array.from({ length: 36 }, (_, index) => index * 10)
const dipAngles = [15, 30, 45, 60, 75] as const
const emptyIds = new Set<string>()
const emptyCoordinates: readonly PlotCoordinate[] = []
const drawingAccent = '#c026ff'

function highContrastPointColor(color: string) {
  return `color-mix(in oklch, ${color} 82%, var(--foreground))`
}

function polarPoint(angle: number, radius: number) {
  const radians = angle * Math.PI / 180
  return { x: 50 + radius * Math.sin(radians), y: 50 - radius * Math.cos(radians) }
}

function pointRadius(point: PlotCoordinate) {
  return Math.hypot(point.x - 50, point.y - 50)
}

function clampToStereonet(point: PlotCoordinate) {
  const radius = pointRadius(point)
  if (radius <= 44) return point
  const scale = 44 / radius
  return { x: 50 + (point.x - 50) * scale, y: 50 + (point.y - 50) * scale }
}

function pointAzimuth(point: PlotCoordinate) {
  return (Math.atan2(point.x - 50, 50 - point.y) * 180 / Math.PI + 360) % 360
}

export function createStereonetTrapezoid(start: PlotCoordinate, end: PlotCoordinate) {
  const clampedStart = clampToStereonet(start)
  const clampedEnd = clampToStereonet(end)
  const innerRadius = Math.min(pointRadius(clampedStart), pointRadius(clampedEnd))
  const outerRadius = Math.max(pointRadius(clampedStart), pointRadius(clampedEnd))
  const startAzimuth = pointAzimuth(clampedStart)
  const endAzimuth = pointAzimuth(clampedEnd)
  const azimuthSpan = ((endAzimuth - startAzimuth + 540) % 360) - 180
  if (outerRadius - innerRadius < .25 || Math.abs(azimuthSpan) < .5) return []
  const segmentCount = Math.max(2, Math.ceil(Math.abs(azimuthSpan) / 2))
  const angles = Array.from({ length: segmentCount + 1 }, (_, index) => startAzimuth + azimuthSpan * index / segmentCount)
  return [
    ...angles.map((angle) => polarPoint(angle, outerRadius)),
    ...angles.slice().reverse().map((angle) => polarPoint(angle, innerRadius)),
  ]
}

export function pointInPolygon(point: PlotCoordinate, polygon: readonly PlotCoordinate[]) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    if (currentPoint === undefined || previousPoint === undefined) continue
    const intersects = ((currentPoint.y > point.y) !== (previousPoint.y > point.y))
      && point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)
      / (previousPoint.y - currentPoint.y || Number.EPSILON) + currentPoint.x
    if (intersects) inside = !inside
  }
  return inside
}

export function polygonArea(points: readonly PlotCoordinate[]) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return next === undefined ? sum : sum + point.x * next.y - next.x * point.y
  }, 0) / 2)
}

export function isBoundaryComplete(mode: BoundaryDrawingMode, points: readonly PlotCoordinate[]) {
  const validVertexCount = mode === 'trapezoid' ? points.length >= 4 : points.length >= 3
  return validVertexCount && polygonArea(points) > 2
}

function projectedRadius(angleFromVertical: number, projection: StereonetProjection) {
  return projection === 'equalArea'
    ? 44 * Math.SQRT2 * Math.sin(angleFromVertical / 2)
    : 44 * Math.tan(angleFromVertical / 2)
}

export function getStereonetDipRings(projection: StereonetProjection) {
  return dipAngles.map((dip) => ({
    dip,
    radius: projectedRadius(dip * Math.PI / 180, projection),
  }))
}

function projectVector([east, north, up]: readonly [number, number, number], projection: StereonetProjection) {
  const radius = projectedRadius(Math.acos(Math.max(0, Math.min(1, up))), projection)
  return polarPoint((Math.atan2(east, north) * 180 / Math.PI + 360) % 360, radius)
}

export function projectStructurePoint(point: StructurePoint, projection: StereonetProjection) {
  const radius = projectedRadius(point.trueDip * Math.PI / 180, projection)
  return { ...point, ...polarPoint(point.dipDirection, radius) }
}

function planePath(point: StructurePoint, projection: StereonetProjection) {
  const direction = point.dipDirection * Math.PI / 180
  const dip = point.trueDip * Math.PI / 180
  const normal: [number, number, number] = [
    Math.sin(dip) * Math.sin(direction),
    Math.sin(dip) * Math.cos(direction),
    Math.cos(dip),
  ]
  const strike: [number, number, number] = [-normal[1], normal[0], 0]
  const strikeLength = Math.hypot(strike[0], strike[1]) || 1
  const s: [number, number, number] = [strike[0] / strikeLength, strike[1] / strikeLength, 0]
  let downDip: [number, number, number] = [
    normal[1] * s[2] - normal[2] * s[1],
    normal[2] * s[0] - normal[0] * s[2],
    normal[0] * s[1] - normal[1] * s[0],
  ]
  if (downDip[2] < 0) downDip = [-downDip[0], -downDip[1], -downDip[2]]
  return Array.from({ length: 49 }, (_, index) => {
    const angle = Math.PI * index / 48
    return projectVector([
      Math.cos(angle) * s[0] + Math.sin(angle) * downDip[0],
      Math.cos(angle) * s[1] + Math.sin(angle) * downDip[1],
      Math.cos(angle) * s[2] + Math.sin(angle) * downDip[2],
    ], projection)
  }).map((coordinate, index) => `${index === 0 ? 'M' : 'L'}${coordinate.x.toFixed(2)},${coordinate.y.toFixed(2)}`).join(' ')
}

function densityColor(value: number, palette: readonly string[]) {
  const normalized = Math.max(0, Math.min(0.999, value))
  const position = normalized * (palette.length - 1)
  const start = palette[Math.floor(position)] ?? palette[0]
  const end = palette[Math.ceil(position)] ?? palette.at(-1)
  const ratio = position - Math.floor(position)
  const channel = (hex: string | undefined, offset: number) => Number.parseInt((hex ?? '#000000').slice(offset, offset + 2), 16)
  const mix = (offset: number) => Math.round(channel(start, offset) + (channel(end, offset) - channel(start, offset)) * ratio)
  return `rgb(${mix(1)} ${mix(3)} ${mix(5)})`
}

interface DensityField {
  cells: { normalized: number; step: number; x: number; y: number }[]
  size: number
  start: number
  step: number
  values: number[]
}

type UnitVector = readonly [east: number, north: number, up: number]

function orientationVector(dipDirection: number, angleFromVertical: number): UnitVector {
  const azimuth = dipDirection * Math.PI / 180
  return [
    Math.sin(angleFromVertical) * Math.sin(azimuth),
    Math.sin(angleFromVertical) * Math.cos(azimuth),
    Math.cos(angleFromVertical),
  ]
}

function unprojectCoordinate(x: number, y: number, projection: StereonetProjection): UnitVector {
  const east = x - 50
  const north = 50 - y
  const normalizedRadius = Math.min(1, Math.hypot(east, north) / 44)
  const angleFromVertical = projection === 'equalArea'
    ? 2 * Math.asin(normalizedRadius / Math.SQRT2)
    : 2 * Math.atan(normalizedRadius)
  const direction = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360
  return orientationVector(direction, angleFromVertical)
}

export function densityInfluence(cosineDistance: number, distribution: DensityDistribution, countCirclePercent: number) {
  const hemisphereFraction = Math.max(.005, Math.min(.05, countCirclePercent / 100))
  const clampedCosine = Math.max(-1, Math.min(1, cosineDistance))
  const countCircleCosine = 1 - hemisphereFraction
  if (distribution === 'schmidt') return clampedCosine >= countCircleCosine ? 1 : 0

  const countCircleAngle = Math.acos(countCircleCosine)
  if (clampedCosine < Math.cos(countCircleAngle * 2)) return 0
  const concentration = 1 / hemisphereFraction
  return Math.exp(concentration * (clampedCosine - 1))
}

function makeDensityField(points: readonly StructurePoint[], projection: StereonetProjection, distribution: DensityDistribution, countCirclePercent: number): DensityField {
  const size = 33
  const start = 6
  const step = 88 / (size - 1)
  const pointVectors = points.map((point) => orientationVector(point.dipDirection, point.trueDip * Math.PI / 180))
  const raw: { density: number; inside: boolean; x: number; y: number }[] = []
  for (let row = 0; row < size; row += 1) {
    const y = start + row * step
    for (let column = 0; column < size; column += 1) {
      const x = start + column * step
      const inside = Math.hypot(x - 50, y - 50) <= 44
      const gridVector = unprojectCoordinate(x, y, projection)
      const density = inside ? pointVectors.reduce((sum, pointVector) => {
        const cosineDistance = gridVector[0] * pointVector[0] + gridVector[1] * pointVector[1] + gridVector[2] * pointVector[2]
        return sum + densityInfluence(cosineDistance, distribution, countCirclePercent)
      }, 0) : 0
      raw.push({ density: inside ? density : 0, inside, x, y })
    }
  }
  const maximum = Math.max(...raw.map((cell) => cell.density), 1)
  const normalized = raw.map((cell) => cell.density / maximum)
  return {
    cells: raw.flatMap((cell, index) => cell.inside ? [{ normalized: normalized[index] ?? 0, step, x: cell.x, y: cell.y }] : []),
    size,
    start,
    step,
    values: normalized,
  }
}

function interpolateEdge(start: PlotCoordinate, end: PlotCoordinate, startValue: number, endValue: number, threshold: number) {
  const span = endValue - startValue
  const ratio = Math.abs(span) < Number.EPSILON ? .5 : Math.max(0, Math.min(1, (threshold - startValue) / span))
  return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio }
}

function densityContourPath(field: DensityField, threshold: number) {
  const commands: string[] = []
  const valueAt = (column: number, row: number) => field.values[row * field.size + column] ?? 0
  for (let row = 0; row < field.size - 1; row += 1) {
    for (let column = 0; column < field.size - 1; column += 1) {
      const x = field.start + column * field.step
      const y = field.start + row * field.step
      const topLeft = valueAt(column, row)
      const topRight = valueAt(column + 1, row)
      const bottomRight = valueAt(column + 1, row + 1)
      const bottomLeft = valueAt(column, row + 1)
      const mask = (topLeft >= threshold ? 8 : 0)
        | (topRight >= threshold ? 4 : 0)
        | (bottomRight >= threshold ? 2 : 0)
        | (bottomLeft >= threshold ? 1 : 0)
      if (mask === 0 || mask === 15) continue

      const corners = {
        bottomLeft: { x, y: y + field.step },
        bottomRight: { x: x + field.step, y: y + field.step },
        topLeft: { x, y },
        topRight: { x: x + field.step, y },
      }
      const edges = {
        bottom: interpolateEdge(corners.bottomLeft, corners.bottomRight, bottomLeft, bottomRight, threshold),
        left: interpolateEdge(corners.topLeft, corners.bottomLeft, topLeft, bottomLeft, threshold),
        right: interpolateEdge(corners.topRight, corners.bottomRight, topRight, bottomRight, threshold),
        top: interpolateEdge(corners.topLeft, corners.topRight, topLeft, topRight, threshold),
      }
      const centreAbove = (topLeft + topRight + bottomRight + bottomLeft) / 4 >= threshold
      const segments: [PlotCoordinate, PlotCoordinate][] = (() => {
        switch (mask) {
          case 1: return [[edges.left, edges.bottom]]
          case 2: return [[edges.bottom, edges.right]]
          case 3: return [[edges.left, edges.right]]
          case 4: return [[edges.top, edges.right]]
          case 5: return centreAbove
            ? [[edges.top, edges.left], [edges.bottom, edges.right]]
            : [[edges.top, edges.right], [edges.bottom, edges.left]]
          case 6: return [[edges.top, edges.bottom]]
          case 7: return [[edges.top, edges.left]]
          case 8: return [[edges.left, edges.top]]
          case 9: return [[edges.bottom, edges.top]]
          case 10: return centreAbove
            ? [[edges.left, edges.bottom], [edges.top, edges.right]]
            : [[edges.left, edges.top], [edges.bottom, edges.right]]
          case 11: return [[edges.right, edges.top]]
          case 12: return [[edges.right, edges.left]]
          case 13: return [[edges.bottom, edges.right]]
          case 14: return [[edges.left, edges.bottom]]
          default: return []
        }
      })()
      segments.forEach(([from, to]) => commands.push(`M${from.x.toFixed(2)},${from.y.toFixed(2)}L${to.x.toFixed(2)},${to.y.toFixed(2)}`))
    }
  }
  return commands.join('')
}

export function Stereonet({
  activeGroup = 'all', categories, colorBy, compact = false, countCirclePercent = 1, densityDistribution = 'schmidt', densityPalette = 'spectrum', densitySurface = 'filled', hiddenGroupIds = emptyIds, onPointSelect,
  onPolygonChange, onPolygonComplete, planeWidth = .75, plotMode = 'density', pointSize = 1, points, polygonVertices = emptyCoordinates, projection = 'equalArea', selectedIds = emptyIds,
  selectionMode = null, setBoundaries = [],
}: StereonetProps) {
  const theme = useStereonetTheme()
  const drawingPoints = useRef<PlotCoordinate[]>([])
  const trapezoidDragStart = useRef<PlotCoordinate | null>(null)
  const trapezoidPointerId = useRef<number | null>(null)
  const [trapezoidPreview, setTrapezoidPreview] = useState<PlotCoordinate[]>([])
  const colors = new Map(categories.map((category) => [category.id, category.color]))
  const densityColors = densityPalette === 'geoeye' ? theme.densityGeoeye : theme.densitySpectrum
  const clipId = compact ? 'net-clip-small' : 'net-clip-large'
  const dipRings = getStereonetDipRings(projection)
  const displayPoints = points.map((point) => projectStructurePoint(point, projection))
  const visiblePoints = displayPoints.filter((point) => !hiddenGroupIds.has(colorBy === 'jointSet' ? point.setId : point.structureType))
  const densityField = plotMode === 'density' ? makeDensityField(visiblePoints, projection, densityDistribution, countCirclePercent) : null
  const contourThresholds = [.14, .26, .38, .5, .62, .74, .86]
  const planeStep = Math.max(1, Math.ceil(visiblePoints.length / 48))
  const planePoints = visiblePoints.filter((_, index) => index % planeStep === 0)
  const drawingBoundary = selectionMode === 'polygon' || selectionMode === 'trapezoid'
  const renderedBoundary = selectionMode === 'trapezoid' ? trapezoidPreview : polygonVertices
  const polygonCoordinates = renderedBoundary.map((point) => `${point.x},${point.y}`).join(' ')
  const polygonFirst = renderedBoundary[0]
  const polygonLast = renderedBoundary.at(-1)

  const pointerCoordinate = (event: ReactMouseEvent<SVGSVGElement> | ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - bounds.left) * 100 / bounds.width, y: (event.clientY - bounds.top) * 100 / bounds.height }
  }

  const addPolygonVertex = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (selectionMode !== 'polygon' || event.detail > 1) return
    const point = pointerCoordinate(event)
    if (Math.hypot(point.x - 50, point.y - 50) > 44) return
    drawingPoints.current = [...polygonVertices, point]
    onPolygonChange?.([...drawingPoints.current])
  }

  const finishPolygon = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (selectionMode !== 'polygon') return
    event.preventDefault()
    if (isBoundaryComplete(selectionMode, drawingPoints.current)) onPolygonComplete?.([...drawingPoints.current])
  }

  const beginTrapezoid = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (selectionMode !== 'trapezoid') return
    const point = pointerCoordinate(event)
    if (pointRadius(point) > 44) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    trapezoidPointerId.current = event.pointerId
    trapezoidDragStart.current = point
    setTrapezoidPreview([])
  }

  const updateTrapezoid = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (selectionMode !== 'trapezoid' || trapezoidPointerId.current !== event.pointerId || trapezoidDragStart.current === null) return
    event.preventDefault()
    setTrapezoidPreview(createStereonetTrapezoid(trapezoidDragStart.current, pointerCoordinate(event)))
  }

  const finishTrapezoid = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (selectionMode !== 'trapezoid' || trapezoidPointerId.current !== event.pointerId || trapezoidDragStart.current === null) return
    event.preventDefault()
    const boundary = createStereonetTrapezoid(trapezoidDragStart.current, pointerCoordinate(event))
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    trapezoidPointerId.current = null
    trapezoidDragStart.current = null
    setTrapezoidPreview([])
    if (isBoundaryComplete('trapezoid', boundary)) onPolygonComplete?.(boundary)
  }

  const cancelTrapezoid = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (trapezoidPointerId.current !== event.pointerId) return
    trapezoidPointerId.current = null
    trapezoidDragStart.current = null
    setTrapezoidPreview([])
  }

  return (
    <div className={`stereonet stereonet-theme-${theme.id} is-${plotMode} ${compact ? 'is-compact' : ''} ${drawingBoundary ? 'is-drawing' : ''}`}>
      <svg aria-label={`${projection === 'equalArea' ? 'Equal-area' : 'Equal-angle'} lower-hemisphere stereonet`} data-drawing-shape={drawingBoundary ? selectionMode : undefined} data-projection={projection} data-stereonet-theme={theme.id} onClick={addPolygonVertex} onDoubleClick={finishPolygon} onPointerCancel={cancelTrapezoid} onPointerDown={beginTrapezoid} onPointerMove={updateTrapezoid} onPointerUp={finishTrapezoid} role="img" viewBox="0 0 100 100">
        <defs>
          <clipPath id={clipId}><circle cx="50" cy="50" r="44" /></clipPath>
          <filter id={`${clipId}-density-blur`}><feGaussianBlur stdDeviation=".75" /></filter>
        </defs>

        <circle className="net-surface" cx="50" cy="50" r="44" style={{ fill: theme.surface }} />
        {densityField !== null && densitySurface === 'filled' ? (
          <g className="density-surface" clipPath={`url(#${clipId})`} filter={`url(#${clipId}-density-blur)`}>
            {densityField.cells.map((cell) => <rect fill={densityColor(cell.normalized, densityColors)} height={cell.step + .45} key={`${cell.x}-${cell.y}`} opacity={cell.normalized < (densityPalette === 'spectrum' ? .1 : .07) ? 0 : Math.min(.92, .08 + cell.normalized * .84)} width={cell.step + .45} x={cell.x - cell.step / 2} y={cell.y - cell.step / 2} />)}
          </g>
        ) : null}
        {densityField !== null ? (
          <g className={`density-contours is-${densitySurface}`} clipPath={`url(#${clipId})`} fill="none">
            {contourThresholds.map((threshold) => <path d={densityContourPath(densityField, threshold)} key={threshold} stroke={densityColor(Math.min(.98, threshold + .1), densityColors)} />)}
          </g>
        ) : null}
        <g className="net-grid" clipPath={`url(#${clipId})`} fill="none" style={{ stroke: theme.grid }}>
          {dipRings.map(({ dip, radius }) => <circle cx="50" cy="50" data-dip={dip} key={dip} r={radius} style={{ stroke: dip === 45 ? theme.gridStrong : theme.grid, strokeWidth: dip === 45 ? theme.gridStrongWidth : theme.gridWidth }} />)}
          {radialLines.map((angle) => {
            const edge = polarPoint(angle, 44)
            return <line key={angle} style={{ stroke: angle % 30 === 0 ? theme.gridStrong : theme.grid, strokeWidth: angle % 30 === 0 ? theme.gridStrongWidth : theme.gridWidth }} x1="50" x2={edge.x} y1="50" y2={edge.y} />
          })}
        </g>
        <circle className="net-outline" cx="50" cy="50" fill="none" r="44" style={{ stroke: theme.outline, strokeWidth: theme.outlineWidth }} />

        {plotMode === 'planes' ? (
          <g className="stereonet-planes" clipPath={`url(#${clipId})`} fill="none">
            {planePoints.map((point) => {
              const groupId = colorBy === 'jointSet' ? point.setId : point.structureType
              return <path d={planePath(point, projection)} key={point.id} opacity={activeGroup === 'all' || activeGroup === groupId ? .84 : .18} stroke={colors.get(groupId) ?? theme.pointPalette.at(-1)} style={{ strokeWidth: planeWidth * theme.lineScale }} />
            })}
          </g>
        ) : null}

        <g clipPath={`url(#${clipId})`}>
          {setBoundaries.map((boundary) => {
            if (boundary.points.length < 3) return null
            const color = colors.get(boundary.id) ?? boundary.color
            const coordinates = boundary.points.map((point) => `${point.x},${point.y}`).join(' ')
            return (
              <g className={`set-boundary-group ${activeGroup === boundary.id ? 'is-active' : ''}`} key={boundary.id}>
                <polygon className="set-boundary-halo" points={coordinates} />
                <polygon className="set-boundary-keyline" points={coordinates} />
                <polygon className="set-boundary" fill={color} points={coordinates} stroke={color} />
              </g>
            )
          })}
          {plotMode === 'planes' ? null : displayPoints.map((point) => {
            const groupId = colorBy === 'jointSet' ? point.setId : point.structureType
            const hidden = hiddenGroupIds.has(groupId)
            const deEmphasized = activeGroup !== 'all' && activeGroup !== groupId
            const selected = selectedIds.has(point.id)
            const pointColor = colors.get(groupId) ?? theme.pointPalette.at(-1) ?? '#d97706'
            return (
              <circle
                aria-label={`${point.id}, ${point.structureType}, ${point.setId}, ${point.dipDirection.toFixed(0)} degrees dip direction, ${point.trueDip.toFixed(0)} degrees dip`}
                className={`stereonet-point ${selectionMode === 'point' ? 'is-selectable' : ''} ${selected ? 'is-selected' : ''}`}
                cx={point.x} cy={point.y} fill={highContrastPointColor(pointColor)} key={point.id}
                onClick={(event) => { if (selectionMode === 'point') { event.stopPropagation(); onPointSelect?.(point.id) } }}
                onKeyDown={(event) => { if (selectionMode === 'point' && (event.key === 'Enter' || event.key === ' ')) onPointSelect?.(point.id) }}
                opacity={hidden ? 0 : selected ? 1 : deEmphasized ? .14 : plotMode === 'density' ? .9 : .96}
                r={(selected ? 1.05 : compact ? .68 : plotMode === 'density' ? .62 : .84) * pointSize * theme.pointScale}
                role={selectionMode === 'point' ? 'button' : undefined}
                stroke="var(--foreground)" strokeWidth={selected ? .45 : .34}
                tabIndex={selectionMode === 'point' ? 0 : undefined}
              />
            )
          })}
          {renderedBoundary.length === 0 ? null : (
            <g className="lasso-boundary">
              {renderedBoundary.length >= 3 ? <>
                <polygon className="lasso-boundary-shadow" points={polygonCoordinates} />
                <polygon className="lasso-boundary-keyline" points={polygonCoordinates} />
                <polygon className="lasso-boundary-accent" fill={drawingAccent} points={polygonCoordinates} style={{ stroke: drawingAccent }} />
              </> : <>
                <polyline className="lasso-boundary-shadow" points={polygonCoordinates} />
                <polyline className="lasso-boundary-keyline" points={polygonCoordinates} />
                <polyline className="lasso-boundary-accent" fill="none" points={polygonCoordinates} style={{ stroke: drawingAccent }} />
              </>}
              {selectionMode !== 'polygon' || polygonFirst === undefined ? null : <circle className="lasso-start-marker" cx={polygonFirst.x} cy={polygonFirst.y} r="1" style={{ fill: drawingAccent }} />}
              {selectionMode !== 'polygon' || polygonLast === undefined ? null : <circle className="lasso-end-marker" cx={polygonLast.x} cy={polygonLast.y} r=".55" />}
            </g>
          )}
        </g>

        <g className="net-azimuths" style={{ fill: theme.labelColor }} textAnchor="middle">
          {azimuthLabels.map((angle) => {
            const label = polarPoint(angle, 48.2)
            return <text dominantBaseline="middle" key={angle} x={label.x} y={label.y}>{angle}°</text>
          })}
        </g>
      </svg>
    </div>
  )
}
