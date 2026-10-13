import type { EChartsCoreOption } from 'echarts/core'
import type { ChartSettings } from './chartSettings.js'
import { geoEyeChartColors } from './geoEyeTheme.js'

/** Scatter series above this size switch to the batched renderer so large assay sets stay interactive. */
export const LARGE_SERIES_THRESHOLD = 5_000

export interface AxisOptions {
  inverse?: boolean
  log?: boolean
}

type Record_ = Record<string, unknown>

function asRecord(value: unknown): Record_ | null {
  return typeof value === 'object' && value !== null ? value as Record_ : null
}

export function valueAxis(name: string, options: AxisOptions = {}) {
  return {
    axisLabel: { hideOverlap: true },
    axisLine: { show: true },
    axisTick: { show: false },
    inverse: options.inverse ?? false,
    name,
    nameGap: 42,
    nameLocation: 'middle' as const,
    scale: true,
    splitLine: { lineStyle: { color: geoEyeChartColors.grid }, show: true },
    splitNumber: 5,
    ...(options.log === true ? { logBase: 10, type: 'log' as const } : { type: 'value' as const }),
  }
}

export function categoryAxis(name: string, values: readonly string[]) {
  return {
    axisLabel: { hideOverlap: true },
    axisLine: { show: true },
    axisTick: { show: false },
    data: [...values],
    name,
    nameGap: 36,
    nameLocation: 'middle' as const,
    splitLine: { show: false },
    type: 'category' as const,
  }
}

export function cartesianBase(selectable = true) {
  return {
    animation: true,
    aria: { enabled: true },
    brush: selectable ? {
      brushMode: 'single',
      throttleDelay: 120,
      throttleType: 'debounce',
      xAxisIndex: 'all',
      yAxisIndex: 'all',
    } : undefined,
    grid: { bottom: 30, containLabel: true, left: 24, right: 22, top: 56 },
    legend: { left: 14, top: 12, type: 'scroll' },
    tooltip: { axisPointer: { lineStyle: { color: geoEyeChartColors.gridStrong }, type: 'line' }, confine: true, trigger: 'item' },
  }
}

function eachAxis(axis: unknown, map: (record: Record_) => Record_): unknown {
  if (Array.isArray(axis)) return axis.map((item) => eachAxis(item, map))
  const record = asRecord(axis)
  return record === null ? axis : map(record)
}

function isValueAxis(record: Record_) {
  return record.type === 'value' || record.type === 'log' || (record.type === undefined && !Array.isArray(record.data))
}

function toLogAxis(record: Record_): Record_ {
  if (!isValueAxis(record)) return record
  return {
    ...record,
    logBase: 10,
    min: undefined,
    minorSplitLine: { lineStyle: { color: geoEyeChartColors.grid, opacity: 0.6 }, show: true },
    type: 'log',
  }
}

/** Every numeric value a series contributes to one axis, for log guards and auto-ranging. */
export function axisValues(option: EChartsCoreOption, axis: 'x' | 'y'): number[] {
  const series = Array.isArray((option as Record_).series) ? (option as Record_).series as unknown[] : []
  const index = axis === 'x' ? 0 : 1
  return series.flatMap((candidate) => {
    const record = asRecord(candidate)
    if (record === null || !Array.isArray(record.data)) return []
    const paired = record.type === 'scatter' || record.type === 'line' || record.type === 'effectScatter'
    return record.data.flatMap((item) => {
      const value = Array.isArray(item) ? item : asRecord(item)?.value
      if (Array.isArray(value)) {
        const candidateValue = value[paired ? index : 0]
        return typeof candidateValue === 'number' && Number.isFinite(candidateValue) ? [candidateValue] : []
      }
      if (axis === 'y' && typeof value === 'number' && Number.isFinite(value)) return [value]
      return []
    })
  })
}

/** How many plotted values a log axis would drop, so the chart can say so instead of silently losing them. */
export function nonPositiveCount(option: EChartsCoreOption, axis: 'x' | 'y') {
  return axisValues(option, axis).filter((value) => value <= 0).length
}

export type PlotCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

/** Ties favour the top-left, which is clear of the on-chart toolbar. */
const cornerOrder: PlotCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

/**
 * The corner with the least ink, so a stats box or an equation lands in open space instead of
 * over the data or under the toolbar.
 */
export function cornerForPoints(points: ReadonlyArray<{ x: number; y: number }>): PlotCorner {
  const usable = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  if (usable.length === 0) return 'top-left'
  const span = (values: readonly number[]) => {
    const minimum = Math.min(...values)
    return { minimum, size: (Math.max(...values) - minimum) || 1 }
  }
  const x = span(usable.map((point) => point.x))
  const y = span(usable.map((point) => point.y))
  const counts: Record<PlotCorner, number> = { 'bottom-left': 0, 'bottom-right': 0, 'top-left': 0, 'top-right': 0 }
  usable.forEach((point) => {
    const right = (point.x - x.minimum) / x.size > 0.5
    const top = (point.y - y.minimum) / y.size > 0.5
    counts[`${top ? 'top' : 'bottom'}-${right ? 'right' : 'left'}`] += 1
  })
  return cornerOrder.reduce((best, corner) => counts[corner] < counts[best] ? corner : best, cornerOrder[0] as PlotCorner)
}

/** Bars fill from the bottom, so only the top corners are candidates; the lighter half wins. */
export function cornerForBars(heights: readonly number[]): PlotCorner {
  if (heights.length === 0) return 'top-left'
  const half = Math.ceil(heights.length / 2)
  const left = heights.slice(0, half).reduce((sum, value) => sum + value, 0)
  const right = heights.slice(half).reduce((sum, value) => sum + value, 0)
  return left > right ? 'top-right' : 'top-left'
}

const symbolNames: Record<ChartSettings['symbol'], string> = {
  circle: 'circle',
  cross: 'diamond',
  dot: 'circle',
  none: 'none',
  plus: 'rect',
}

function applyMarks(series: unknown, settings: ChartSettings) {
  const record = asRecord(series)
  if (record === null || record.type !== 'scatter') return series
  const large = Array.isArray(record.data) && record.data.length > LARGE_SERIES_THRESHOLD
  return {
    ...record,
    ...(large ? { large: true, largeThreshold: LARGE_SERIES_THRESHOLD, progressive: 4_000 } : {}),
    itemStyle: { ...asRecord(record.itemStyle), opacity: settings.opacity },
    symbol: symbolNames[settings.symbol],
    symbolSize: settings.symbol === 'dot' ? Math.max(2, settings.symbolSize - 4) : settings.symbolSize,
  }
}

/**
 * View-level settings applied to any option a builder returns: log axes and scatter marks.
 * Everything that needs the underlying samples (statistics, fits, control lines) stays in the builder.
 */
export function applyViewSettings(option: EChartsCoreOption, settings: ChartSettings): EChartsCoreOption {
  const record = option as Record_
  const series = Array.isArray(record.series) ? record.series.map((item) => applyMarks(item, settings)) : record.series
  return {
    ...record,
    series,
    xAxis: settings.logX ? eachAxis(record.xAxis, toLogAxis) : record.xAxis,
    yAxis: settings.logY ? eachAxis(record.yAxis, toLogAxis) : record.yAxis,
  } as EChartsCoreOption
}

function axisName(axis: unknown, fallback: string) {
  const record = Array.isArray(axis) ? asRecord(axis[0]) : asRecord(axis)
  const name = record?.name
  return typeof name === 'string' && name.length > 0 ? name : fallback
}

function categoryLabels(axis: unknown): string[] {
  const record = Array.isArray(axis) ? asRecord(axis[0]) : asRecord(axis)
  return Array.isArray(record?.data) ? record.data.map((item) => String(asRecord(item)?.value ?? item)) : []
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * The plotted values as CSV, so a result chart can be carried into a report or spreadsheet
 * without re-running the analysis.
 */
export function chartCsv(option: EChartsCoreOption): string {
  const record = option as Record_
  const series = Array.isArray(record.series) ? record.series as unknown[] : []
  const labels = categoryLabels(record.xAxis)
  const header = ['series', 'category', axisName(record.xAxis, 'x'), axisName(record.yAxis, 'y'), 'value3']
  const rows = series.flatMap((candidate, seriesIndex) => {
    const seriesRecord = asRecord(candidate)
    if (seriesRecord === null || !Array.isArray(seriesRecord.data) || seriesRecord.data.length === 0) return []
    const name = typeof seriesRecord.name === 'string' ? seriesRecord.name : `series ${seriesIndex + 1}`
    return seriesRecord.data.map((item, index) => {
      const itemRecord = asRecord(item)
      const value = Array.isArray(item) ? item : itemRecord?.value
      const category = typeof itemRecord?.name === 'string' ? itemRecord.name : labels[index] ?? ''
      if (Array.isArray(value)) return [name, category, value[0] ?? '', value[1] ?? '', value[2] ?? '']
      return [name, category, labels[index] ?? index, value ?? '', '']
    })
  })
  const hasThird = rows.some((row) => row[4] !== '' && row[4] !== undefined)
  const trimmed = hasThird ? rows : rows.map((row) => row.slice(0, 4))
  return [hasThird ? header : header.slice(0, 4), ...trimmed].map((row) => row.map(csvCell).join(',')).join('\n')
}
