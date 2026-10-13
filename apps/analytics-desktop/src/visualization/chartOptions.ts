import type { EChartsCoreOption } from 'echarts/core'
import type {
  AnalyticalSeriesResult,
  BoxPlotAnalysisResult,
  CorrelationAnalysisResult,
  DownholeTrackResult,
  HeatmapAnalysisResult,
  QqAnalysisResult,
  ScatterAnalysisResult,
  SwathAnalysisResult,
  VariogramAnalysisResult,
} from '../analysis/chartResults.js'
import { recommendedBinCount, type DistributionCurvePoint, type DistributionResult } from '../analysis/distributionEngine.js'
import { cartesianBase, categoryAxis, cornerForBars, cornerForPoints, valueAxis } from './chartBase.js'
import {
  confidenceBand,
  controlLines,
  fitRegression,
  oppositeCorner,
  referenceLineSeries,
  resolveCorner,
  statsBoxGraphic,
  statsRowsGraphic,
  type StatsRow,
} from './chartAnnotations.js'
import { chartSettingsFor, type ChartSettings } from './chartSettings.js'
import { GEOEYE_LINE_SMOOTHING, geoEyeChartColors } from './geoEyeTheme.js'

export interface GeoEyeChartDatum {
  itemStyle?: Record<string, unknown>
  matchedCount?: number
  name?: string
  sourceObservationIds: string[]
  symbolSize?: number
  value: number | string | Array<number | string | null>
}

interface AxisTitles {
  x: string
  y: string
}

/** "Label (unit)", or just the label when the variable has no unit. */
export const axisTitle = (label: string, unit?: string) => unit ? `${label} (${unit})` : label

interface DistributionChartConfig extends AxisTitles {
  decimals: number
  showDeclustered: boolean
  unit: string
  variableLabel: string
}

const groupColors = [
  geoEyeChartColors.primary, geoEyeChartColors.accent, geoEyeChartColors.violet,
  geoEyeChartColors.blue, '#70a58e', '#b06f7b', '#9d874d', '#537067',
]

/** Tooltips and labels round to the variable's decimals; raw float precision is unreadable. */
function round(value: unknown, decimals: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : '—'
}

function datum(value: GeoEyeChartDatum['value'], sourceObservationIds: readonly string[], extras: Partial<GeoEyeChartDatum> = {}): GeoEyeChartDatum {
  return { ...extras, sourceObservationIds: [...sourceObservationIds], value }
}

/** Keeps the signature of every builder optional, so a chart can be migrated to settings one at a time. */
function withDefaults(kind: Parameters<typeof chartSettingsFor>[0], settings?: ChartSettings) {
  return settings ?? chartSettingsFor(kind)
}

function graphicOf(elements: ReadonlyArray<unknown> | undefined) {
  return elements === undefined || elements.length === 0 ? {} : { graphic: { elements: [...elements] } }
}

/** A corner text note (regression equation, control-line tally) placed away from the stats box. */
function noteGraphic(lines: readonly string[], corner: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right') {
  if (lines.length === 0) return []
  const right = corner.endsWith('right')
  return [{
    ...(right ? { right: 14 } : { left: 14 }),
    style: {
      fill: geoEyeChartColors.text,
      font: '11px "Cascadia Mono", "Consolas", monospace',
      text: lines.join('\n'),
      textAlign: right ? 'right' as const : 'left' as const,
      textVerticalAlign: 'top' as const,
    },
    ...(corner.startsWith('top') ? { top: 34 } : { bottom: 12 }),
    type: 'text' as const,
  }]
}

// ---------------------------------------------------------------------------
// Distribution

interface WeightedSample {
  sourceObservationId: string
  value: number
  weight: number
}

interface SampleBin {
  from: number
  midpoint: number
  sourceObservationIds: string[]
  to: number
  weight: number
}

function samplesOf(points: readonly DistributionCurvePoint[], weighted: boolean): WeightedSample[] {
  return points.map((point) => ({
    sourceObservationId: point.sourceObservationId,
    value: point.value,
    weight: weighted ? point.weight : 1,
  }))
}

/**
 * Bins are rebuilt from the engine's per-observation curve rather than its fixed histogram, so the
 * bin count can be changed without a new run. With no count given the engine's own rule is used,
 * which reproduces the engine histogram exactly.
 */
function binSamples(samples: readonly WeightedSample[], binCount: number, minimum: number, maximum: number): SampleBin[] {
  const width = maximum === minimum ? 1 : (maximum - minimum) / binCount
  const bins = Array.from({ length: binCount }, (_, index): SampleBin => ({
    from: minimum + index * width,
    midpoint: minimum + width * (index + 0.5),
    sourceObservationIds: [],
    to: index === binCount - 1 ? maximum : minimum + (index + 1) * width,
    weight: 0,
  }))
  samples.forEach((sample) => {
    const rawIndex = Math.floor((sample.value - minimum) / width)
    const bin = bins[Math.max(0, Math.min(binCount - 1, rawIndex))]
    if (bin === undefined) return
    bin.weight += sample.weight
    bin.sourceObservationIds.push(sample.sourceObservationId)
  })
  return bins
}

function distributionBins(result: DistributionResult, settings: ChartSettings, weighted: boolean) {
  const samples = samplesOf(weighted ? result.representative.ecdf : result.sample.ecdf, weighted)
  const values = samples.map((sample) => sample.value)
  if (values.length === 0) return []
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  return binSamples(samples, settings.binCount ?? recommendedBinCount(values), minimum, maximum)
}

function normalDensity(value: number, mean: number, deviation: number) {
  if (deviation <= 0) return 0
  return Math.exp(-0.5 * ((value - mean) / deviation) ** 2) / (deviation * Math.sqrt(2 * Math.PI))
}

/** Normal or lognormal curve scaled to the bars it is drawn over. */
function fitCurveSeries(result: DistributionResult, settings: ChartSettings, bins: readonly SampleBin[], total: number) {
  if (settings.fitCurve === 'none' || bins.length === 0 || total === 0) return []
  const summary = result.sample.summary
  const first = bins[0]
  const last = bins.at(-1)
  if (first === undefined || last === undefined) return []
  const width = (last.to - first.from) / bins.length
  const lognormal = settings.fitCurve === 'lognormal'
  const mean = lognormal ? summary.logMean : summary.mean
  const deviation = lognormal
    ? summary.logVariance === null ? null : Math.sqrt(summary.logVariance)
    : summary.standardDeviation
  if (mean === null || deviation === null || deviation <= 0) return []
  const scale = settings.frequencyMode === 'relative' ? 100 : total
  const points = bins.map((bin) => {
    const density = lognormal
      ? bin.midpoint <= 0 ? 0 : normalDensity(Math.log(bin.midpoint), mean, deviation) / bin.midpoint
      : normalDensity(bin.midpoint, mean, deviation)
    return datum([bin.midpoint, density * width * scale], [])
  })
  return [{
    data: points,
    lineStyle: { color: geoEyeChartColors.danger, type: 'dashed' as const, width: 1.8 },
    name: lognormal ? 'Lognormal fit' : 'Normal fit',
    showSymbol: false,
    silent: true,
    smooth: GEOEYE_LINE_SMOOTHING,
    type: 'line' as const,
    yAxisIndex: 0,
  }]
}

export function buildHistogramOption(result: DistributionResult, config: DistributionChartConfig, settings?: ChartSettings): EChartsCoreOption {
  const active = withDefaults('histogram', settings)
  const relative = active.frequencyMode === 'relative'
  const rawBins = distributionBins(result, active, false)
  const declusteredBins = config.showDeclustered ? distributionBins(result, active, true) : []
  const label = (bin: SampleBin) => `${bin.from.toFixed(config.decimals)}–${bin.to.toFixed(config.decimals)}`
  const rawTotal = rawBins.reduce((sum, bin) => sum + bin.weight, 0)
  const declusteredTotal = declusteredBins.reduce((sum, bin) => sum + bin.weight, 0)
  const share = (bin: SampleBin, total: number) => relative ? (total === 0 ? 0 : bin.weight / total * 100) : bin.weight
  const series = (bins: readonly SampleBin[], total: number) => bins.map((bin) => datum(
    share(bin, total),
    bin.sourceObservationIds,
    { name: `${label(bin)} ${config.unit}` },
  ))
  const cumulative = !active.cumulative ? [] : [{
    data: rawBins.map((bin, index) => datum(
      [bin.midpoint, rawBins.slice(0, index + 1).reduce((sum, item) => sum + share(item, rawTotal), 0)],
      bin.sourceObservationIds,
    )),
    lineStyle: { color: geoEyeChartColors.blue, width: 1.8 },
    name: 'Cumulative',
    showSymbol: false,
    silent: true,
    smooth: GEOEYE_LINE_SMOOTHING,
    type: 'line' as const,
    yAxisIndex: 1,
  }]
  const axisName = relative ? 'Relative frequency (%)' : 'Frequency (count)'
  // Bars sit on a category axis, so a statistic is placed by the fractional bin it falls in.
  const firstBin = rawBins[0]
  const binWidth = firstBin === undefined ? 0 : firstBin.to - firstBin.from
  const binPosition = (value: number) => firstBin === undefined || binWidth <= 0
    ? null
    : (value - firstBin.from) / binWidth - 0.5
  const statsCorner = resolveCorner(active.statsCorner, cornerForBars(rawBins.map((bin) => bin.weight)))

  return {
    ...cartesianBase(false),
    // The cumulative overlay adds a right-hand axis, so the box moves in to clear its labels.
    ...graphicOf(statsBoxGraphic(result.sample.summary, active, statsCorner, undefined, active.cumulative ? 56 : 12)),
    series: [
      {
        barCategoryGap: '8%',
        barGap: '-100%',
        data: series(rawBins, rawTotal),
        emphasis: { focus: 'series' },
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: config.showDeclustered ? '#94a6ae' : geoEyeChartColors.primary,
          opacity: config.showDeclustered ? 0.42 : 0.86,
        },
        name: 'Raw',
        type: 'bar',
      },
      ...(config.showDeclustered ? [{
        barGap: '-100%',
        barWidth: '68%',
        data: series(declusteredBins, declusteredTotal),
        emphasis: { focus: 'series' },
        itemStyle: { borderRadius: [4, 4, 0, 0], color: geoEyeChartColors.primary, opacity: 0.9 },
        name: 'Declustered',
        type: 'bar',
      }] : []),
      ...fitCurveSeries(result, active, rawBins, rawTotal),
      ...cumulative,
      ...referenceLineSeries(result.sample.summary, active, 'x', binPosition),
    ],
    tooltip: {
      axisPointer: { type: 'shadow' },
      confine: true,
      trigger: 'axis',
      valueFormatter: (value: number) => relative ? `${value.toFixed(1)}%` : value.toFixed(0),
    },
    xAxis: categoryAxis(axisTitle(config.variableLabel, config.unit), rawBins.map(label)),
    yAxis: active.cumulative
      ? [
          { ...valueAxis(axisName), axisLabel: relative ? { formatter: '{value}%' } : {}, min: 0 },
          { ...valueAxis('Cumulative (%)'), axisLabel: { formatter: '{value}%' }, max: 100, min: 0, splitLine: { show: false } },
        ]
      : { ...valueAxis(axisName), axisLabel: relative ? { formatter: '{value}%' } : {}, min: 0 },
  } as EChartsCoreOption
}

/**
 * The ECDF has one step per sample. With a bin count set it is reported at that many evenly spaced
 * values instead, which is easier to read against a binned histogram.
 */
function cdfPoints(points: readonly DistributionCurvePoint[], binCount: number | null) {
  if (binCount === null || points.length <= binCount) return points
  const values = points.map((point) => point.value)
  const minimum = Math.min(...values)
  const width = (Math.max(...values) - minimum) / binCount
  if (!(width > 0)) return points
  return Array.from({ length: binCount }, (_, index) => {
    const edge = minimum + width * (index + 1)
    const inside = points.filter((point) => point.value <= edge)
    const last = inside.at(-1)
    return {
      probability: last?.probability ?? 0,
      sourceObservationId: last?.sourceObservationId ?? '',
      value: edge,
      weight: last?.weight ?? 0,
    }
  })
}

export function buildCdfOption(result: DistributionResult, config: DistributionChartConfig, settings?: ChartSettings): EChartsCoreOption {
  const active = withDefaults('cdf', settings)
  const sample = cdfPoints(result.sample.ecdf, active.binCount)
  const representative = cdfPoints(result.representative.ecdf, active.binCount)
  const statsCorner = resolveCorner(active.statsCorner, cornerForPoints(sample.map((point) => ({ x: point.value, y: point.probability }))))
  const series = [
    {
      data: sample.map((point) => datum([point.value, point.probability], [point.sourceObservationId])),
      itemStyle: { color: geoEyeChartColors.muted },
      lineStyle: { color: geoEyeChartColors.muted },
      name: 'Raw',
      showSymbol: sample.length <= 32,
      smooth: GEOEYE_LINE_SMOOTHING,
      smoothMonotone: 'y',
      symbolSize: 5,
      type: 'line',
    },
    ...(config.showDeclustered ? [{
      data: representative.map((point) => datum([point.value, point.probability], [point.sourceObservationId])),
      itemStyle: { color: geoEyeChartColors.primary },
      lineStyle: { color: geoEyeChartColors.primary },
      name: 'Declustered',
      showSymbol: representative.length <= 32,
      smooth: GEOEYE_LINE_SMOOTHING,
      smoothMonotone: 'y',
      symbolSize: 5,
      type: 'line',
    }] : []),
    ...referenceLineSeries(result.sample.summary, active, 'x'),
  ]
  return {
    ...cartesianBase(),
    ...graphicOf(statsBoxGraphic(result.sample.summary, active, statsCorner)),
    series,
    // One reading per point: an axis tooltip would list every sample sharing the bucket, unrounded.
    tooltip: {
      confine: true,
      formatter: (params: { data?: GeoEyeChartDatum; seriesName?: string }) => {
        const value = Array.isArray(params.data?.value) ? params.data.value : []
        return `${params.seriesName ?? ''}<br/>${round(value[0], config.decimals)} ${config.unit}<br/>${round(Number(value[1]) * 100, 1)}% cumulative`
      },
      trigger: 'item',
    },
    xAxis: valueAxis(axisTitle(config.variableLabel, config.unit)),
    yAxis: { ...valueAxis('Cumulative probability'), axisLabel: { formatter: (value: number) => `${Math.round(value * 100)}%` }, max: 1, min: 0 },
  } as EChartsCoreOption
}

export function buildProbabilityPlotOption(result: DistributionResult, config: DistributionChartConfig, settings?: ChartSettings): EChartsCoreOption {
  const active = withDefaults('probability', settings)
  const statsCorner = resolveCorner(active.statsCorner, cornerForPoints(
    result.sample.probabilityPlot.map((point) => ({ x: point.expectedQuantile, y: point.value })),
  ))
  return {
    ...cartesianBase(),
    ...graphicOf(statsBoxGraphic(result.sample.summary, active, statsCorner)),
    series: [
      {
        data: result.sample.probabilityPlot.map((point) => datum([point.expectedQuantile, point.value], [point.sourceObservationId])),
        emphasis: { focus: 'series', scale: 1.35 },
        itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 1, color: geoEyeChartColors.blue, opacity: 0.72 },
        name: 'Raw',
        symbolSize: 7,
        type: 'scatter',
      },
      ...(config.showDeclustered ? [{
        data: result.representative.probabilityPlot.map((point) => datum([point.expectedQuantile, point.value], [point.sourceObservationId])),
        emphasis: { focus: 'series', scale: 1.35 },
        itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 1, color: geoEyeChartColors.violet, opacity: 0.78 },
        name: 'Declustered',
        symbolSize: 7,
        type: 'scatter',
      }] : []),
      ...referenceLineSeries(result.sample.summary, active, 'y'),
    ],
    tooltip: {
      confine: true,
      formatter: (params: { data?: GeoEyeChartDatum; seriesName?: string }) => {
        const value = Array.isArray(params.data?.value) ? params.data.value : []
        return `${params.seriesName ?? ''}<br/>Quantile ${round(value[0], 2)}<br/>${round(value[1], config.decimals)} ${config.unit}`
      },
      trigger: 'item',
    },
    xAxis: valueAxis('Expected normal quantile'),
    yAxis: valueAxis(axisTitle(config.variableLabel, config.unit)),
  } as EChartsCoreOption
}

function quantileOf(sorted: readonly number[], probability: number) {
  if (sorted.length === 0) return 0
  const index = (sorted.length - 1) * Math.max(0, Math.min(1, probability))
  const lower = sorted[Math.floor(index)] ?? 0
  const upper = sorted[Math.ceil(index)] ?? lower
  return lower + (upper - lower) * (index - Math.floor(index))
}

export interface BoxWhiskerGroup {
  category: string
  samples: ReadonlyArray<{ sourceObservationId: string; value: number }>
}

interface WhiskerResult {
  high: number
  low: number
  median: number
  outliers: Array<{ sourceObservationId: string; value: number }>
  q1: number
  q3: number
}

/** Whisker extent follows the chosen rule; whatever falls outside it is reported as an outlier. */
function whiskersOf(values: readonly number[], settings: ChartSettings): Omit<WhiskerResult, 'outliers'> {
  const sorted = [...values].sort((left, right) => left - right)
  const q1 = quantileOf(sorted, 0.25)
  const q3 = quantileOf(sorted, 0.75)
  const median = quantileOf(sorted, 0.5)
  const minimum = sorted[0] ?? 0
  const maximum = sorted.at(-1) ?? 0
  if (settings.whiskerMode === 'tukey') {
    const span = (q3 - q1) * 1.5
    return {
      high: Math.min(maximum, sorted.filter((value) => value <= q3 + span).at(-1) ?? q3),
      low: Math.max(minimum, sorted.find((value) => value >= q1 - span) ?? q1),
      median, q1, q3,
    }
  }
  if (settings.whiskerMode === 'percentile') {
    const lower = Math.max(0, Math.min(49, settings.whiskerPercent)) / 100
    return { high: quantileOf(sorted, 1 - lower), low: quantileOf(sorted, lower), median, q1, q3 }
  }
  return { high: maximum, low: minimum, median, q1, q3 }
}

/** Box plots for any number of populations on one axis, with optional outliers and raw points. */
export function buildGroupedBoxPlotOption(groups: readonly BoxWhiskerGroup[], titles: AxisTitles, settings?: ChartSettings): EChartsCoreOption {
  const active = withDefaults('box', settings)
  const computed = groups.map((group) => {
    const values = group.samples.map((sample) => sample.value)
    const whiskers = whiskersOf(values, active)
    return {
      ...whiskers,
      category: active.showPopulationSize ? `${group.category}\nn=${values.length.toLocaleString()}` : group.category,
      outliers: group.samples.filter((sample) => sample.value < whiskers.low || sample.value > whiskers.high),
      samples: group.samples,
      sourceObservationIds: group.samples.map((sample) => sample.sourceObservationId),
    }
  })
  const scatterSeries = (name: string, color: string, pick: (group: typeof computed[number]) => ReadonlyArray<{ sourceObservationId: string; value: number }>) => [{
    data: computed.flatMap((group, index) => pick(group).map((sample) => datum(
      [index, sample.value],
      [sample.sourceObservationId],
      { name: group.category },
    ))),
    itemStyle: { color, opacity: 0.65 },
    name,
    symbolSize: 5,
    type: 'scatter' as const,
  }]
  return {
    ...cartesianBase(false),
    grid: { bottom: 28, containLabel: true, left: 22, right: 22, top: 24 },
    legend: { show: false },
    series: [
      {
        boxWidth: [22, 76],
        data: computed.map((group) => datum(
          [group.low, group.q1, group.median, group.q3, group.high],
          group.sourceObservationIds,
          { name: group.category },
        )),
        emphasis: { focus: 'series', itemStyle: { borderColor: geoEyeChartColors.selected, borderWidth: 2.5 } },
        itemStyle: { borderColor: geoEyeChartColors.primary, borderWidth: 2, color: geoEyeChartColors.primarySoft },
        name: titles.y,
        type: 'boxplot',
      },
      ...(active.showPoints ? scatterSeries('Samples', geoEyeChartColors.blue, (group) => group.samples) : []),
      ...(active.showOutliers && !active.showPoints ? scatterSeries('Outliers', geoEyeChartColors.danger, (group) => group.outliers) : []),
    ],
    tooltip: {
      confine: true,
      trigger: 'item',
    },
    xAxis: categoryAxis(titles.x, computed.map((group) => group.category)),
    yAxis: valueAxis(titles.y),
  } as EChartsCoreOption
}

export function buildDistributionBoxPlotOption(result: DistributionResult, config: DistributionChartConfig, settings?: ChartSettings): EChartsCoreOption {
  const groups: BoxWhiskerGroup[] = [
    { category: 'Raw', samples: result.sample.ecdf.map((point) => ({ sourceObservationId: point.sourceObservationId, value: point.value })) },
    ...(config.showDeclustered
      ? [{ category: 'Declustered', samples: result.representative.ecdf.map((point) => ({ sourceObservationId: point.sourceObservationId, value: point.value })) }]
      : []),
  ]
  return buildGroupedBoxPlotOption(groups, { x: '', y: axisTitle(config.variableLabel, config.unit) }, settings)
}

// ---------------------------------------------------------------------------
// Relationships

function groupValue(point: ScatterAnalysisResult['points'][number], colorBy: string) {
  if (colorBy === 'drillhole') return point.holeId
  return point.dimensions[colorBy] ?? 'Unassigned'
}

function lineAcross(from: number, to: number, at: (x: number) => number, ids: readonly string[], steps = 2) {
  return Array.from({ length: steps }, (_, index) => {
    const x = from + (to - from) * (index / (steps - 1))
    return datum([x, at(x)], ids)
  })
}

export type ScatterOverlay = 'none' | 'one-to-one' | 'priest-hudson' | 'calibration'
export interface ScatterOverlayOptions { kind: ScatterOverlay; factor?: number }

/** Reference curves for geotech relationships: 1:1, Priest & Hudson RQD(λ) = 100·e^(−0.1λ)(0.1λ+1), or y = k·x. */
function overlaySeries(overlay: ScatterOverlayOptions | undefined, minX: number, maxX: number, maxY: number) {
  if (overlay === undefined || overlay.kind === 'none') return []
  const base = { showSymbol: false, silent: true, smooth: false, type: 'line', lineStyle: { color: geoEyeChartColors.muted, type: 'dotted', width: 1.5 } }
  if (overlay.kind === 'one-to-one') { const m = Math.max(maxX, maxY); return [{ ...base, name: '1:1', data: [[0, 0], [m, m]] }] }
  if (overlay.kind === 'calibration') { const k = overlay.factor ?? 24; return [{ ...base, name: `y = ${k}·x`, data: [[0, 0], [maxX, k * maxX]] }] }
  const steps = 60
  return [{ ...base, name: 'Priest & Hudson', data: Array.from({ length: steps + 1 }, (_, i) => { const l = minX + ((maxX - minX) * i) / steps; return [l, 100 * Math.exp(-0.1 * l) * (0.1 * l + 1)] }) }]
}

export function buildScatterOption(result: ScatterAnalysisResult, titles: AxisTitles, settings?: ChartSettings, overlay?: ScatterOverlayOptions): EChartsCoreOption {
  const active = withDefaults('scatter', settings)
  const points = result.points
  const xValues = points.map((point) => point.x)
  const yValues = points.map((point) => point.y)
  const minimumX = xValues.length === 0 ? 0 : Math.min(...xValues)
  const maximumX = xValues.length === 0 ? 1 : Math.max(...xValues)
  const shared = xValues.length === 0
    ? { maximum: 1, minimum: 0 }
    : { maximum: Math.max(maximumX, ...yValues), minimum: Math.min(minimumX, ...yValues) }
  const control = controlLines(points, active)
  const fit = fitRegression(points, active)
  const notes: string[] = []

  const pointSeries = () => {
    if (active.colorBy !== null) {
      const groups = Array.from(new Set(points.map((point) => groupValue(point, active.colorBy ?? '')))).sort()
      return groups.map((group, index) => ({
        data: points.filter((point) => groupValue(point, active.colorBy ?? '') === group).map((point) => datum([point.x, point.y], point.sourceObservationIds, { name: point.holeId })),
        emphasis: { focus: 'series', scale: 1.35 },
        itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 1, color: groupColors[index % groupColors.length] },
        name: String(group),
        symbolSize: active.symbolSize,
        type: 'scatter' as const,
      }))
    }
    if (control !== null && active.colorByControlLines) {
      return [true, false].map((inside) => ({
        data: points.filter((point) => control.isInside(point) === inside).map((point) => datum([point.x, point.y], point.sourceObservationIds, { name: point.holeId })),
        emphasis: { focus: 'series', scale: 1.35 },
        itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 1, color: inside ? geoEyeChartColors.primary : geoEyeChartColors.danger },
        name: inside ? 'Inside control lines' : 'Outside control lines',
        symbolSize: active.symbolSize,
        type: 'scatter' as const,
      }))
    }
    return [{
      data: points.map((point) => datum([point.x, point.y], point.sourceObservationIds, { name: point.holeId })),
      emphasis: { focus: 'series', scale: 1.35 },
      itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 1, color: geoEyeChartColors.primary },
      name: 'Observations',
      symbolSize: active.symbolSize,
      type: 'scatter' as const,
    }]
  }

  const referenceSeries = []
  if (active.showOneToOne) {
    referenceSeries.push({
      data: lineAcross(shared.minimum, shared.maximum, (x) => x, result.sourceObservationIds),
      lineStyle: { color: geoEyeChartColors.muted, type: 'solid' as const, width: 1.2 },
      name: '1:1',
      showSymbol: false,
      silent: true,
      type: 'line' as const,
    })
  }
  if (control !== null) {
    const offset = (sign: number) => (x: number) => active.controlLineMode === 'percent'
      ? x * (1 + sign * active.controlLineValue / 100)
      : x + sign * active.controlLineValue
    for (const sign of [1, -1]) {
      referenceSeries.push({
        data: lineAcross(shared.minimum, shared.maximum, offset(sign), result.sourceObservationIds),
        lineStyle: { color: geoEyeChartColors.danger, type: 'dashed' as const, width: 1.1 },
        name: sign === 1 ? `Control +${active.controlLineValue}${active.controlLineMode === 'percent' ? '%' : ''}` : `Control −${active.controlLineValue}${active.controlLineMode === 'percent' ? '%' : ''}`,
        showSymbol: false,
        silent: true,
        type: 'line' as const,
      })
    }
    notes.push(`${(control.inside / Math.max(1, points.length) * 100).toFixed(1)}% inside (${control.inside.toLocaleString()} of ${points.length.toLocaleString()})`)
  }
  if (fit !== null) {
    referenceSeries.push({
      data: lineAcross(minimumX, maximumX, fit.at, result.sourceObservationIds, active.regressionModel === 'linear' ? 2 : 48),
      lineStyle: { color: geoEyeChartColors.accent, type: 'dashed' as const, width: 1.6 },
      name: active.regressionMethod === 'reduced-major-axis' ? 'Reduced major axis' : 'Regression',
      showSymbol: false,
      silent: true,
      smooth: active.regressionModel === 'linear' ? false : GEOEYE_LINE_SMOOTHING,
      type: 'line' as const,
    })
    if (active.showEquation) notes.push(fit.label, `R² = ${fit.rSquared.toFixed(3)} · n = ${points.length.toLocaleString()}`)
    if (active.confidence !== null && active.regressionModel === 'linear') {
      const band = confidenceBand(points, fit, active.confidence)
      for (const edge of ['lower', 'upper'] as const) {
        referenceSeries.push({
          data: band.map((item) => datum([item.x, item[edge]], [])),
          lineStyle: { color: geoEyeChartColors.accent, opacity: 0.55, type: 'dotted' as const, width: 1 },
          name: edge === 'lower' ? `${active.confidence}% confidence` : '',
          showSymbol: false,
          silent: true,
          type: 'line' as const,
          ...(edge === 'upper' ? { tooltip: { show: false } } : {}),
        })
      }
    }
  }

  const bounds = active.sameScale ? { max: shared.maximum, min: shared.minimum } : {}
  const maximumY = yValues.length === 0 ? 1 : Math.max(...yValues)
  const statsCorner = resolveCorner(active.statsCorner, cornerForPoints(points))
  const noteCorner = active.statsBox ? oppositeCorner(statsCorner) : statsCorner
  const diagnostics: StatsRow[] = [
    { label: 'Count', value: points.length.toLocaleString() },
    { label: 'Pearson r', value: round(result.correlation, 3) },
    { label: 'Spearman ρ', value: round(result.spearman, 3) },
    ...(fit === null ? [] : [{ label: 'R²', value: fit.rSquared.toFixed(3) }]),
  ]
  return {
    ...cartesianBase(),
    ...graphicOf([
      ...(active.statsBox ? statsRowsGraphic(diagnostics, active, statsCorner) ?? [] : []),
      ...noteGraphic(notes, noteCorner),
    ]),
    series: [...pointSeries(), ...referenceSeries, ...overlaySeries(overlay, Math.min(0, minimumX), maximumX, maximumY)],
    tooltip: {
      confine: true,
      formatter: (params: { data?: GeoEyeChartDatum; seriesName?: string }) => {
        const value = Array.isArray(params.data?.value) ? params.data.value : []
        const name = params.data?.name
        return `${name === undefined || name === '' ? params.seriesName ?? '' : name}<br/>${titles.x}: ${round(value[0], active.decimals)}<br/>${titles.y}: ${round(value[1], active.decimals)}`
      },
      trigger: 'item',
    },
    xAxis: { ...valueAxis(titles.x), ...bounds },
    yAxis: { ...valueAxis(titles.y), ...bounds },
  } as EChartsCoreOption
}


export function buildCorrelationOption(result: CorrelationAnalysisResult, settings?: ChartSettings): EChartsCoreOption {
  const active = withDefaults('matrix', settings)
  const coefficientLabel = result.method === 'pearson' ? 'Pearson r' : 'Spearman ρ'
  const visible = result.cells.filter((cell) => {
    if (active.matrixShape === 'lower') return cell.row >= cell.column
    if (active.matrixShape === 'upper') return cell.row <= cell.column
    return true
  })
  return {
    ...cartesianBase(false),
    grid: { bottom: 28, containLabel: true, left: 22, right: 64, top: 30 },
    series: [{
      data: visible.map((cell) => datum(
        [cell.column, cell.row, cell.value],
        cell.sourceObservationIds,
        {
          matchedCount: cell.count,
          ...(cell.value !== null && Math.abs(cell.value) < active.matrixThreshold ? { itemStyle: { opacity: 0.3 } } : {}),
        },
      )),
      emphasis: { itemStyle: { borderColor: geoEyeChartColors.text, borderWidth: 2 } },
      itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 2 },
      label: {
        formatter: (params: { data?: GeoEyeChartDatum }) => {
          const value = Array.isArray(params.data?.value) ? params.data.value[2] : null
          return typeof value === 'number' ? value.toFixed(active.decimals) : '—'
        },
        fontSize: 11,
        fontWeight: 600,
        show: true,
      },
      name: coefficientLabel,
      type: 'heatmap',
    }],
    tooltip: {
      confine: true,
      formatter: (params: { data?: GeoEyeChartDatum }) => {
        const value = Array.isArray(params.data?.value) ? params.data.value[2] : null
        const column = Array.isArray(params.data?.value) ? Number(params.data.value[0]) : -1
        const row = Array.isArray(params.data?.value) ? Number(params.data.value[1]) : -1
        return `${result.labels[row] ?? ''} × ${result.labels[column] ?? ''}<br/>${coefficientLabel}: ${typeof value === 'number' ? value.toFixed(3) : '—'}<br/>Matched n: ${params.data?.matchedCount ?? 0}<br/><em>Click to open the scatter plot</em>`
      },
      trigger: 'item',
    },
    visualMap: {
      calculable: false,
      inRange: { color: [geoEyeChartColors.danger, '#eef1ee', geoEyeChartColors.primary] },
      max: 1,
      min: -1,
      orient: 'vertical',
      right: 4,
      top: 'middle',
    },
    xAxis: categoryAxis('', result.labels),
    yAxis: categoryAxis('', result.labels),
  } as EChartsCoreOption
}

export function buildQqOption(result: QqAnalysisResult, titles: AxisTitles, settings?: ChartSettings): EChartsCoreOption {
  const active = withDefaults('qq', settings)
  const values = result.points.flatMap((point) => [point.x, point.y])
  const minimum = values.length === 0 ? 0 : Math.min(...values)
  const maximum = values.length === 0 ? 1 : Math.max(...values)
  const fit = fitRegression(result.points, active)
  const bounds = active.sameScale ? { max: maximum, min: minimum } : {}
  const noteCorner = resolveCorner(active.statsCorner, cornerForPoints(result.points))
  return {
    ...cartesianBase(),
    ...graphicOf(noteGraphic(fit === null || !active.showEquation ? [] : [fit.label, `R² = ${fit.rSquared.toFixed(3)}`], noteCorner)),
    series: [
      {
        data: result.points.map((point) => datum([point.x, point.y], point.sourceObservationIds, { name: `${(point.probability * 100).toFixed(1)}th percentile` })),
        emphasis: { focus: 'series', scale: 1.35 },
        itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 1, color: geoEyeChartColors.violet },
        name: 'Quantile pairs',
        symbolSize: active.symbolSize,
        type: 'scatter',
      },
      ...(active.showOneToOne ? [{
        data: lineAcross(minimum, maximum, (x) => x, result.sourceObservationIds),
        lineStyle: { color: geoEyeChartColors.muted, width: 1.2 },
        name: '1:1',
        showSymbol: false,
        silent: true,
        type: 'line' as const,
      }] : []),
      ...(fit === null ? [] : [{
        data: lineAcross(minimum, maximum, fit.at, result.sourceObservationIds, active.regressionModel === 'linear' ? 2 : 48),
        lineStyle: { color: geoEyeChartColors.accent, type: 'dashed' as const, width: 1.5 },
        name: 'Quantile fit',
        showSymbol: false,
        silent: true,
        type: 'line' as const,
      }]),
    ],
    tooltip: {
      confine: true,
      formatter: (params: { data?: GeoEyeChartDatum; seriesName?: string }) => {
        const value = Array.isArray(params.data?.value) ? params.data.value : []
        return `${params.data?.name ?? params.seriesName ?? ''}<br/>${titles.x}: ${round(value[0], active.decimals)}<br/>${titles.y}: ${round(value[1], active.decimals)}`
      },
      trigger: 'item',
    },
    xAxis: { ...valueAxis(titles.x), ...bounds },
    yAxis: { ...valueAxis(titles.y), ...bounds },
  } as EChartsCoreOption
}

export function buildSwathOption(result: SwathAnalysisResult, titles: AxisTitles): EChartsCoreOption {
  const seriesFor = (name: string, key: 'mean' | 'median', color: string, dashed = false) => ({
    data: result.bins.map((bin) => datum([bin.midpoint, bin[key]], bin.ids)),
    itemStyle: { color },
    lineStyle: { color, type: dashed ? 'dashed' : 'solid', width: 2.4 },
    name,
    smooth: GEOEYE_LINE_SMOOTHING,
    symbolSize: 7,
    type: 'line',
  })
  return {
    ...cartesianBase(),
    series: [
      seriesFor('Mean', 'mean', geoEyeChartColors.primary),
      seriesFor('Median', 'median', geoEyeChartColors.accent, true),
    ],
    tooltip: { confine: true, trigger: 'axis', valueFormatter: (value: number) => round(value, 2) },
    xAxis: valueAxis(titles.x),
    yAxis: valueAxis(titles.y),
  } as EChartsCoreOption
}

export function buildBoxPlotOption(result: BoxPlotAnalysisResult, titles: AxisTitles): EChartsCoreOption {
  return {
    ...cartesianBase(false),
    grid: { bottom: 28, containLabel: true, left: 22, right: 22, top: 24 },
    legend: { show: false },
    series: [{
      boxWidth: [44, 92],
      data: result.groups.map((group) => datum(
        [group.low, group.q1, group.median, group.q3, group.high],
        group.sourceObservationIds,
        { name: group.category },
      )),
      emphasis: { focus: 'series', itemStyle: { borderColor: geoEyeChartColors.selected, borderWidth: 2.5 } },
      itemStyle: { borderColor: geoEyeChartColors.primary, borderWidth: 2, color: geoEyeChartColors.primarySoft },
      name: titles.y,
      type: 'boxplot',
    }],
    xAxis: categoryAxis(titles.x, result.groups.map((group) => group.category)),
    yAxis: valueAxis(titles.y),
  } as EChartsCoreOption
}

export function buildHeatmapOption(result: HeatmapAnalysisResult, titles: AxisTitles): EChartsCoreOption {
  const values = result.cells.map((cell) => cell.value)
  return {
    ...cartesianBase(false),
    series: [{
      data: result.cells.map((cell) => datum([cell.column, cell.row, cell.value], cell.sourceObservationIds)),
      itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 2 },
      name: titles.y,
      type: 'heatmap',
    }],
    visualMap: {
      calculable: true,
      inRange: { color: ['#edf3f1', '#7facbd', geoEyeChartColors.primary] },
      max: values.length === 0 ? 1 : Math.max(...values),
      min: values.length === 0 ? 0 : Math.min(...values),
      orient: 'horizontal',
      right: 10,
      top: 4,
    },
    xAxis: categoryAxis(titles.x, result.columns),
    yAxis: categoryAxis(titles.y, result.rows),
  } as EChartsCoreOption
}

export function buildVariogramOption(result: VariogramAnalysisResult, titles: AxisTitles): EChartsCoreOption {
  return {
    ...cartesianBase(),
    series: [
      {
        data: result.experimental.map((point) => datum([point.lag, point.semivariance], point.sourceObservationIds)),
        itemStyle: { color: geoEyeChartColors.primary },
        name: 'Experimental',
        symbolSize: 7,
        type: 'scatter',
      },
      {
        data: result.model.map((point) => datum([point.lag, point.semivariance], point.sourceObservationIds)),
        itemStyle: { color: geoEyeChartColors.accent },
        lineStyle: { color: geoEyeChartColors.accent, width: 2 },
        name: 'Model',
        showSymbol: false,
        smooth: GEOEYE_LINE_SMOOTHING,
        type: 'line',
      },
    ],
    xAxis: valueAxis(titles.x),
    yAxis: valueAxis(titles.y),
  } as EChartsCoreOption
}

export function buildDownholeTrackOption(result: DownholeTrackResult, valueTitle: string): EChartsCoreOption {
  const roleColor = {
    accent: geoEyeChartColors.accent,
    muted: geoEyeChartColors.muted,
    primary: geoEyeChartColors.primary,
    violet: geoEyeChartColors.violet,
  }
  return {
    ...cartesianBase(),
    grid: { bottom: 28, containLabel: true, left: 24, right: 22, top: 52 },
    series: result.tracks.map((track) => {
      const color = roleColor[track.colorRole ?? 'primary']
      return {
        data: track.points.map((point) => datum([point.value, point.depth], point.sourceObservationIds)),
        itemStyle: { color },
        lineStyle: { color, width: 1.8 },
        name: track.name,
        showSymbol: true,
        smooth: GEOEYE_LINE_SMOOTHING,
        symbolSize: 5,
        type: 'line',
      }
    }),
    xAxis: valueAxis(valueTitle),
    yAxis: valueAxis('Depth (m)', { inverse: true }),
  } as EChartsCoreOption
}

export function buildAnalyticalSeriesOption(result: AnalyticalSeriesResult, titles: AxisTitles): EChartsCoreOption {
  return {
    ...cartesianBase(false),
    grid: { bottom: 28, containLabel: true, left: 24, right: 18, top: 48 },
    series: result.series.map((series, index) => ({
      barGap: '-100%',
      data: series.points.map((point) => datum([point.x, point.y], point.sourceObservationIds)),
      itemStyle: { color: index === 0 ? geoEyeChartColors.primary : geoEyeChartColors.muted, opacity: series.style === 'bar' ? 0.38 : 0.88 },
      lineStyle: { color: index === 0 ? geoEyeChartColors.primary : geoEyeChartColors.accent, type: index === 0 ? 'solid' : 'dashed' },
      name: series.name,
      showSymbol: series.style === 'line',
      smooth: series.style === 'line' ? GEOEYE_LINE_SMOOTHING : false,
      symbolSize: 5,
      type: series.style,
    })),
    xAxis: valueAxis(titles.x),
    yAxis: valueAxis(titles.y),
  } as EChartsCoreOption
}
