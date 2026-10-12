import type { EChartsCoreOption } from 'echarts/core'
import type { ExperimentalVariogram, FanResult, VariogramModel } from '../analysis/engineClient.js'
import { modelCurve } from '../analysis/variogramModel.js'
import { geoEyeChartColors as c } from './geoEyeTheme.js'

function niceCeil(v: number) { if (!(v > 0)) return 1; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p }

export const directionColors = [c.muted, c.accent, '#4f9a7a', c.blue]

export function buildVariogramOption(exp: ExperimentalVariogram | null, model: VariogramModel | null, directionIndex: number, sill: number, color: string, maxLag: number): EChartsCoreOption {
  const lags = exp?.lags ?? []
  const hMax = Math.max(maxLag, ...lags.map((l) => l.distance)) * 1.05
  const yMax = niceCeil(Math.max(sill * 1.5, ...lags.map((l) => l.gamma)) * 1.05)
  return {
    grid: { left: 52, right: 52, top: 24, bottom: 44 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, formatter: (ps: Array<{ seriesName: string; data: number[] }>) => ps.map((p) => `${p.seriesName}: ${p.data[1]?.toFixed(3)} @ ${p.data[0]?.toFixed(1)} m${p.data[2] !== undefined ? ` · ${p.data[2]} pairs` : ''}`).join('<br/>') },
    xAxis: { type: 'value', name: 'Separation (m)', nameLocation: 'middle', nameGap: 26, min: 0, max: niceCeil(hMax), axisLine: { lineStyle: { color: c.gridStrong } }, splitLine: { lineStyle: { color: c.grid } } },
    yAxis: [
      { type: 'value', name: 'γ(h)', nameLocation: 'middle', nameGap: 34, min: 0, max: yMax, axisLine: { lineStyle: { color: c.gridStrong } }, splitLine: { lineStyle: { color: c.grid } } },
      { type: 'value', name: 'pairs', nameLocation: 'middle', nameGap: 36, min: 0, max: Math.max(1, ...lags.map((l) => l.pairs)) * 3, splitLine: { show: false }, axisLabel: { color: c.muted } },
    ],
    series: [
      { type: 'bar', name: 'pairs', yAxisIndex: 1, barMaxWidth: 10, itemStyle: { color: color, opacity: 0.18 }, data: lags.map((l) => [l.distance, l.pairs]), silent: true },
      { type: 'line', name: 'sill', data: [[0, sill], [hMax, sill]], showSymbol: false, silent: true, lineStyle: { color: c.muted, type: 'dashed', width: 1 } },
      { type: 'line', name: 'experimental', data: lags.map((l) => [l.distance, l.gamma, l.pairs]), symbol: 'circle', symbolSize: 7, lineStyle: { color, width: 1, opacity: 0.6 }, itemStyle: { color } },
      ...(model === null ? [] : [{ type: 'line', name: 'model', data: modelCurve(model, hMax, directionIndex), showSymbol: false, smooth: false, lineStyle: { color, width: 2.5 } }]),
    ],
  }
}

/** Continuity fan: for each ray, the separation at which γ first reaches `fraction` × sill. */
export function buildFanOption(fan: FanResult | null, sill: number, fraction = 0.7): EChartsCoreOption {
  const rays = fan?.rays ?? []
  const reach = (lags: FanResult['rays'][number]['lags']) => { const hit = lags.find((l) => l.gamma >= sill * fraction); return hit ? hit.distance : (lags.at(-1)?.distance ?? 0) }
  const data = rays.flatMap((r) => [[reach(r.lags), r.angle], [reach(r.lags), (r.angle + 180) % 360]]).sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0))
  return {
    polar: { radius: '78%' },
    angleAxis: { type: 'value', min: 0, max: 360, startAngle: 90, clockwise: true, interval: 30, axisLabel: { formatter: (v: number) => `${v}°`, color: c.muted }, splitLine: { lineStyle: { color: c.grid } } },
    radiusAxis: { type: 'value', name: `range to ${Math.round(fraction * 100)}% sill (m)`, nameGap: 4, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.grid } } },
    tooltip: { trigger: 'item', formatter: (p: { data: number[] }) => `${p.data[1]}°: ${p.data[0]?.toFixed(1)} m` },
    series: [{ type: 'line', coordinateSystem: 'polar', data: [...data, data[0] ?? [0, 0]], symbol: 'circle', symbolSize: 5, lineStyle: { color: c.accent, width: 2 }, itemStyle: { color: c.accent }, areaStyle: { color: c.accent, opacity: 0.12 } }],
  }
}
