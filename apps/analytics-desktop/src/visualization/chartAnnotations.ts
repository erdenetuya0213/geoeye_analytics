import { inverseStandardNormal } from '../analysis/eda.js'
import type { ChartSettings, ReferenceLineKey, StatKey, StatsCorner } from './chartSettings.js'
import { referenceLineLabels, statLabels } from './chartSettings.js'
import { geoEyeChartColors } from './geoEyeTheme.js'

/** The fields a stats box can report; both the EDA summary and the weighted engine summary satisfy it. */
export interface StatsSource {
  coefficientOfVariation: number | null
  count: number
  geometricMean: number | null
  kurtosis: number | null
  logMean: number | null
  logVariance: number | null
  maximum: number | null
  mean: number | null
  median: number | null
  minimum: number | null
  missing: number
  p95: number | null
  q1: number | null
  q3: number | null
  skewness: number | null
  standardDeviation: number | null
  variance: number | null
}

const integerStats = new Set<StatKey>(['count', 'missing'])

export function statValue(summary: StatsSource, key: StatKey): number | null {
  const value = summary[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatStat(summary: StatsSource, key: StatKey, decimals: number) {
  const value = statValue(summary, key)
  if (value === null) return '—'
  return integerStats.has(key) ? value.toLocaleString() : value.toFixed(decimals)
}

// Top corners clear the on-chart toolbar, which floats over the same area.
function cornerOf(corner: Exclude<StatsCorner, 'auto'>, inset: number): Record<string, number> {
  const horizontal = corner.endsWith('right') ? { right: inset } : { left: inset }
  return corner.startsWith('top') ? { ...horizontal, top: 34 } : { ...horizontal, bottom: 12 }
}

export function resolveCorner(corner: StatsCorner, automatic: Exclude<StatsCorner, 'auto'>) {
  return corner === 'auto' ? automatic : corner
}

/** The free corner on the other side, for a note drawn beside the stats box. */
export function oppositeCorner(corner: Exclude<StatsCorner, 'auto'>): Exclude<StatsCorner, 'auto'> {
  return corner.endsWith('right')
    ? corner.startsWith('top') ? 'top-left' : 'bottom-left'
    : corner.startsWith('top') ? 'top-right' : 'bottom-right'
}

const STATS_FONT = '11px "Cascadia Mono", "Consolas", monospace'
const CHARACTER_WIDTH = 6.65
const LINE_HEIGHT = 15

/**
 * The stats box Supervisor draws inside the plot, as an ECharts graphic so it is part of the
 * exported image. Width is estimated from the monospace face, which keeps the box tight without
 * measuring text during render.
 */
export interface StatsRow {
  label: string
  value: string
}

export function statsBoxGraphic(summary: StatsSource, settings: ChartSettings, corner: Exclude<StatsCorner, 'auto'>, title?: string, inset?: number) {
  if (!settings.statsBox || settings.stats.length === 0) return undefined
  return statsRowsGraphic(
    settings.stats.map((key) => ({ label: statLabels[key], value: formatStat(summary, key, settings.decimals) })),
    settings, corner, title, inset,
  )
}

/** The same panel for charts whose useful numbers are not a distribution summary (scatter, QQ). */
export function statsRowsGraphic(rows: readonly StatsRow[], settings: ChartSettings, corner: Exclude<StatsCorner, 'auto'>, title?: string, inset?: number) {
  if (rows.length === 0) return undefined
  // A box on the left would otherwise sit over the y-axis labels.
  const edge = inset ?? (corner.endsWith('left') ? 58 : 12)
  const labelWidth = Math.max(...rows.map((row) => row.label.length))
  const valueWidth = Math.max(...rows.map((row) => row.value.length))
  const titleWidth = title === undefined ? 0 : title.length
  const width = Math.max(labelWidth + valueWidth + 3, titleWidth) * CHARACTER_WIDTH + 20
  const height = (rows.length + (title === undefined ? 0 : 1)) * LINE_HEIGHT + 14
  const top = title === undefined ? 10 : 10 + LINE_HEIGHT
  return [{
    children: [
      {
        shape: { height, r: 5, width, x: 0, y: 0 },
        style: { fill: 'rgba(255, 255, 255, 0.86)', lineWidth: 1, stroke: geoEyeChartColors.gridStrong },
        type: 'rect' as const,
      },
      ...(title === undefined ? [] : [{
        style: { fill: geoEyeChartColors.text, font: STATS_FONT, text: title, textAlign: 'left' as const },
        type: 'text' as const, x: 10, y: 10,
      }]),
      {
        geoeyeRole: 'muted' as const,
        style: {
          fill: geoEyeChartColors.muted,
          font: STATS_FONT,
          text: rows.map((row) => row.label).join('\n'),
          textAlign: 'left' as const,
          textVerticalAlign: 'top' as const,
        },
        type: 'text' as const, x: 10, y: top,
      },
      {
        style: {
          fill: geoEyeChartColors.text,
          font: STATS_FONT,
          text: rows.map((row) => row.value).join('\n'),
          textAlign: 'right' as const,
          textVerticalAlign: 'top' as const,
        },
        type: 'text' as const, x: width - 10, y: top,
      },
    ],
    ...cornerOf(corner, edge),
    type: 'group' as const,
  }]
}

const referenceColors: Record<ReferenceLineKey, string> = {
  geometricMean: geoEyeChartColors.violet,
  mean: geoEyeChartColors.accent,
  median: geoEyeChartColors.blue,
  p95: geoEyeChartColors.muted,
  q1: geoEyeChartColors.muted,
  q3: geoEyeChartColors.muted,
}

/**
 * Mean / median / percentile lines, drawn by an empty series so they never join the legend data.
 * `position` converts a value into an axis coordinate, which a category axis (the histogram) needs
 * because its marks are placed by bin index rather than by value.
 */
export function referenceLineSeries(
  summary: StatsSource,
  settings: ChartSettings,
  axis: 'x' | 'y',
  position: (value: number) => number | null = (value) => value,
) {
  const lines = settings.referenceLines.flatMap((key) => {
    const raw = statValue(summary, key)
    const value = raw === null ? null : position(raw)
    return value === null ? [] : [{
      label: { formatter: referenceLineLabels[key], fontSize: 9, position: axis === 'x' ? 'insideEndTop' as const : 'insideStartTop' as const },
      lineStyle: { color: referenceColors[key], type: key === 'mean' || key === 'median' ? 'solid' as const : 'dotted' as const, width: key === 'mean' || key === 'median' ? 1.6 : 1.2 },
      ...(axis === 'x' ? { xAxis: value } : { yAxis: value }),
    }]
  })
  if (lines.length === 0) return []
  return [{
    data: [],
    markLine: { animation: false, data: lines, silent: true, symbol: 'none' },
    name: 'Reference lines',
    silent: true,
    tooltip: { show: false },
    type: 'line' as const,
  }]
}

export interface RegressionFit {
  /** Evaluates the fitted curve, so every model draws through the same code path. */
  at: (x: number) => number
  intercept: number
  label: string
  rSquared: number
  slope: number
}

interface Point { x: number; y: number }

function mean(values: readonly number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function rSquaredOf(points: readonly Point[], at: (x: number) => number) {
  const yMean = mean(points.map((point) => point.y))
  const total = points.reduce((sum, point) => sum + (point.y - yMean) ** 2, 0)
  const residual = points.reduce((sum, point) => sum + (point.y - at(point.x)) ** 2, 0)
  return total === 0 ? 1 : Math.max(0, 1 - residual / total)
}

function leastSquares(points: readonly Point[]) {
  const xMean = mean(points.map((point) => point.x))
  const yMean = mean(points.map((point) => point.y))
  const sxx = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0)
  const sxy = points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0)
  if (sxx === 0) return null
  const slope = sxy / sxx
  return { intercept: yMean - slope * xMean, slope }
}

/**
 * Reduced major axis: the line that minimizes the product of both residuals. Preferred over least
 * squares when neither variable is the controlled one, as with two assays of the same sample.
 */
function reducedMajorAxis(points: readonly Point[]) {
  const xMean = mean(points.map((point) => point.x))
  const yMean = mean(points.map((point) => point.y))
  const sxx = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0)
  const syy = points.reduce((sum, point) => sum + (point.y - yMean) ** 2, 0)
  const sxy = points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0)
  if (sxx === 0 || syy === 0) return null
  const slope = Math.sign(sxy || 1) * Math.sqrt(syy / sxx)
  return { intercept: yMean - slope * xMean, slope }
}

function formatCoefficient(value: number) {
  return Math.abs(value) >= 1000 || (Math.abs(value) < 0.001 && value !== 0) ? value.toExponential(2) : value.toFixed(4)
}

export function fitRegression(points: readonly Point[], settings: ChartSettings): RegressionFit | null {
  if (settings.regressionMethod === 'none') return null
  if (points.length < (settings.regressionModel === 'linear' ? 2 : 3)) return null
  const straight = settings.regressionMethod === 'reduced-major-axis' ? reducedMajorAxis : leastSquares

  if (settings.regressionModel === 'power' || settings.regressionModel === 'exponential') {
    const usable = points.filter((point) => point.y > 0 && (settings.regressionModel === 'exponential' || point.x > 0))
    if (usable.length < 3) return null
    const transformed = usable.map((point) => ({
      x: settings.regressionModel === 'power' ? Math.log(point.x) : point.x,
      y: Math.log(point.y),
    }))
    const line = straight(transformed)
    if (line === null) return null
    const factor = Math.exp(line.intercept)
    const at = settings.regressionModel === 'power'
      ? (x: number) => x > 0 ? factor * x ** line.slope : Number.NaN
      : (x: number) => factor * Math.exp(line.slope * x)
    return {
      at,
      intercept: factor,
      label: settings.regressionModel === 'power'
        ? `y = ${formatCoefficient(factor)}·x^${line.slope.toFixed(3)}`
        : `y = ${formatCoefficient(factor)}·e^(${line.slope.toFixed(4)}x)`,
      rSquared: rSquaredOf(usable, at),
      slope: line.slope,
    }
  }

  if (settings.regressionModel === 'quadratic') {
    const quadratic = fitQuadratic(points)
    if (quadratic === null) return null
    const at = (x: number) => quadratic.a + quadratic.b * x + quadratic.c * x ** 2
    return {
      at,
      intercept: quadratic.a,
      label: `y = ${formatCoefficient(quadratic.c)}x² + ${formatCoefficient(quadratic.b)}x + ${formatCoefficient(quadratic.a)}`,
      rSquared: rSquaredOf(points, at),
      slope: quadratic.b,
    }
  }

  const line = straight(points)
  if (line === null) return null
  const at = (x: number) => line.intercept + line.slope * x
  return {
    at,
    intercept: line.intercept,
    label: `y = ${line.slope.toFixed(4)}x ${line.intercept < 0 ? '−' : '+'} ${formatCoefficient(Math.abs(line.intercept))}`,
    rSquared: rSquaredOf(points, at),
    slope: line.slope,
  }
}

/** Normal equations for y = a + bx + cx², solved by Gaussian elimination on the 3×3 system. */
function fitQuadratic(points: readonly Point[]) {
  const power = (exponent: number) => points.reduce((sum, point) => sum + point.x ** exponent, 0)
  const cross = (exponent: number) => points.reduce((sum, point) => sum + point.y * point.x ** exponent, 0)
  const matrix = [
    [points.length, power(1), power(2), cross(0)],
    [power(1), power(2), power(3), cross(1)],
    [power(2), power(3), power(4), cross(2)],
  ]
  for (let column = 0; column < 3; column += 1) {
    const pivotRow = matrix.slice(column).reduce((best, row, index) => Math.abs(row[column] ?? 0) > Math.abs(matrix[best]?.[column] ?? 0) ? column + index : best, column)
    const swap = matrix[column]
    const picked = matrix[pivotRow]
    if (swap === undefined || picked === undefined) return null
    matrix[column] = picked
    matrix[pivotRow] = swap
    const pivot = matrix[column]?.[column] ?? 0
    if (Math.abs(pivot) < 1e-12) return null
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue
      const factor = (matrix[row]?.[column] ?? 0) / pivot
      for (let cell = column; cell < 4; cell += 1) {
        const target = matrix[row]
        const source = matrix[column]
        if (target === undefined || source === undefined) continue
        target[cell] = (target[cell] ?? 0) - factor * (source[cell] ?? 0)
      }
    }
  }
  const solve = (index: number) => (matrix[index]?.[3] ?? 0) / (matrix[index]?.[index] ?? 1)
  return { a: solve(0), b: solve(1), c: solve(2) }
}

/** Student-t quantile from the normal quantile (Cornish–Fisher); accurate enough for a plotted band. */
function studentT(probability: number, degrees: number) {
  const z = inverseStandardNormal(probability)
  if (degrees <= 0) return z
  return z
    + (z ** 3 + z) / (4 * degrees)
    + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * degrees ** 2)
}

/**
 * Confidence band for the mean response of a straight fit, as [lower, upper] pairs along x.
 * Only meaningful for the linear models, so curved fits return no band.
 */
export function confidenceBand(points: readonly Point[], fit: RegressionFit, level: number, steps = 48) {
  if (points.length < 4) return []
  const degrees = points.length - 2
  const xMean = mean(points.map((point) => point.x))
  const sxx = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0)
  if (sxx === 0) return []
  const residual = points.reduce((sum, point) => sum + (point.y - fit.at(point.x)) ** 2, 0) / degrees
  const error = Math.sqrt(Math.max(0, residual))
  const t = studentT(1 - (1 - level / 100) / 2, degrees)
  const minimum = Math.min(...points.map((point) => point.x))
  const maximum = Math.max(...points.map((point) => point.x))
  const step = (maximum - minimum) / steps
  return Array.from({ length: steps + 1 }, (_, index) => {
    const x = minimum + step * index
    const margin = t * error * Math.sqrt(1 / points.length + (x - xMean) ** 2 / sxx)
    return { lower: fit.at(x) - margin, upper: fit.at(x) + margin, x }
  })
}

export interface ControlLineResult {
  inside: number
  outside: number
  /** Predicate used to colour each point, matching the drawn lines. */
  isInside: (point: Point) => boolean
}

/** Supervisor's control lines around the 1:1 line: a fixed difference or a percentage of x. */
export function controlLines(points: readonly Point[], settings: ChartSettings): ControlLineResult | null {
  if (settings.controlLineMode === 'none') return null
  const isInside = (point: Point) => {
    const allowed = settings.controlLineMode === 'percent'
      ? Math.abs(point.x) * settings.controlLineValue / 100
      : settings.controlLineValue
    return Math.abs(point.y - point.x) <= allowed
  }
  const inside = points.filter(isInside).length
  return { inside, isInside, outside: points.length - inside }
}
