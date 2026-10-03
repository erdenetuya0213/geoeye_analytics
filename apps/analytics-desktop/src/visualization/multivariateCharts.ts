import type { EChartsCoreOption } from 'echarts/core'
import type { MultivariateCorrelationMethod, MultivariateRunResult } from '../analysis/multivariateEngine.js'
import type { EdaVariableDefinition } from '../data/edaDemo.js'
import { GEOEYE_LINE_SMOOTHING, geoEyeChartColors } from './geoEyeTheme.js'

const clusterColors = [geoEyeChartColors.primary, geoEyeChartColors.accent, geoEyeChartColors.violet, '#5488a5', '#70a58e', '#b06f7b', '#9d874d', '#537067']

function uniqueSourceObservationIds(rows: readonly MultivariateRunResult['rows'][number][]) {
  return [...new Set(rows.flatMap((row) => row.sourceObservationIds))]
}

function cartesian(selectable = true) {
  return {
    aria: { enabled: true },
    brush: selectable ? { brushMode: 'single', xAxisIndex: 'all', yAxisIndex: 'all' } : undefined,
    grid: { bottom: 30, containLabel: true, left: 24, right: 22, top: 56 },
    legend: { left: 14, top: 12, type: 'scroll' },
    tooltip: { axisPointer: { lineStyle: { color: geoEyeChartColors.gridStrong }, type: 'line' }, confine: true, trigger: 'item' },
  }
}

function valueAxis(name: string) {
  return {
    axisLabel: { hideOverlap: true },
    axisLine: { show: true },
    axisTick: { show: false },
    name,
    nameGap: 42,
    nameLocation: 'middle' as const,
    scale: true,
    splitLine: { lineStyle: { color: geoEyeChartColors.grid } },
    splitNumber: 5,
    type: 'value' as const,
  }
}

export function buildMultivariateCorrelationOption(
  result: MultivariateRunResult,
  variables: readonly EdaVariableDefinition[],
  method: MultivariateCorrelationMethod,
): EChartsCoreOption {
  const labels = variables.map((variable) => variable.shortLabel)
  const matrix = result.correlation[method]
  const data = labels.flatMap((_, row) => labels.map((__, column) => {
    const leftKey = variables[column]?.key ?? ''
    const rightKey = variables[row]?.key ?? ''
    const sourceObservationIds = uniqueSourceObservationIds(result.rows.filter((item) => {
      const left = item.values[leftKey]
      const right = item.values[rightKey]
      return typeof left === 'number' && Number.isFinite(left) && typeof right === 'number' && Number.isFinite(right)
    }))
    return {
      count: result.correlation.counts[row]?.[column] ?? 0,
      sourceObservationIds,
      value: [column, row, matrix[row]?.[column] ?? 0],
    }
  }))
  return {
    aria: { enabled: true },
    grid: { bottom: 28, containLabel: true, left: 22, right: 64, top: 28 },
    series: [{ data, label: { formatter: (params: { data?: { value?: number[] } }) => {
      const value = params.data?.value?.[2]
      return typeof value === 'number' ? value.toFixed(2) : '—'
    }, fontSize: 12, fontWeight: 700, show: true }, itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 2 }, type: 'heatmap' }],
    tooltip: { formatter: (params: { data?: { count?: number; value?: number[] } }) => {
      const column = params.data?.value?.[0] ?? 0
      const row = params.data?.value?.[1] ?? 0
      const value = params.data?.value?.[2]
      return `${labels[row] ?? ''} × ${labels[column] ?? ''}<br/>${method === 'pearson' ? 'Pearson r' : 'Spearman ρ'}: ${typeof value === 'number' ? value.toFixed(3) : '—'}<br/>Pair n: ${params.data?.count ?? 0}`
    } },
    visualMap: { calculable: false, inRange: { color: ['#bd6c75', '#f3f5f4', '#17766f'] }, max: 1, min: -1, orient: 'vertical', right: 10, top: 'center' },
    xAxis: { data: labels, splitArea: { show: true }, type: 'category' },
    yAxis: { data: labels, splitArea: { show: true }, type: 'category' },
  } as EChartsCoreOption
}

export function buildExplainedVarianceOption(result: MultivariateRunResult): EChartsCoreOption {
  const labels = result.pca.explainedVarianceRatio.map((_, index) => `PC${index + 1}`)
  const sourceObservationIds = uniqueSourceObservationIds(result.rows)
  return {
    ...cartesian(false),
    grid: { bottom: 28, containLabel: true, left: 24, right: 54, top: 50 },
    series: [
      { data: result.pca.explainedVarianceRatio.map((value) => ({ sourceObservationIds, value: value * 100 })), emphasis: { focus: 'series' }, itemStyle: { borderRadius: [4, 4, 0, 0], color: geoEyeChartColors.primary, opacity: 0.88 }, name: 'Explained', type: 'bar' },
      { data: result.pca.cumulativeVarianceRatio.map((value) => ({ sourceObservationIds, value: value * 100 })), lineStyle: { color: geoEyeChartColors.accent }, name: 'Cumulative', smooth: GEOEYE_LINE_SMOOTHING, smoothMonotone: 'y', symbolSize: 6, type: 'line', yAxisIndex: 1 },
    ],
    tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${value.toFixed(1)}%` },
    xAxis: { data: labels, type: 'category' },
    yAxis: [{ ...valueAxis('Explained variance (%)'), max: 100, min: 0 }, { axisLabel: { formatter: '{value}%' }, max: 100, min: 0, type: 'value' }],
  } as EChartsCoreOption
}

export interface PcaScoresOptionSettings {
  biplot?: boolean
  colorBy?: string
  variables?: readonly EdaVariableDefinition[]
  xComponent?: number
  yComponent?: number
}

function colorGroup(row: MultivariateRunResult['rows'][number], colorBy: string) {
  if (colorBy === 'cluster') return `Cluster ${row.cluster}`
  return row.dimensions?.[colorBy] ?? (colorBy === 'drillhole' ? row.holeId : 'Unassigned')
}

export function buildPcaScoresOption(result: MultivariateRunResult, settings: PcaScoresOptionSettings = {}): EChartsCoreOption {
  const xComponent = Math.max(0, Math.min(settings.xComponent ?? 0, result.pca.componentCount - 1))
  const yComponent = Math.max(0, Math.min(settings.yComponent ?? 1, result.pca.componentCount - 1))
  const colorBy = settings.colorBy ?? result.configuration.groupBy ?? 'cluster'
  const groups = Array.from(new Set(result.rows.map((row) => colorGroup(row, colorBy)))).sort()
  const xVariance = (result.pca.explainedVarianceRatio[xComponent] ?? 0) * 100
  const yVariance = (result.pca.explainedVarianceRatio[yComponent] ?? 0) * 100
  const scoreExtent = Math.max(1, ...result.rows.flatMap((row) => [Math.abs(row.scores[xComponent] ?? 0), Math.abs(row.scores[yComponent] ?? 0)]))
  const vectorScale = scoreExtent * 0.72
  const scoreSeries = groups.map((group) => ({
    data: result.rows.filter((row) => colorGroup(row, colorBy) === group).map((row) => ({
      clusterDistance: row.clusterDistance,
      membershipStrength: row.membershipStrength,
      name: row.observationId,
      sourceObservationIds: row.sourceObservationIds,
      value: [row.scores[xComponent] ?? 0, row.scores[yComponent] ?? 0, row.cluster],
    })),
    emphasis: { focus: 'series', scale: 1.35 },
    itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 1, opacity: 0.76 }, name: group, symbolSize: 7, type: 'scatter',
  }))
  const vectorSeries = settings.biplot ? (settings.variables ?? []).map((variable, variableIndex) => {
    const x = (result.pca.loadings[variableIndex]?.[xComponent] ?? 0) * vectorScale
    const y = (result.pca.loadings[variableIndex]?.[yComponent] ?? 0) * vectorScale
    return {
      data: [{ sourceObservationIds: [], value: [x, y] }],
      itemStyle: { color: geoEyeChartColors.accent },
      label: { color: geoEyeChartColors.accent, formatter: variable.shortLabel, position: 'top', show: true },
      markLine: {
        animation: false,
        data: [[{ coord: [0, 0], symbol: 'none' }, { coord: [x, y], symbol: 'arrow' }]],
        label: { show: false },
        lineStyle: { color: geoEyeChartColors.accent, opacity: 0.82, width: 1.5 },
        symbol: ['none', 'arrow'],
      },
      name: variable.shortLabel,
      silent: true,
      symbol: 'circle',
      symbolSize: 4,
      type: 'scatter',
    }
  }) : []
  return {
    ...cartesian(),
    series: [...scoreSeries, ...vectorSeries],
    tooltip: {
      confine: true,
      formatter: (params: { data?: { clusterDistance?: number; membershipStrength?: number; name?: string; value?: number[] }; seriesName?: string }) => {
        const datum = params.data
        if (datum?.name === undefined) return params.seriesName ?? ''
        return `${datum.name}<br/>PC${xComponent + 1}: ${(datum.value?.[0] ?? 0).toFixed(3)}<br/>PC${yComponent + 1}: ${(datum.value?.[1] ?? 0).toFixed(3)}<br/>Cluster ${datum.value?.[2] ?? '—'} · strength ${((datum.membershipStrength ?? 0) * 100).toFixed(0)}%`
      },
      trigger: 'item',
    },
    xAxis: valueAxis(`PC${xComponent + 1} (${xVariance.toFixed(1)}%)`),
    yAxis: valueAxis(`PC${yComponent + 1} (${yVariance.toFixed(1)}%)`),
  } as EChartsCoreOption
}

export function buildLoadingsOption(result: MultivariateRunResult, variables: readonly EdaVariableDefinition[], components: readonly number[] = [0, 1]): EChartsCoreOption {
  const sourceObservationIds = uniqueSourceObservationIds(result.rows)
  return {
    ...cartesian(false),
    grid: { bottom: 30, containLabel: true, left: 24, right: 22, top: 56 },
    series: components.map((component) => ({
      data: variables.map((_, variable) => ({
        sourceObservationIds,
        value: result.pca.loadings[variable]?.[component] ?? 0,
      })),
      emphasis: { focus: 'series' },
      itemStyle: { borderRadius: [4, 4, 0, 0] },
      name: `PC${component + 1}`,
      type: 'bar',
    })),
    tooltip: { trigger: 'axis' },
    xAxis: { axisLabel: { interval: 0, rotate: variables.length > 5 ? 30 : 0 }, data: variables.map((variable) => variable.shortLabel), type: 'category' },
    yAxis: { ...valueAxis('Component loading'), max: 1, min: -1 },
  } as EChartsCoreOption
}

export function buildClusterScoresOption(result: MultivariateRunResult): EChartsCoreOption {
  const pc1 = (result.pca.explainedVarianceRatio[0] ?? 0) * 100
  const pc2 = (result.pca.explainedVarianceRatio[1] ?? 0) * 100
  return {
    ...cartesian(),
    series: Array.from({ length: result.clustering.clusterCount }, (_, index) => ({
      data: result.rows.filter((row) => row.cluster === index + 1).map((row) => ({
        clusterDistance: row.clusterDistance,
        membershipStrength: row.membershipStrength,
        name: row.observationId,
        sourceObservationIds: row.sourceObservationIds,
        value: [row.scores[0] ?? 0, row.scores[1] ?? 0],
      })),
      emphasis: { focus: 'series', scale: 1.35 },
      itemStyle: { borderColor: geoEyeChartColors.surface, borderWidth: 1, color: clusterColors[index % clusterColors.length], opacity: 0.78 },
      name: `Cluster ${index + 1}`,
      symbolSize: 8,
      type: 'scatter',
    })),
    tooltip: {
      confine: true,
      formatter: (params: { data?: { clusterDistance?: number; membershipStrength?: number; name?: string }; seriesName?: string }) => `${params.data?.name ?? params.seriesName ?? ''}<br/>${params.seriesName ?? ''}<br/>Distance: ${(params.data?.clusterDistance ?? 0).toFixed(3)}<br/>Membership strength: ${((params.data?.membershipStrength ?? 0) * 100).toFixed(0)}%`,
      trigger: 'item',
    },
    xAxis: valueAxis(`PC1 (${pc1.toFixed(1)}%)`),
    yAxis: valueAxis(`PC2 (${pc2.toFixed(1)}%)`),
  } as EChartsCoreOption
}

export function buildClusterProfilesOption(result: MultivariateRunResult, variables: readonly EdaVariableDefinition[]): EChartsCoreOption {
  return {
    ...cartesian(false),
    grid: { bottom: 30, containLabel: true, left: 24, right: 22, top: 56 },
    series: result.clustering.centroids.map((centroid, index) => ({
      data: centroid.map((value) => ({
        sourceObservationIds: uniqueSourceObservationIds(result.rows.filter((row) => row.cluster === index + 1)),
        value,
      })),
      itemStyle: { color: clusterColors[index % clusterColors.length] },
      lineStyle: { color: clusterColors[index % clusterColors.length] },
      name: `Cluster ${index + 1}`,
      smooth: GEOEYE_LINE_SMOOTHING,
      symbolSize: 7,
      type: 'line',
    })),
    tooltip: { trigger: 'axis' },
    xAxis: { data: variables.map((variable) => variable.shortLabel), type: 'category' },
    yAxis: valueAxis(result.configuration.scaling === 'none' ? 'Centroid value' : 'Scaled centroid'),
  } as EChartsCoreOption
}

export function buildGroupComparisonOption(result: MultivariateRunResult, groupBy = result.configuration.groupBy): EChartsCoreOption {
  const groupNames = Array.from(new Set(result.rows.map((row) => {
    if (groupBy === null) return 'All observations'
    return row.dimensions?.[groupBy] ?? (groupBy === 'drillhole' ? row.holeId : 'Unassigned')
  }))).sort()
  const groups = groupNames.map((group) => {
    const rows = result.rows.filter((row) => {
      if (groupBy === null) return true
      return (row.dimensions?.[groupBy] ?? (groupBy === 'drillhole' ? row.holeId : 'Unassigned')) === group
    })
    return { group, rows }
  })
  return {
    ...cartesian(false),
    grid: { bottom: 30, containLabel: true, left: 24, right: 22, top: 56 },
    series: Array.from({ length: result.clustering.clusterCount }, (_, index) => ({
      data: groups.map(({ rows: groupRows }) => {
        const clusterRows = groupRows.filter((row) => row.cluster === index + 1)
        return {
          sourceObservationIds: uniqueSourceObservationIds(clusterRows.length === 0 ? groupRows : clusterRows),
          value: groupRows.length === 0 ? 0 : clusterRows.length / groupRows.length * 100,
        }
      }),
      emphasis: { focus: 'series' },
      itemStyle: { color: clusterColors[index % clusterColors.length] },
      name: `Cluster ${index + 1}`,
      stack: 'clusters',
      type: 'bar',
    })),
    tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${value.toFixed(1)}%` },
    xAxis: { axisLabel: { interval: 0, rotate: groups.length > 5 ? 28 : 0 }, data: groups.map(({ group }) => group), type: 'category' },
    yAxis: { ...valueAxis('Population share (%)'), axisLabel: { formatter: '{value}%' }, max: 100, min: 0 },
  } as EChartsCoreOption
}
