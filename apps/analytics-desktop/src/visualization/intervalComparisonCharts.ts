import type { EChartsCoreOption } from 'echarts/core'
import type { EdaObservation } from '../analysis/eda.js'
import { comparisonCorrelation, comparisonGroupMeans, depthStepPoints } from '../analysis/intervalComparison.js'

export type ComparisonView = 'downhole' | 'groups' | 'correlation'
export interface ComparisonCurve { key: string; label: string }
export interface ComparisonFigure {
  rows: readonly EdaObservation[]; curves: readonly ComparisonCurve[]; view: ComparisonView
  reference: string; note: string; unit: string; percent: boolean; dimension: string; xKey: string; xLabel: string
}
const colors = ['#0072B2', '#D55E00', '#009E73']
const wrap = (text: string, width: number) => text.split(/\s+/).reduce<string[]>((lines, word) => {
  const last = lines.length - 1
  if (last < 0 || lines[last]!.length + word.length + 1 > width) lines.push(word)
  else lines[last] += ` ${word}`
  return lines
}, []).join('\n')

/** All panels use the same supplied common-support cohort. No resampling here. */
export function intervalComparisonOption(input: ComparisonFigure): EChartsCoreOption {
  const { rows, curves, view, percent, unit } = input
  const length = rows.reduce((s, r) => s + r.depthTo - r.depthFrom, 0)
  const heading = view === 'downhole' ? 'Downhole comparison' : view === 'groups' ? 'Mechanical-state comparison' : 'RQD and fracture frequency'
  const numeric = { type: 'value', axisLabel: { color: '#333', fontSize: 12 }, nameTextStyle: { color: '#222', fontSize: 14 }, axisLine: { show: true, lineStyle: { color: '#555' } }, splitLine: { lineStyle: { color: '#e3e7eb' } } }
  const valueAxis = { ...numeric, ...(percent ? { min: 0, max: 100 } : {}), name: unit ? `Value (${unit})` : 'Value', nameLocation: 'middle', nameGap: 32 }
  const titles: Record<string, unknown>[] = [{ text: `${heading} · ${input.reference}`, subtext: `${rows.length} matched intervals · ${length.toFixed(2)} m common support`, left: 28, top: 16, textStyle: { fontSize: 23, color: '#172a3a' }, subtextStyle: { fontSize: 14, color: '#475569' } }]
  const footer = view === 'downhole' ? 'Step profiles; gaps are unobserved support, not zero.' : view === 'groups' ? 'Interval-length-weighted means; all curves use the same intervals. n denotes interval count.' : 'Length-weighted Pearson r; descriptive association, not independent validation. No significance test.'
  titles.push({ text: wrap(footer, 112), subtext: wrap(input.note, 112), left: 28, bottom: 15, textStyle: { fontSize: 13, fontWeight: 'normal', color: '#475569' }, subtextStyle: { fontSize: 13, color: '#475569', lineHeight: 19 } })
  const base = { animation: false, backgroundColor: '#fff', textStyle: { fontFamily: 'Arial', color: '#222' }, color: colors, title: titles, tooltip: { trigger: 'item', confine: true }, aria: { enabled: true } }
  if (view === 'groups') {
    const groups = comparisonGroupMeans(rows, curves.map(c => c.key), input.dimension)
    return { ...base, legend: { top: 90, textStyle: { color: '#222', fontSize: 13 }, selectedMode: false },
      grid: { top: 160, bottom: 190, left: 90, right: 35 },
      xAxis: { type: 'category', data: groups.map(g => `${g.label}\n${g.length.toFixed(2)} m · n=${g.count}`), axisLabel: { interval: 0, fontSize: 13, color: '#333', lineHeight: 20 } },
      yAxis: { ...valueAxis, name: percent ? 'Mean RQD (%)' : `Mean${unit ? ` (${unit})` : ''}`, nameGap: 52 },
      series: curves.map((c, i) => ({ type: 'bar', name: c.label, data: groups.map(g => g.means[i]), barMaxWidth: 58, itemStyle: { color: colors[i] }, label: { show: true, position: 'top', fontSize: 14, color: '#222', formatter: (p: { value: number }) => Number(p.value).toFixed(1) } })),
    } as EChartsCoreOption
  }
  const grids: Record<string, unknown>[] = [], xs: Record<string, unknown>[] = [], ys: Record<string, unknown>[] = [], series: Record<string, unknown>[] = []
  const panel = 90 / Math.max(1, curves.length)
  curves.forEach((curve, i) => {
    const left = 6 + i * panel
    grids.push({ left: `${left}%`, width: `${panel - 5}%`, top: 165, bottom: 155 })
    const corr = comparisonCorrelation(rows, input.xKey, curve.key)
    titles.push({ text: wrap(curve.label, 32), subtext: view === 'correlation' ? `r = ${corr.r === null ? 'undefined' : corr.r.toFixed(3)} · n = ${rows.length}` : '', left: `${left}%`, top: 87, textStyle: { fontSize: 16, color: colors[i], lineHeight: 20 }, subtextStyle: { fontSize: 14, color: '#333' } })
    if (view === 'downhole') {
      xs.push({ ...valueAxis, gridIndex: i, position: 'top', name: percent ? 'RQD (%)' : valueAxis.name, nameGap: 25 })
      ys.push({ ...numeric, gridIndex: i, inverse: true, min: rows[0]?.depthFrom ?? 0, max: rows.at(-1)?.depthTo ?? 1, name: i === 0 ? 'Depth (m)' : '', nameLocation: 'middle', nameGap: 45 })
      series.push({ type: 'line', name: curve.label, xAxisIndex: i, yAxisIndex: i, data: depthStepPoints(rows, curve.key), showSymbol: false, connectNulls: false, smooth: false, lineStyle: { width: 2, color: colors[i] }, itemStyle: { color: colors[i] } })
    } else {
      xs.push({ ...numeric, gridIndex: i, name: wrap(input.xLabel, 30), nameLocation: 'middle', nameGap: 35, min: 'dataMin', max: 'dataMax' })
      ys.push({ ...valueAxis, gridIndex: i, name: percent ? 'RQD (%)' : valueAxis.name, nameGap: 38 })
      series.push({ type: 'scatter', name: curve.label, xAxisIndex: i, yAxisIndex: i, symbolSize: 8, data: rows.map(r => [r.values[input.xKey], r.values[curve.key]]), itemStyle: { color: colors[i], opacity: .7, borderColor: '#fff', borderWidth: .5 } })
    }
  })
  return { ...base, grid: grids, xAxis: xs, yAxis: ys, series } as EChartsCoreOption
}
