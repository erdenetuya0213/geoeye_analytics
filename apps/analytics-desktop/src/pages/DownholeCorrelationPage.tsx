import { useMemo, useRef, useState } from 'react'
import { comparisonImportDataset, completeComparisonRows, type ComparisonImport } from '../analysis/intervalComparison.js'
import { GeoEyeChart } from '../components/GeoEyeChart.js'
import { readImportSource } from '../data/importSource.js'
import { useProjectEdaDatasets } from '../data/liveEda.js'
import { usePersistentState } from '../state/persistentState.js'
import { intervalComparisonOption, type ComparisonView } from '../visualization/intervalComparisonCharts.js'

export function DownholeCorrelationWorkspace({ embedded = false }: { embedded?: boolean }) {
  const query = useProjectEdaDatasets()
  const [imports, setImports] = usePersistentState<ComparisonImport[]>('comparison.imports', [])
  const [datasetId, setDatasetId] = usePersistentState('comparison.dataset', '')
  const [view, setView] = usePersistentState<ComparisonView>('comparison.view', 'downhole')
  const [hole, setHole] = usePersistentState('comparison.hole', '')
  const [curveKeys, setCurveKeys] = usePersistentState<string[]>('comparison.curves', [])
  const [dimension, setDimension] = usePersistentState('comparison.dimension', '')
  const [xKey, setXKey] = usePersistentState('comparison.x', '')
  const [reference, setReference] = usePersistentState('comparison.reference', 'Reference-01')
  const [note, setNote] = usePersistentState('comparison.note', 'Saved observations; verify source versions and calculation rules before publication.')
  const [aliases, setAliases] = usePersistentState<Record<string, string>>('comparison.labels', {})
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const imported = useMemo(() => imports.flatMap(input => { try { return [comparisonImportDataset(input)] } catch { return [] } }), [imports])
  const datasets = useMemo(() => [...imported, ...(query.data ?? [])], [imported, query.data])
  const dataset = datasets.find(d => d.id === datasetId)
  const variables = dataset?.variables.filter(v => v.dataType !== 'category') ?? []
  const holes = [...new Set(dataset?.observations.map(r => r.holeId) ?? [])].sort()
  const activeHole = holes.includes(hole) ? hole : holes[0] ?? ''
  const activeCurves = useMemo(() => curveKeys.filter(key => variables.some(v => v.key === key)).slice(0, 3), [curveKeys, dataset])
  const curves = useMemo(() => activeCurves.map(key => ({ key, label: aliases[`${datasetId}:${key}`] || variables.find(v => v.key === key)!.label })), [activeCurves, aliases, datasetId, dataset])
  const selectedX = variables.find(v => v.key === xKey)
  const cohort = useMemo(() => {
    try {
      if (!dataset || (view === 'correlation' && !selectedX)) return { rows: [], error: '' }
      return { rows: completeComparisonRows(dataset.observations, activeHole, view === 'correlation' ? [...activeCurves, xKey] : activeCurves), error: '' }
    } catch (e) { return { rows: [], error: String(e instanceof Error ? e.message : e) } }
  }, [dataset, activeHole, activeCurves, view, xKey, selectedX])
  const unit = variables.find(v => v.key === activeCurves[0])?.unit ?? ''
  const mixedUnits = activeCurves.some(key => variables.find(v => v.key === key)?.unit !== unit)
  const ready = cohort.rows.length > 0 && !mixedUnits && (view !== 'groups' || Boolean(dimension))
  const option = useMemo(() => intervalComparisonOption({ rows: cohort.rows, curves, view, reference, note, unit, percent: unit === '%', dimension, xKey, xLabel: selectedX?.label ?? '' }), [cohort.rows, curves, view, reference, note, unit, dimension, xKey, selectedX?.label])
  const chooseDataset = (id: string) => {
    const selected = datasets.find(d => d.id === id)
    setDatasetId(id); setHole('')
    setCurveKeys(selected?.variables.filter(v => v.unit === '%' && v.dataType !== 'category').slice(0, 3).map(v => v.key) ?? [])
    setDimension(selected?.dimensions.find(d => /mechanical|zone group/i.test(d.label))?.key ?? '')
    setXKey(selected?.variables.find(v => /fracture frequency/i.test(v.label))?.key ?? '')
  }
  const importFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      if (file.size > 700_000) throw new Error('Comparison CSV must be smaller than 700 KB. Use a scoped, depth-matched cohort.')
      const source = await readImportSource(file)
      const entry = { id: `comparison-${crypto.randomUUID()}`, name: file.name, csv: source.contents, capturedAt: new Date().toISOString() }
      const result = comparisonImportDataset(entry)
      if (JSON.stringify([...imports, entry]).length > 900_000) throw new Error('Local comparison storage limit reached. Existing imports are preserved.')
      setImports(current => [...current, entry]); chooseDataset(entry.id)
      setCurveKeys(result.variables.filter(v => v.unit === '%').slice(0, 3).map(v => v.key))
      setDimension(result.dimensions.find(d => /mechanical|zone group/i.test(d.label))?.key ?? result.dimensions[0]?.key ?? '')
      setXKey(result.variables.find(v => /fracture frequency/i.test(v.label))?.key ?? '')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { if (fileInput.current) fileInput.current.value = '' }
  }
  return <div className={`correlation-page ${embedded ? 'is-embedded' : 'page'}`}>
    <section className="panel comparison-controls">
      <header><h2>Interval comparison</h2><button type="button" onClick={() => fileInput.current?.click()}>Open comparison CSV</button><input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={e => void importFile(e.target.files?.[0])} /></header>
      <p>Use one depth-matched cohort. Local comparison imports stay separate from logging templates and laboratory datasets.</p>
      <div className="comparison-fields">
        <label>Comparison dataset<select value={dataset?.id ?? ''} onChange={e => chooseDataset(e.target.value)}><option value="">Choose dataset…</option>{datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Borehole / reference<select value={activeHole} onChange={e => setHole(e.target.value)}>{holes.map(h => <option key={h}>{h}</option>)}</select></label>
        <label>Publication reference<input value={reference} maxLength={40} onChange={e => setReference(e.target.value)} /></label>
        <label>Grouping field<select value={dimension} onChange={e => setDimension(e.target.value)}><option value="">Choose category…</option>{dataset?.dimensions.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select></label>
        <label>Correlation X<select value={selectedX?.key ?? ''} onChange={e => setXKey(e.target.value)}><option value="">Choose numeric value…</option>{variables.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}</select></label>
      </div>
      <fieldset><legend>Curves (up to three, in presentation order)</legend>{[0, 1, 2].map(i => <div className="comparison-curve" key={i}><label>Curve {i + 1}<select value={activeCurves[i] ?? ''} onChange={e => setCurveKeys(current => { const next = [...current]; next[i] = e.target.value; return next.filter((k, n) => k && next.indexOf(k) === n) })}><option value="">Not shown</option>{variables.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}</select></label><label>Figure label<input value={curves[i]?.label ?? ''} disabled={!curves[i]} maxLength={64} onChange={e => { const key = curves[i]?.key; if (key) setAliases(current => ({ ...current, [`${datasetId}:${key}`]: e.target.value })) }} /></label></div>)}</fieldset>
      <label>Figure provenance / caveat<input value={note} maxLength={220} onChange={e => setNote(e.target.value)} /></label>
      <nav aria-label="Comparison view">{(['downhole', 'groups', 'correlation'] as const).map(v => <button type="button" aria-pressed={view === v} key={v} onClick={() => setView(v)}>{v === 'downhole' ? 'Downhole profiles' : v === 'groups' ? 'Mechanical-state means' : 'Fracture-frequency correlation'}</button>)}</nav>
      <p role="status">{error || cohort.error || (mixedUnits ? 'Choose curves with the same units.' : `${cohort.rows.length} complete, non-overlapping intervals · ${cohort.rows.reduce((s, r) => s + r.depthTo - r.depthFrom, 0).toFixed(2)} m shared support. Missing values excluded; zero retained.`)}</p>
      <p>Source: {dataset?.producer ?? 'Choose a dataset'} · {dataset?.snapshotAt ?? ''}. Imports are not a live refresh. Correlations describe this cohort; adjacent intervals are not independent samples.</p>
    </section>
    {ready ? <section className={`panel comparison-figure comparison-figure-${view}`}><GeoEyeChart key={`${datasetId}:${view}`} ariaLabel={`${view} comparison figure`} option={option} publicationStyle renderer="svg" exportFileName={`${reference}-${view}`} exportSize={{ width: 1440, height: view === 'downhole' ? 1600 : 950 }} clickSelection="none" /></section> : <section className="panel eda-state">Choose a dataset, curve values and the required grouping or correlation field.</section>}
  </div>
}

export function DownholeCorrelationPage() { return <DownholeCorrelationWorkspace /> }
