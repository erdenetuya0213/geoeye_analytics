import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Grid2x2, Play, RefreshCw } from 'lucide-react'
import { callEngine, engineAvailable, type DeclusterResult, type TopCutResult } from '../analysis/engineClient.js'
import { GeoEyeChart } from '../components/GeoEyeChart.js'
import { AnalysisScopePicker, useAnalysisScope } from '../components/AnalysisScope.js'
import { usePersistentState } from '../state/persistentState.js'
import { csv } from '../data/resultExport.js'
import { SaveExportBar, type ExportTable } from '../components/SaveExportBar.js'
import { buildDeclusterCurveOption, buildLogProbabilityOption, buildMeanCvCurveOption } from '../visualization/gradeCharts.js'
import { numericFields } from '../data/fieldOptions.js'

type Target = 'minimum' | 'maximum'
interface Prepared { values: number[]; coordinates: number[][]; extent: number; dropped: number; rows: Array<{ id: string; holeId: string; from: number; to: number }> }

const robustSpan = (xs: number[]) => { const a = [...xs].sort((l, r) => l - r); const q = (p: number) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))] ?? 0; return q(0.98) - q(0.02) }

const fmt = (v: number | null | undefined, d = 3) => v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d)

function ChartCard({ children, detail, title }: { children: React.ReactNode; detail: string; title: string }) {
  return <section className="eda-chart-card domain-chart-card"><header><div><h3>{title}</h3><p>{detail}</p></div></header><div className="eda-plot">{children}</div></section>
}

export function GradePage() {
  const scope = useAnalysisScope()
  const [variableKey, setVariableKey] = usePersistentState('grade.variableKey', '')
  const [target, setTarget] = usePersistentState<Target>('grade.target', 'minimum')
  const [cellRange, setCellRange] = usePersistentState<[number, number]>('grade.cellRange', [0, 0])
  const [verticalRatio, setVerticalRatio] = usePersistentState('grade.verticalRatio', 0.25)
  const [customCut, setCustomCut] = usePersistentState('grade.customCut', '')
  const [cutLabel, setCutLabel] = usePersistentState<string | null>('grade.cutLabel', null)
  const [storedRun, setStoredRun] = usePersistentState<{ signature: string; decluster: DeclusterResult | null; topcut: TopCutResult | null } | null>('grade.lastRun', null)
  const [pending, setPending] = useState<'decluster' | 'topcut' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dataset = scope.dataset
  const numeric = numericFields(dataset)
  const variable = numeric.find((v) => v.key === variableKey) ?? numeric[0]
  const unit = variable?.unit ?? ''
  const signature = `${scope.signature}|${variable?.key ?? ''}`
  const decluster = storedRun?.signature === signature ? storedRun.decluster : null
  const topcut = storedRun?.signature === signature ? storedRun.topcut : null
  const setDecluster = (next: DeclusterResult | null) => setStoredRun((current) => ({ signature, decluster: next, topcut: current?.signature === signature ? current.topcut : null }))
  const setTopcut = (next: TopCutResult | null) => setStoredRun((current) => ({ signature, decluster: current?.signature === signature ? current.decluster : null, topcut: next }))

  const prepared = useMemo((): Prepared | null => {
    if (dataset === undefined || variable === undefined) return null
    const values: number[] = []; const coordinates: number[][] = []; const rows: Prepared['rows'] = []; let dropped = 0
    for (const o of dataset.observations) {
      const v = o.values[variable.key]
      if (v === null || v === undefined || !Number.isFinite(v)) continue
      if (!Number.isFinite(o.easting) || !Number.isFinite(o.northing) || (o.easting === 0 && o.northing === 0) || o.locationValid === false) { dropped += 1; continue }
      values.push(v); coordinates.push([o.easting, o.northing, -(o.depthFrom + o.depthTo) / 2]); rows.push({ id: o.sourceObservationId, holeId: o.holeId, from: o.depthFrom, to: o.depthTo })
    }
    if (values.length < 10) return null
    const extent = Math.max(robustSpan(coordinates.map((p) => p[0] ?? 0)), robustSpan(coordinates.map((p) => p[1] ?? 0)))
    return { values, coordinates, extent, dropped, rows }
  }, [dataset, variable])

  // Auto cell-size range from data extent on first use of a dataset/variable.
  const autoRange = () => { if (prepared !== null) setCellRange([Math.max(1, Math.round(prepared.extent / 100)), Math.max(2, Math.round(prepared.extent / 4))]) }
  useEffect(() => { if (cellRange[0] === 0) autoRange() }, [prepared]) // eslint-disable-line react-hooks/exhaustive-deps

  const runDecluster = async () => {
    if (prepared === null) return
    setPending('decluster'); setError(null)
    try {
      const result = await callEngine('decluster.optimise', { values: prepared.values, coordinates: prepared.coordinates, minimum: cellRange[0], maximum: cellRange[1], count: 24, anisotropy: [1, 1, verticalRatio], target })
      setDecluster(result)
      setTopcut(await callEngine('topcut.analyse', { values: prepared.values, weights: result.weights, customCutoffs: customCut === '' ? [] : [Number(customCut)] }))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setPending(null) }
  }
  const runTopcut = async () => {
    if (prepared === null) return
    setPending('topcut'); setError(null)
    try { setTopcut(await callEngine('topcut.analyse', { values: prepared.values, ...(decluster ? { weights: decluster.weights } : {}), customCutoffs: customCut === '' ? [] : [Number(customCut)] })) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setPending(null) }
  }

  const chosen = topcut?.scenarios.find((s) => s.label === cutLabel) ?? null
  const runId = `grade-${signature.replace(/[^a-z0-9]+/gi, '-')}`
  const key = variable?.key ?? 'value'
  const compositesCsv = () => prepared === null ? '' : csv(['observation_id', 'hole_id', 'from', 'to', 'x', 'y', 'z', key, 'declus_weight', `${key}_capped`, 'capped'],
    prepared.rows.map((row, i) => { const v = prepared.values[i] ?? 0; const cut = chosen?.cutOff; return [row.id, row.holeId, row.from, row.to, prepared.coordinates[i]?.[0], prepared.coordinates[i]?.[1], prepared.coordinates[i]?.[2], v, decluster?.weights[i] ?? 1, cut === undefined ? v : Math.min(v, cut), cut !== undefined && v > cut ? 1 : 0] }))
  const tables: ExportTable[] = [
    { name: 'composites', csv: compositesCsv },
    { name: 'topcut-scenarios', csv: () => topcut === null ? '' : csv(['label', 'cut_off', 'capped_n', 'capped_pct', 'mean', 'mean_change_pct', 'cv', 'metal_removed_pct', 'selected'], topcut.scenarios.map((s) => [s.label, s.cutOff, s.cappedCount, s.cappedPercent, s.mean, s.meanChangePercent, s.cv, s.metalRemovedPercent, s.label === cutLabel ? 1 : 0])) },
    { name: 'decluster-curve', csv: () => decluster === null ? '' : csv(['cell_size_m', 'declustered_mean', 'cells'], decluster.curve.map((p) => [p.cellSize, p.mean, p.cellCount])) },
  ]

  return <div className="page domain-page domain-simple-page grade-page">
    <h1 className="sr-only">Grade preparation</h1>
    {!engineAvailable() ? <section className="panel" role="alert" style={{ padding: 16 }}>The analytics engine runs only in the desktop app. Open Settings → Engine to check its status.</section> : null}
    {error ? <p role="alert">{error}</p> : null}

    <section className="analysis-toolbar eda-toolbar grade-toolbar">
      <AnalysisScopePicker scope={scope} />
      <label className="tool-select tool-select-field"><span>Variable</span><select aria-label="Grade variable" onChange={(e) => setVariableKey(e.target.value)} value={variable?.key ?? ''}>{numeric.map((v) => <option key={v.key} value={v.key}>{v.shortLabel} · {v.unit}</option>)}</select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field tool-number-field"><span>Min cell (m)</span><input aria-label="Minimum cell size" inputMode="decimal" onChange={(e) => setCellRange([Number(e.target.value) || 1, cellRange[1]])} value={cellRange[0]} /></label>
      <label className="tool-select tool-select-field tool-number-field"><span>Max cell (m)</span><input aria-label="Maximum cell size" inputMode="decimal" onChange={(e) => setCellRange([cellRange[0], Number(e.target.value) || 2])} value={cellRange[1]} /></label>
      <button className="button button-secondary" disabled={prepared === null} onClick={autoRange} title="Range from data extent (1/100 – 1/4)" type="button">Auto</button>
      <label className="tool-select tool-select-field tool-number-field" title="Vertical cell size as a fraction of horizontal"><span>Z ratio</span><input aria-label="Vertical ratio" inputMode="decimal" onChange={(e) => setVerticalRatio(Number(e.target.value) || 0.25)} value={verticalRatio} /></label>
      <label className="tool-select tool-select-field grade-pick-select"><span>Pick</span><select aria-label="Declustering target" onChange={(e) => setTarget(e.target.value as Target)} value={target}><option value="minimum">Minimum mean (clustered high grade)</option><option value="maximum">Maximum mean (clustered low grade)</option></select><ChevronDown size={14} /></label>
      <div className="eda-run-control"><span title={prepared !== null && prepared.dropped > 0 ? 'Rows without valid easting/northing are excluded' : undefined}>{prepared === null ? 'Needs ≥10 located samples' : `${prepared.values.length} samples · extent ${Math.round(prepared.extent)} m${prepared.dropped > 0 ? ` · ${prepared.dropped} unlocated skipped` : ''}`}</span><button className="primary-button" disabled={prepared === null || pending !== null} onClick={() => { void runDecluster() }} type="button">{pending === 'decluster' ? <RefreshCw className="is-spinning" size={13} /> : <Play size={13} />}{pending === 'decluster' ? 'Running…' : 'Run'}</button></div>
    </section>

    {decluster !== null ? <section className="panel domain-population-grid">
      <ChartCard detail={`Naive ${fmt(decluster.naiveMean)} → declustered ${fmt(decluster.declusteredMean)} ${unit} at ${fmt(decluster.chosen.cellSize, 1)} m (${decluster.chosen.cellCount} cells)`} title="Cell-size optimisation">
        <GeoEyeChart ariaLabel="Declustered mean against cell size" exportFeature="grade" exportName="decluster-curve" option={buildDeclusterCurveOption(decluster, unit)} />
      </ChartCard>
      {topcut !== null ? <ChartCard detail="Weighted · decile breaks dotted · pick a cut-off below" title="Log-probability plot"><GeoEyeChart ariaLabel="Log probability plot" exportFeature="grade" exportName="log-probability" option={buildLogProbabilityOption(topcut, chosen?.cutOff ?? null, unit)} /></ChartCard> : null}
      {topcut !== null ? <ChartCard detail="Where the mean stops moving, the cut stops costing" title="Mean & CV vs cut-off"><GeoEyeChart ariaLabel="Capped mean and CV against cut-off" exportFeature="grade" exportName="mean-cv-cutoff" option={buildMeanCvCurveOption(topcut, chosen?.cutOff ?? null, unit)} /></ChartCard> : null}
    </section> : null}

    {topcut !== null ? <section className="panel domain-contact-table grade-scenarios">
      <header><div><h2>Top-cut scenarios</h2><p>n={topcut.count} · effective n={fmt(topcut.effectiveCount, 0)} · naive mean {fmt(topcut.naiveMean)} · CV {fmt(topcut.naiveCv, 2)} · max {fmt(topcut.maximum)}</p></div>
        <label><span>Custom cut</span><input inputMode="decimal" onBlur={() => { void runTopcut() }} onChange={(e) => setCustomCut(e.target.value)} placeholder={unit} style={{ width: 90 }} value={customCut} /></label></header>
      <div className="domain-contact-row is-header"><span /><span>Cut-off</span><span>Capped</span><span>Mean</span><span>Δ mean</span><span>CV</span><span>Metal removed</span></div>
      {topcut.scenarios.map((s) => <label className={`domain-contact-row grade-scenario ${s.label === cutLabel ? 'is-selected' : ''}`} key={s.label}>
        <input checked={s.label === cutLabel} name="topcut" onChange={() => setCutLabel(s.label)} type="radio" />
        <strong>{s.label}<small>{fmt(s.cutOff)} {unit}</small></strong>
        <span>{s.cappedCount} ({fmt(s.cappedPercent, 2)} %)</span>
        <span>{fmt(s.mean)}</span>
        <span>{fmt(s.meanChangePercent, 1)} %</span>
        <span>{fmt(s.cv, 2)}</span>
        <b className={s.metalRemovedPercent > 10 ? 'is-risk' : s.metalRemovedPercent > 3 ? 'is-soft' : 'is-hard'} title={s.metalRemovedPercent > 10 ? 'High metal at risk — justify with geology' : s.metalRemovedPercent > 3 ? 'Moderate — check against neighbours' : 'Low impact'}>{fmt(s.metalRemovedPercent, 1)} %</b>
      </label>)}
      <footer><Grid2x2 size={14} /> <span>{chosen === null ? 'Select a scenario to carry into variography.' : `Selected ${chosen.label} — cut at ${fmt(chosen.cutOff)} ${unit}, ${fmt(chosen.metalRemovedPercent, 1)} % metal removed.`}</span></footer>
    </section> : null}
    {decluster !== null ? <SaveExportBar lineage={() => ({ runId, scope: scope.summary, variable: key, cellRange, verticalRatio, target, chosenCell: decluster.chosen, naiveMean: decluster.naiveMean, declusteredMean: decluster.declusteredMean, cut: chosen })} summary={`${variable?.shortLabel ?? ''} · cell ${fmt(decluster.chosen.cellSize, 0)} m${chosen ? ` · cut ${chosen.label}` : ''}`} tables={tables} /> : null}
  </div>
}
