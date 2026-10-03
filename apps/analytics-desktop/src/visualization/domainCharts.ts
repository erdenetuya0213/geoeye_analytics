import type { EChartsCoreOption } from 'echarts/core'
import type { DomainAnalysisRunResult } from '../analysis/domainAnalysis.js'
import { buildCdf, summarizeValues, type EdaObservation } from '../analysis/eda.js'
import type { EdaDataset } from '../data/edaDemo.js'
import { geoEyeChartColors } from './geoEyeTheme.js'

export type DomainSpatialView = 'plan' | 'section' | 'long-section' | 'downhole'

function ids(observation: EdaObservation) {
  return observation.sourceObservationIds ?? [observation.sourceObservationId]
}

function axisValues(observation: EdaObservation, view: DomainSpatialView, holeIndex: ReadonlyMap<string, number>) {
  const depth = (observation.depthFrom + observation.depthTo) / 2
  if (view === 'plan') return [observation.easting, observation.northing]
  if (view === 'section') return [observation.easting, -depth]
  if (view === 'long-section') return [observation.northing, -depth]
  return [holeIndex.get(observation.holeId) ?? 0, -depth]
}

function multivariateValue(result: DomainAnalysisRunResult, observation: EdaObservation, key: string) {
  const evidence = result.candidateSource.multivariateEvidence
  if (evidence === undefined) return undefined
  const observationSourceIds = new Set(ids(observation))
  const row = evidence.rows.find((item) => item.observationId === observation.id || item.sourceObservationIds.some((id) => observationSourceIds.has(id)))
  if (row === undefined) return undefined
  if (key === 'multivariate.cluster_id') return row.clusterId
  const match = /^multivariate\.pc(\d+)$/.exec(key)
  return match === null ? undefined : row.pcaScores[Number(match[1]) - 1]
}

function colorValue(result: DomainAnalysisRunResult, observation: EdaObservation, colorKey: string) {
  if (colorKey === 'candidate') return result.candidateObservationIds.includes(observation.id) ? 'Candidate' : 'Background'
  const multivariate = multivariateValue(result, observation, colorKey)
  if (multivariate !== undefined) return multivariate
  const numeric = observation.values[colorKey]
  if (typeof numeric === 'number') return numeric
  if (colorKey === 'lithology') return observation.lithology
  return observation.dimensions[colorKey]
}

const categoricalColors = ['#24877b', '#7c6aa5', '#d48742', '#4d829b', '#8b9a60', '#b0606f', '#557168']

export function buildDomainSpatialOption(
  dataset: EdaDataset,
  result: DomainAnalysisRunResult,
  view: DomainSpatialView,
  colorKey: string,
): EChartsCoreOption {
  const holes = [...new Set(dataset.observations.map((observation) => observation.holeId))]
  const holeIndex = new Map(holes.map((hole, index) => [hole, index]))
  const entries = dataset.observations.map((observation) => ({
    color: colorValue(result, observation, colorKey),
    observation,
    value: axisValues(observation, view, holeIndex),
  }))
  const numeric = entries.every((entry) => entry.color === undefined || typeof entry.color === 'number')
  const axisNames = view === 'plan' ? ['Easting', 'Northing'] : view === 'section' ? ['Easting', 'RL / depth'] : view === 'long-section' ? ['Northing', 'RL / depth'] : ['Drillhole', 'Depth']
  const tooltip = {
    formatter: (params: unknown) => {
      const datum = (params as { data?: { meta?: EdaObservation; color?: unknown } }).data
      const row = datum?.meta
      return row === undefined ? '' : `<strong>${row.holeId}</strong><br/>${row.depthFrom.toFixed(1)}–${row.depthTo.toFixed(1)} m<br/>${colorKey}: ${String(datum?.color ?? '—')}`
    },
  }
  if (numeric) {
    const values = entries.flatMap((entry) => typeof entry.color === 'number' ? [entry.color] : [])
    return {
      animationDuration: 240,
      aria: { enabled: true },
      brush: { toolbox: ['rect'], xAxisIndex: 0, yAxisIndex: 0 },
      grid: { bottom: 48, left: 64, right: 24, top: 20 },
      tooltip,
      visualMap: values.length === 0 ? undefined : {
        bottom: 2, calculable: false, dimension: 2, inRange: { color: ['#446a79', '#59a391', '#d58b46'] },
        left: 'center', max: Math.max(...values), min: Math.min(...values), orient: 'horizontal', precision: 2,
      },
      xAxis: { name: axisNames[0], nameLocation: 'middle', nameGap: 31, scale: true, type: view === 'downhole' ? 'category' : 'value', data: view === 'downhole' ? holes : undefined },
      yAxis: { name: axisNames[1], nameLocation: 'middle', nameGap: 44, scale: true, type: 'value' },
      series: [{
        data: entries.flatMap((entry) => typeof entry.color !== 'number' ? [] : [{
          color: entry.color,
          meta: entry.observation,
          sourceObservationIds: ids(entry.observation),
          symbolSize: result.candidateObservationIds.includes(entry.observation.id) ? 8 : 5,
          value: [...entry.value, entry.color],
        }]),
        name: colorKey,
        type: 'scatter',
      }],
    }
  }
  const categories = [...new Set(entries.map((entry) => String(entry.color ?? 'Unassigned')))]
  return {
    animationDuration: 240,
    aria: { enabled: true },
    brush: { toolbox: ['rect'], xAxisIndex: 0, yAxisIndex: 0 },
    grid: { bottom: 45, left: 64, right: 24, top: 40 },
    legend: { top: 7, type: 'scroll' },
    tooltip,
    xAxis: { name: axisNames[0], nameLocation: 'middle', nameGap: 31, scale: true, type: view === 'downhole' ? 'category' : 'value', data: view === 'downhole' ? holes : undefined },
    yAxis: { name: axisNames[1], nameLocation: 'middle', nameGap: 44, scale: true, type: 'value' },
    series: categories.map((category, index) => ({
      data: entries.filter((entry) => String(entry.color ?? 'Unassigned') === category).map((entry) => ({
        color: entry.color,
        itemStyle: { color: colorKey === 'candidate' && category === 'Background' ? '#85928e' : categoricalColors[index % categoricalColors.length], opacity: category === 'Background' ? 0.45 : 0.9 },
        meta: entry.observation,
        sourceObservationIds: ids(entry.observation),
        symbolSize: category === 'Background' ? 5 : 8,
        value: entry.value,
      })),
      name: category,
      type: 'scatter',
    })),
  }
}

export function buildContactProfileOption(result: DomainAnalysisRunResult): EChartsCoreOption {
  return {
    aria: { enabled: true },
    grid: { bottom: 45, left: 58, right: 25, top: 42 },
    legend: { top: 8 },
    tooltip: { trigger: 'axis' },
    xAxis: { name: 'Distance to contact (m)', nameLocation: 'middle', nameGap: 30, type: 'value' },
    yAxis: { name: 'Relative to background (×)', nameLocation: 'middle', nameGap: 42, type: 'value' },
    series: result.contacts.map((contact) => ({
      data: contact.profile.flatMap((point) => point.mean === null ? [] : [{
        sourceObservationIds: point.sourceObservationIds,
        value: [point.distance, contact.backgroundMean === null || contact.backgroundMean === 0 ? point.mean : point.mean / contact.backgroundMean],
      }]),
      markLine: { data: [{ xAxis: 0 }], label: { formatter: 'contact' }, lineStyle: { color: geoEyeChartColors.accent, type: 'dashed' }, symbol: 'none' },
      name: contact.variableKey.replace(/^.*\./, '').toUpperCase(),
      smooth: 0.25,
      type: 'line',
    })),
  }
}

function populationSamples(dataset: EdaDataset, result: DomainAnalysisRunResult, variableKey: string) {
  const candidateIds = new Set(result.candidateObservationIds)
  const candidate = dataset.observations.flatMap((observation) => {
    const value = observation.values[variableKey]
    return candidateIds.has(observation.id) && typeof value === 'number' && Number.isFinite(value)
      ? [{ id: ids(observation).join('|'), sourceObservationIds: ids(observation), value }]
      : []
  })
  const background = dataset.observations.flatMap((observation) => {
    const value = observation.values[variableKey]
    return !candidateIds.has(observation.id) && typeof value === 'number' && Number.isFinite(value)
      ? [{ id: ids(observation).join('|'), sourceObservationIds: ids(observation), value }]
      : []
  })
  return { background, candidate }
}

export function buildPopulationHistogramOption(dataset: EdaDataset, result: DomainAnalysisRunResult, variableKey: string): EChartsCoreOption {
  const samples = populationSamples(dataset, result, variableKey)
  const allValues = [...samples.candidate, ...samples.background].map((sample) => sample.value)
  const minimum = Math.min(...allValues)
  const maximum = Math.max(...allValues)
  const binCount = Math.max(5, Math.min(18, Math.ceil(Math.sqrt(allValues.length))))
  const width = maximum === minimum ? 1 : (maximum - minimum) / binCount
  const bins = (items: typeof samples.candidate) => Array.from({ length: binCount }, (_, index) => {
    const from = minimum + index * width
    const to = index === binCount - 1 ? maximum + Number.EPSILON : from + width
    const members = items.filter((item) => item.value >= from && item.value < to)
    return { sourceObservationIds: members.flatMap((item) => item.sourceObservationIds), value: [from + width / 2, members.length] }
  })
  return {
    aria: { enabled: true },
    grid: { bottom: 43, left: 52, right: 20, top: 42 }, legend: { top: 8 }, tooltip: { trigger: 'axis' },
    xAxis: { name: variableKey.replace(/^.*\./, '').toUpperCase(), nameLocation: 'middle', nameGap: 28, type: 'value' },
    yAxis: { name: 'Count', type: 'value' },
    series: [
      { barGap: '-70%', data: bins(samples.background), itemStyle: { color: '#778783', opacity: 0.5 }, name: 'Background', type: 'bar' },
      { data: bins(samples.candidate), itemStyle: { color: geoEyeChartColors.primary, opacity: 0.82 }, name: 'Candidate', type: 'bar' },
    ],
  }
}

export function buildPopulationCdfOption(dataset: EdaDataset, result: DomainAnalysisRunResult, variableKey: string): EChartsCoreOption {
  const samples = populationSamples(dataset, result, variableKey)
  const points = (items: typeof samples.candidate) => buildCdf(items).map((point) => ({
    sourceObservationIds: point.id.split('|'), value: [point.value, point.probability * 100],
  }))
  return {
    aria: { enabled: true }, grid: { bottom: 43, left: 58, right: 20, top: 42 }, legend: { top: 8 }, tooltip: { trigger: 'axis' },
    xAxis: { name: variableKey.replace(/^.*\./, '').toUpperCase(), nameLocation: 'middle', nameGap: 28, type: 'value' },
    yAxis: { max: 100, min: 0, name: 'Cumulative %', type: 'value' },
    series: [
      { data: points(samples.background), name: 'Background', showSymbol: false, type: 'line' },
      { data: points(samples.candidate), name: 'Candidate', showSymbol: false, type: 'line' },
    ],
  }
}

export function buildPopulationBoxOption(dataset: EdaDataset, result: DomainAnalysisRunResult, variableKey: string): EChartsCoreOption {
  const samples = populationSamples(dataset, result, variableKey)
  const box = (items: typeof samples.candidate) => {
    const stats = summarizeValues(items.map((item) => item.value))
    return {
      sourceObservationIds: items.flatMap((item) => item.sourceObservationIds),
      value: [stats.minimum ?? 0, stats.q1 ?? 0, stats.median ?? 0, stats.q3 ?? 0, stats.maximum ?? 0],
    }
  }
  return {
    aria: { enabled: true }, grid: { bottom: 35, left: 58, right: 20, top: 25 }, tooltip: { trigger: 'item' },
    xAxis: { data: ['Candidate', 'Background'], type: 'category' }, yAxis: { name: variableKey.replace(/^.*\./, '').toUpperCase(), type: 'value' },
    series: [{ data: [box(samples.candidate), box(samples.background)], itemStyle: { borderColor: geoEyeChartColors.primary, color: '#b8d9d3' }, type: 'boxplot' }],
  }
}
