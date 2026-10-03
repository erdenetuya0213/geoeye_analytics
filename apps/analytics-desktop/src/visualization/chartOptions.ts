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
import type { DistributionResult } from '../analysis/distributionEngine.js'
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

interface DistributionChartConfig extends AxisTitles {
  decimals: number
  showDeclustered: boolean
  unit: string
  variableLabel: string
}

function valueAxis(name: string, inverse = false) {
  return {
    axisLabel: { hideOverlap: true },
    axisLine: { show: true },
    axisTick: { show: false },
    inverse,
    name,
    nameGap: 42,
    nameLocation: 'middle' as const,
    scale: true,
    splitLine: { lineStyle: { color: geoEyeChartColors.grid }, show: true },
    splitNumber: 5,
    type: 'value' as const,
  }
}

function categoryAxis(name: string, values: readonly string[]) {
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

function cartesianBase(selectable = true) {
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

function datum(value: GeoEyeChartDatum['value'], sourceObservationIds: readonly string[], extras: Partial<GeoEyeChartDatum> = {}): GeoEyeChartDatum {
  return { ...extras, sourceObservationIds: [...sourceObservationIds], value }
}

export function buildHistogramOption(result: DistributionResult, config: DistributionChartConfig): EChartsCoreOption {
  const rawTotal = result.histogram.reduce((sum, bin) => sum + bin.rawCount, 0)
  const declusteredTotal = result.histogram.reduce((sum, bin) => sum + bin.representativeCount, 0)
  const labels = result.histogram.map((bin) => `${bin.from.toFixed(config.decimals)}–${bin.to.toFixed(config.decimals)}`)
  const rawData = result.histogram.map((bin) => datum(
    rawTotal === 0 ? 0 : bin.rawCount / rawTotal * 100,
    bin.sourceObservationIds,
    { name: `${bin.from.toFixed(config.decimals)}–${bin.to.toFixed(config.decimals)} ${config.unit}` },
  ))
  const declusteredData = result.histogram.map((bin) => datum(
    declusteredTotal === 0 ? 0 : bin.representativeCount / declusteredTotal * 100,
    bin.sourceObservationIds,
    { name: `${bin.from.toFixed(config.decimals)}–${bin.to.toFixed(config.decimals)} ${config.unit}` },
  ))
  return {
    ...cartesianBase(false),
    series: [
      {
        barGap: '-100%',
        barCategoryGap: '8%',
        data: rawData,
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
        data: declusteredData,
        emphasis: { focus: 'series' },
        itemStyle: { borderRadius: [4, 4, 0, 0], color: geoEyeChartColors.primary, opacity: 0.9 },
        name: 'Declustered',
        type: 'bar',
      }] : []),
    ],
    tooltip: { axisPointer: { type: 'shadow' }, confine: true, trigger: 'axis', valueFormatter: (value: number) => `${value.toFixed(1)}%` },
    xAxis: categoryAxis(`${config.variableLabel} (${config.unit})`, labels),
    yAxis: { ...valueAxis('Relative frequency (%)'), axisLabel: { formatter: '{value}%' }, min: 0 },
  } as EChartsCoreOption
}

export function buildCdfOption(result: DistributionResult, config: DistributionChartConfig): EChartsCoreOption {
  const series = [
    {
      data: result.sample.ecdf.map((point) => datum([point.value, point.probability], [point.sourceObservationId])),
      itemStyle: { color: geoEyeChartColors.muted },
      lineStyle: { color: geoEyeChartColors.muted },
      name: 'Raw',
      showSymbol: result.sample.ecdf.length <= 32,
      smooth: GEOEYE_LINE_SMOOTHING,
      smoothMonotone: 'y',
      symbolSize: 5,
      type: 'line',
    },
    ...(config.showDeclustered ? [{
      data: result.representative.ecdf.map((point) => datum([point.value, point.probability], [point.sourceObservationId])),
      itemStyle: { color: geoEyeChartColors.primary },
      lineStyle: { color: geoEyeChartColors.primary },
      name: 'Declustered',
      showSymbol: result.representative.ecdf.length <= 32,
      smooth: GEOEYE_LINE_SMOOTHING,
      smoothMonotone: 'y',
      symbolSize: 5,
      type: 'line',
    }] : []),
  ]
  return {
    ...cartesianBase(),
    series,
    tooltip: { confine: true, trigger: 'axis' },
    xAxis: valueAxis(`${config.variableLabel} (${config.unit})`),
    yAxis: { ...valueAxis('Cumulative probability'), axisLabel: { formatter: (value: number) => `${Math.round(value * 100)}%` }, max: 1, min: 0 },
  } as EChartsCoreOption
}

export function buildProbabilityPlotOption(result: DistributionResult, config: DistributionChartConfig): EChartsCoreOption {
  return {
    ...cartesianBase(),
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
    ],
    xAxis: valueAxis('Expected normal quantile'),
    yAxis: valueAxis(`${config.variableLabel} (${config.unit})`),
  } as EChartsCoreOption
}

export function buildDistributionBoxPlotOption(result: DistributionResult, config: DistributionChartConfig): EChartsCoreOption {
  const sourceObservationIds = Array.from(new Set(result.histogram.flatMap((bin) => bin.sourceObservationIds)))
  const group = (category: string, summary: DistributionResult['sample']['summary']) => ({
    category,
    high: summary.maximum,
    low: summary.minimum,
    median: summary.median,
    q1: summary.q1,
    q3: summary.q3,
    sourceObservationIds,
  })
  return buildBoxPlotOption({
    groups: [
      group('Raw', result.sample.summary),
      ...(config.showDeclustered ? [group('Declustered', result.representative.summary)] : []),
    ],
    kind: 'box-plot',
  }, { x: '', y: `${config.variableLabel} (${config.unit})` })
}

export function buildScatterOption(result: ScatterAnalysisResult, titles: AxisTitles): EChartsCoreOption {
  const xValues = result.points.map((point) => point.x)
  const minimumX = xValues.length === 0 ? 0 : Math.min(...xValues)
  const maximumX = xValues.length === 0 ? 1 : Math.max(...xValues)
  const regressionData = result.regression === null ? [] : [minimumX, maximumX].map((x) => datum(
    [x, result.regression!.intercept + result.regression!.slope * x],
    result.sourceObservationIds,
  ))
  return {
    ...cartesianBase(),
    series: [
      {
        data: result.points.map((point) => datum([point.x, point.y], point.sourceObservationIds)),
        emphasis: { focus: 'series', scale: 1.35 },
        itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 1, color: geoEyeChartColors.primary, opacity: 0.78 },
        name: 'Observations',
        symbolSize: 7,
        type: 'scatter',
      },
      ...(regressionData.length === 0 ? [] : [{
        data: regressionData,
        itemStyle: { color: geoEyeChartColors.accent },
        lineStyle: { color: geoEyeChartColors.accent, type: 'dashed', width: 1.5 },
        name: 'Linear fit',
        showSymbol: false,
        silent: true,
        smooth: false,
        type: 'line',
      }]),
    ],
    xAxis: valueAxis(titles.x),
    yAxis: valueAxis(titles.y),
  } as EChartsCoreOption
}

export function buildCorrelationOption(result: CorrelationAnalysisResult): EChartsCoreOption {
  const coefficientLabel = result.method === 'pearson' ? 'Pearson r' : 'Spearman ρ'
  return {
    ...cartesianBase(false),
    grid: { bottom: 28, containLabel: true, left: 22, right: 64, top: 30 },
    series: [{
      data: result.cells.map((cell) => datum(
        [cell.column, cell.row, cell.value],
        cell.sourceObservationIds,
        { matchedCount: cell.count },
      )),
      emphasis: { itemStyle: { borderColor: geoEyeChartColors.text, borderWidth: 2 } },
      itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 2 },
      label: {
        formatter: (params: { data?: GeoEyeChartDatum }) => {
          const value = Array.isArray(params.data?.value) ? params.data.value[2] : null
          const formatted = typeof value === 'number' ? value.toFixed(2) : '—'
          return `${formatted}\nn=${params.data?.matchedCount ?? 0}`
        },
        fontSize: 10,
        lineHeight: 14,
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
        return `${result.labels[row] ?? ''} × ${result.labels[column] ?? ''}<br/>${coefficientLabel}: ${typeof value === 'number' ? value.toFixed(3) : '—'}<br/>Matched n: ${params.data?.matchedCount ?? 0}`
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

export function buildQqOption(result: QqAnalysisResult, titles: AxisTitles): EChartsCoreOption {
  const xValues = result.points.map((point) => point.x)
  const minimumX = xValues.length === 0 ? 0 : Math.min(...xValues)
  const maximumX = xValues.length === 0 ? 1 : Math.max(...xValues)
  const fit = result.regression === null ? [] : [minimumX, maximumX].map((x) => datum(
    [x, result.regression!.intercept + result.regression!.slope * x],
    result.sourceObservationIds,
  ))

  return {
    ...cartesianBase(),
    series: [
      {
        data: result.points.map((point) => datum([point.x, point.y], point.sourceObservationIds, { name: `${(point.probability * 100).toFixed(1)}th percentile` })),
        emphasis: { focus: 'series', scale: 1.35 },
        itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 1, color: geoEyeChartColors.violet, opacity: 0.78 },
        name: 'Empirical quantiles',
        symbolSize: 7,
        type: 'scatter',
      },
      ...(fit.length === 0 ? [] : [{
        data: fit,
        lineStyle: { color: geoEyeChartColors.accent, type: 'dashed', width: 1.5 },
        name: 'Quantile fit',
        showSymbol: false,
        silent: true,
        smooth: false,
        type: 'line',
      }]),
    ],
    xAxis: valueAxis(titles.x),
    yAxis: valueAxis(titles.y),
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
    yAxis: valueAxis('Depth (m)', true),
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
