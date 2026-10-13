import { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import type { EChartsCoreOption } from 'echarts/core'
import { completeness, dataSupport, guessRecoveryKeys, intervalIssues, recoveryLogic } from '../analysis/geotechQaqc.js'
import { AnalysisScopePicker, useAnalysisScope } from '../components/AnalysisScope.js'
import { GeoEyeChart } from '../components/GeoEyeChart.js'
import { SaveExportBar, type ExportTable } from '../components/SaveExportBar.js'
import { csv } from '../data/resultExport.js'
import { usePersistentState } from '../state/persistentState.js'
import { geoEyeChartColors as c } from '../visualization/geoEyeTheme.js'
import { numericFields } from '../data/fieldOptions.js'

const pct = (n: number, d: number) => d === 0 ? 0 : Math.round((n / d) * 100)

function Card({ children, detail, title }: { children: React.ReactNode; detail: string; title: string }) {
  return <section className="eda-chart-card domain-chart-card vg-panel"><header><div><h3>{title}</h3><p>{detail}</p></div></header><div className="eda-plot">{children}</div></section>
}

/** Geotech QA/QC template: completeness, interval logic, recovery logic, data support. */
export function GeotechQaqcPage() {
  const scope = useAnalysisScope()
  const dataset = scope.dataset
  const guessed = useMemo(() => dataset === undefined ? {} : guessRecoveryKeys(dataset), [dataset])
  const [keys, setKeys] = usePersistentState<{ rqd?: string; scr?: string; tcr?: string }>('qaqc.keys', {})
  const [groupKey, setGroupKey] = usePersistentState('qaqc.groupKey', 'lithology')
  const effective = { rqd: keys.rqd ?? guessed.rqd, scr: keys.scr ?? guessed.scr, tcr: keys.tcr ?? guessed.tcr }
  const numeric = numericFields(dataset)
  const groups = [{ key: 'lithology', label: 'Lithology' }, ...(dataset?.dimensions.map((d) => ({ key: d.key, label: d.label })) ?? [])]

  const result = useMemo(() => dataset === undefined ? null : ({
    completeness: completeness(dataset),
    intervals: intervalIssues(dataset),
    recovery: recoveryLogic(dataset, effective),
    support: dataSupport(dataset, groupKey, numeric.slice(0, 6).map((v) => v.key)),
  }), [dataset, effective.rqd, effective.scr, effective.tcr, groupKey])

  if (dataset === undefined || result === null) return <div className="page"><section className="panel" style={{ padding: 16 }}>Choose a dataset.</section></div>

  const label = (key: string) => dataset.variables.find((v) => v.key === key)?.shortLabel ?? key
  const completenessOption: EChartsCoreOption = {
    grid: { left: 90, right: 60, top: 24, bottom: 70 },
    tooltip: { formatter: (p: { data: number[] }) => `${result.completeness.holes[p.data[1] ?? 0]} · ${label(result.completeness.variables[p.data[0] ?? 0] ?? '')} · ${p.data[2]} %` },
    xAxis: { type: 'category', data: result.completeness.variables.map(label), axisLabel: { rotate: 40, color: c.muted } },
    yAxis: { type: 'category', data: result.completeness.holes, axisLabel: { color: c.muted } },
    visualMap: { min: 0, max: 100, right: 0, top: 'middle', itemHeight: 90, inRange: { color: ['#b25f68', '#f1d26b', '#4f9a7a'] }, textStyle: { color: c.muted } },
    series: [{ type: 'heatmap', data: result.completeness.cells.map((x) => [result.completeness.variables.indexOf(x.variableKey), result.completeness.holes.indexOf(x.holeId), pct(x.populated, x.total)]), label: { show: result.completeness.holes.length <= 25, formatter: (p: { data: number[] }) => `${p.data[2]}` } }],
  }
  const rx = effective.rqd, tx = effective.tcr
  const recoveryOption: EChartsCoreOption = {
    grid: { left: 56, right: 24, top: 24, bottom: 44 },
    tooltip: { trigger: 'item', formatter: (p: { data: (number | string)[] }) => `${p.data[2]} ${p.data[3]}–${p.data[4]} m · TCR ${p.data[0]} · RQD ${p.data[1]}` },
    xAxis: { type: 'value', name: tx ? `${label(tx)} (%)` : 'TCR', nameLocation: 'middle', nameGap: 26, min: 0, max: 110 },
    yAxis: { type: 'value', name: rx ? `${label(rx)} (%)` : 'RQD', nameLocation: 'middle', nameGap: 36, min: 0, max: 110 },
    series: [
      { type: 'line', name: '1:1', data: [[0, 0], [100, 100]], showSymbol: false, silent: true, lineStyle: { color: c.muted, type: 'dotted' } },
      { type: 'scatter', name: 'OK', symbolSize: 5, itemStyle: { color: c.blue, opacity: 0.6 }, data: dataset.observations.filter((o) => rx && tx && !result.recovery.some((r) => r.observationId === o.id)).map((o) => [o.values[tx!], o.values[rx!], o.holeId, o.depthFrom, o.depthTo]) },
      { type: 'scatter', name: 'Breach', symbolSize: 8, itemStyle: { color: c.danger }, data: result.recovery.filter((r) => r.tcr !== null && r.rqd !== null).map((r) => [r.tcr, r.rqd, r.holeId, r.depthFrom, r.depthTo]) },
    ],
  }
  const supportOption: EChartsCoreOption = {
    grid: { left: 56, right: 56, top: 30, bottom: 60 },
    tooltip: { trigger: 'axis' }, legend: { top: 0, textStyle: { color: c.muted } },
    xAxis: { type: 'category', data: result.support.map((r) => r.group), axisLabel: { rotate: 30, color: c.muted } },
    yAxis: [{ type: 'value', name: 'metres', nameLocation: 'middle', nameGap: 40 }, { type: 'value', name: 'tests', nameLocation: 'middle', nameGap: 40, splitLine: { show: false } }],
    series: [{ type: 'bar', name: 'Metres', data: result.support.map((r) => Math.round(r.metres)), itemStyle: { color: c.blue } }, ...numeric.slice(0, 6).map((v) => ({ type: 'bar', name: v.shortLabel, yAxisIndex: 1, data: result.support.map((r) => r.tests[v.key] ?? 0) }))],
  }
  const tables: ExportTable[] = [
    { name: 'completeness', csv: () => csv(['hole', ...result.completeness.variables.map(label)], result.completeness.holes.map((h) => [h, ...result.completeness.variables.map((v) => { const x = result.completeness.cells.find((x) => x.holeId === h && x.variableKey === v); return x ? pct(x.populated, x.total) : 0 })])) },
    { name: 'interval-issues', csv: () => csv(['hole', 'kind', 'from', 'to', 'length_m'], result.intervals.map((i) => [i.holeId, i.kind, i.from, i.to, i.length])) },
    { name: 'recovery-breaches', csv: () => csv(['observation_id', 'hole', 'from', 'to', 'rqd', 'scr', 'tcr', 'rule'], result.recovery.map((r) => [r.observationId, r.holeId, r.depthFrom, r.depthTo, r.rqd, r.scr, r.tcr, r.rule])) },
    { name: 'data-support', csv: () => csv(['group', 'metres', 'intervals', ...numeric.slice(0, 6).map((v) => v.key)], result.support.map((r) => [r.group, r.metres, r.intervals, ...numeric.slice(0, 6).map((v) => r.tests[v.key] ?? 0)])) },
  ]
  const totalGap = result.intervals.filter((i) => i.kind === 'gap').reduce((s, i) => s + i.length, 0)

  return <div className="page domain-page domain-simple-page qaqc-page">
    <section className="analysis-toolbar eda-toolbar">
      <AnalysisScopePicker scope={scope} />
      {(['rqd', 'scr', 'tcr'] as const).map((k) => <label className="tool-select tool-select-field" key={k}><span>{k.toUpperCase()}</span><select onChange={(e) => setKeys({ ...keys, [k]: e.target.value || undefined })} value={effective[k] ?? ''}><option value="">—</option>{numeric.map((v) => <option key={v.key} value={v.key}>{v.shortLabel}</option>)}</select><ChevronDown size={14} /></label>)}
      <label className="tool-select tool-select-field"><span>Group</span><select onChange={(e) => setGroupKey(e.target.value)} value={groupKey}>{groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</select><ChevronDown size={14} /></label>
    </section>
    <section className="domain-review-kpis">
      <article><span>Holes</span><strong>{result.completeness.holes.length}</strong><small>{dataset.observations.length.toLocaleString()} intervals</small></article>
      <article><span>Interval issues</span><strong>{result.intervals.length}</strong><small>{result.intervals.filter((i) => i.kind === 'gap').length} gaps ({totalGap.toFixed(1)} m) · {result.intervals.filter((i) => i.kind === 'overlap').length} overlaps · {result.intervals.filter((i) => i.kind === 'inverted').length} inverted</small></article>
      <article><span>Recovery logic</span><strong>{result.recovery.length}</strong><small>RQD ≤ SCR ≤ TCR ≤ 100 breaches</small></article>
      <article><span>Completeness</span><strong>{pct(result.completeness.cells.reduce((s, x) => s + x.populated, 0), result.completeness.cells.reduce((s, x) => s + x.total, 0))} %</strong><small>cells populated, all variables</small></article>
    </section>
    <section className="vg-grid">
      <Card detail="% populated per hole × variable — blank campaigns show as red rows" title="Completeness"><GeoEyeChart ariaLabel="Completeness heatmap" exportFeature="custom" exportName="qaqc-completeness" option={completenessOption} /></Card>
      <Card detail="RQD vs TCR · points above 1:1 or outside 0–100 are breaches" title="Recovery logic"><GeoEyeChart ariaLabel="Recovery logic scatter" exportFeature="custom" exportName="qaqc-recovery" option={recoveryOption} /></Card>
      <Card detail="Metres logged and test counts per group — thin bars are not designable yet" title="Data support"><GeoEyeChart ariaLabel="Data support bars" exportFeature="custom" exportName="qaqc-support" option={supportOption} /></Card>
      <section className="eda-chart-card domain-chart-card vg-panel"><header><div><h3>Interval issues</h3><p>gaps not coded as core loss · overlaps · from ≥ to</p></div></header>
        <div className="domain-supporting-table"><div className="is-header"><span>Hole</span><span>Kind</span><span>From</span><span>To</span><span>Length</span></div>{result.intervals.slice(0, 200).map((i, k) => <div key={k}><strong>{i.holeId}</strong><span>{i.kind}</span><span>{i.from.toFixed(2)}</span><span>{i.to.toFixed(2)}</span><span>{i.length.toFixed(2)} m</span></div>)}{result.intervals.length === 0 ? <p className="domain-empty-hint">No interval issues.</p> : null}</div></section>
    </section>
    <SaveExportBar lineage={() => ({ scope: scope.summary, keys: effective, groupKey })} summary={`QA/QC · ${scope.summary}`} tables={tables} />
  </div>
}
