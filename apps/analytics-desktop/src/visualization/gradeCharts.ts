import type { EChartsCoreOption } from 'echarts/core'
import type { DeclusterResult, TopCutResult } from '../analysis/engineClient.js'
import { geoEyeChartColors as c } from './geoEyeTheme.js'

const axis = (name: string, extra: Record<string, unknown> = {}) => ({ name, nameLocation: 'middle', nameGap: 28, axisLine: { lineStyle: { color: c.gridStrong } }, splitLine: { lineStyle: { color: c.grid } }, ...extra })

export function buildDeclusterCurveOption(result: DeclusterResult, unit: string): EChartsCoreOption {
  return {
    grid: { left: 56, right: 24, top: 28, bottom: 48 },
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => `${Number(v).toFixed(3)} ${unit}` },
    xAxis: axis('Cell size (m)', { type: 'value' }),
    yAxis: axis(`Declustered mean (${unit})`, { type: 'value', scale: true, nameGap: 42 }),
    series: [
      { type: 'line', name: 'Declustered mean', data: result.curve.map((p) => [p.cellSize, p.mean]), symbol: 'circle', symbolSize: 7, lineStyle: { color: c.blue }, itemStyle: { color: c.blue },
        markLine: { silent: true, symbol: 'none', label: { formatter: 'Naive mean {c}', position: 'insideEndTop' }, lineStyle: { color: c.danger, type: 'dashed' }, data: [{ yAxis: Number(result.naiveMean.toFixed(3)) }] },
        markPoint: { symbol: 'pin', symbolSize: 42, itemStyle: { color: c.accent }, label: { formatter: () => 'chosen', fontSize: 10 }, data: [{ coord: [result.chosen.cellSize, result.chosen.mean] }] } },
    ],
  }
}

export function buildLogProbabilityOption(result: TopCutResult, cutOff: number | null, unit: string): EChartsCoreOption {
  const ticks = [0.5, 2, 10, 25, 50, 75, 90, 98, 99.5, 99.9]
  const zOf = (p: number) => Math.SQRT2 * inverseErf(2 * p / 100 - 1)
  return {
    grid: { left: 60, right: 24, top: 28, bottom: 48 },
    tooltip: { trigger: 'item', formatter: (p: { data: number[] }) => `${p.data[0]?.toPrecision(4)} ${unit} · ${(Number(result.logProbability.find((q) => q.z === p.data[1])?.probability ?? 0) * 100).toFixed(2)} %` },
    xAxis: axis(unit === '' ? 'Value (log)' : `${unit} (log)`, { type: 'log', logBase: 10, minorSplitLine: { show: true, lineStyle: { color: c.grid } } }),
    yAxis: axis('Cumulative probability (%)', { type: 'value', min: zOf(0.2), max: zOf(99.95), nameGap: 44, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { customValues: ticks.map(zOf), formatter: (v: number) => `${ticks.find((k) => Math.abs(zOf(k) - v) < 1e-6) ?? ''}` } }),
    series: [
      { type: 'scatter', name: 'Samples', symbolSize: 4, itemStyle: { color: c.blue, opacity: 0.75 }, data: result.logProbability.map((p) => [p.value, p.z]) },
      { type: 'line', name: 'grid', data: [], markLine: { silent: true, symbol: 'none', lineStyle: { color: c.grid }, label: { show: false }, data: ticks.map((t) => ({ yAxis: zOf(t) })) } },
      ...(cutOff === null ? [] : [{ type: 'line', name: 'Top-cut', data: [], markLine: { silent: true, symbol: 'none', lineStyle: { color: c.danger, width: 2 }, label: { formatter: `cut ${cutOff.toPrecision(4)}`, position: 'insideEndTop' }, data: [{ xAxis: cutOff }] } }]),
      ...Object.entries(result.deciles).map(([d, v]) => ({ type: 'line', name: `D${d}`, data: [], markLine: { silent: true, symbol: 'none', lineStyle: { color: c.muted, type: 'dotted', opacity: 0.5 }, label: { show: false }, data: [{ xAxis: v }] } })),
    ],
  }
}

export function buildMeanCvCurveOption(result: TopCutResult, cutOff: number | null, unit: string): EChartsCoreOption {
  return {
    grid: { left: 56, right: 56, top: 28, bottom: 48 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, right: 60, textStyle: { color: c.muted } },
    xAxis: axis(unit === '' ? 'Cut-off (log)' : `Cut-off (${unit}, log)`, { type: 'log', logBase: 10 }),
    yAxis: [axis(`Capped mean (${unit})`, { type: 'value', scale: true, nameGap: 42 }), axis('CV', { type: 'value', scale: true, nameGap: 36, splitLine: { show: false } })],
    series: [
      { type: 'line', name: 'Mean', yAxisIndex: 0, showSymbol: false, lineStyle: { color: c.blue }, itemStyle: { color: c.blue }, data: result.curve.map((p) => [p.cutOff, p.mean]),
        ...(cutOff === null ? {} : { markLine: { silent: true, symbol: 'none', lineStyle: { color: c.danger, width: 2 }, label: { show: false }, data: [{ xAxis: cutOff }] } }) },
      { type: 'line', name: 'CV', yAxisIndex: 1, showSymbol: false, lineStyle: { color: c.accent }, itemStyle: { color: c.accent }, data: result.curve.map((p) => [p.cutOff, p.cv]) },
    ],
  }
}

// Giles (2012) rational approximation — enough precision for axis placement.
function inverseErf(x: number) {
  const w = -Math.log((1 - x) * (1 + x))
  let p: number
  if (w < 5) {
    const t = w - 2.5
    p = 2.81022636e-08; p = 3.43273939e-07 + p * t; p = -3.5233877e-06 + p * t; p = -4.39150654e-06 + p * t; p = 0.00021858087 + p * t
    p = -0.00125372503 + p * t; p = -0.00417768164 + p * t; p = 0.246640727 + p * t; p = 1.50140941 + p * t
  } else {
    const t = Math.sqrt(w) - 3
    p = -0.000200214257; p = 0.000100950558 + p * t; p = 0.00134934322 + p * t; p = -0.00367342844 + p * t; p = 0.00573950773 + p * t
    p = -0.0076224613 + p * t; p = 0.00943887047 + p * t; p = 1.00167406 + p * t; p = 2.83297682 + p * t
  }
  return p * x
}
