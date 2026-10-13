import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Compass, Copy, Play, RefreshCw, Sparkles } from 'lucide-react'
import { callEngine, engineAvailable, type ExperimentalVariogram, type FanResult, type StructureType, type VariogramModel } from '../analysis/engineClient.js'
import { defaultModel, practicalRange, withTotalSill } from '../analysis/variogramModel.js'
import { experimentalAdvice, lagAdvice, modelAdvice, type Advice } from '../analysis/variogramAdvice.js'
import { GeoEyeChart } from '../components/GeoEyeChart.js'
import { VariogramPanel } from '../components/VariogramPanel.js'
import { AnalysisScopePicker, useAnalysisScope } from '../components/AnalysisScope.js'
import { usePersistentState } from '../state/persistentState.js'
import { variogramExports, type AxisDirection } from '../data/resultExport.js'
import { SaveExportBar, type ExportTable } from '../components/SaveExportBar.js'
import { buildFanOption, buildVariogramMapOption, buildVariogramOption, directionColors } from '../visualization/variogramCharts.js'

type Transform = 'raw' | 'normal-scores' | 'log'
interface Prepared { values: number[]; coordinates: number[][]; holeIds: string[]; extent: number; compositeLength: number; holeCount: number; collars: Array<[number, number]> }
interface Experiments { downhole: ExperimentalVariogram; directions: ExperimentalVariogram[]; fan: FanResult; sill: number }

const DOWNHOLE_LAGS = 50
const fmt = (v: number | undefined, d = 2) => v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d)
const median = (xs: number[]) => { const a = [...xs].sort((l, r) => l - r); return a[Math.floor(a.length / 2)] ?? 0 }
const robustSpan = (xs: number[]) => { const a = [...xs].sort((l, r) => l - r); const q = (p: number) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))] ?? 0; return q(0.98) - q(0.02) }

/** Principal directions from strike/dip/plunge: D1 along strike (plunge), D2 down-dip, D3 pole. */
function principalDirections(strike: number, dip: number, plunge: number) {
  return [
    { label: 'D1 · strike', azimuth: strike % 360, dip: plunge },
    { label: 'D2 · dip', azimuth: (strike + 90) % 360, dip },
    { label: 'D3 · across', azimuth: (strike + 270) % 360, dip: 90 - dip },
  ]
}

function Panel({ children, detail, title, color }: { children: React.ReactNode; detail: string; title: string; color: string }) {
  return <section className="eda-chart-card domain-chart-card vg-panel" style={{ borderTopColor: color }}><header><div><h3>{title}</h3><p>{detail}</p></div></header><div className="eda-plot">{children}</div></section>
}

export function VariographyPage() {
  const scope = useAnalysisScope()
  const [variableKey, setVariableKey] = usePersistentState('vg.variableKey', '')
  const [transform, setTransform] = usePersistentState<Transform>('vg.transform', 'normal-scores')
  const [strike, setStrike] = usePersistentState('vg.strike', 0)
  const [dip, setDip] = usePersistentState('vg.dip', 60)
  const [plunge, setPlunge] = usePersistentState('vg.plunge', 0)
  const [lag, setLag] = usePersistentState('vg.lag', 0)
  const [lagCount, setLagCount] = usePersistentState('vg.lagCount', 12)
  const [tolerance, setTolerance] = usePersistentState('vg.tolerance', 22.5)
  const [bandwidth, setBandwidth] = usePersistentState('vg.bandwidth', 0)
  const [structureTypes, setStructureTypes] = usePersistentState<StructureType[]>('vg.structureTypes', ['spherical', 'spherical'])
  const [model, setModel] = usePersistentState<VariogramModel | null>('vg.model', null)
  const [storedRun, setStoredRun] = usePersistentState<{ signature: string; experiments: Experiments } | null>('vg.lastRun', null)
  const [pending, setPending] = useState<string | null>(null)
  const [fanView, setFanView] = usePersistentState<'fan' | 'map'>('vg.fanView', 'fan')
  const [error, setError] = useState<string | null>(null)

  const dataset = scope.dataset
  const numeric = dataset?.variables.filter((v) => v.dataType !== 'category') ?? []
  const variable = numeric.find((v) => v.key === variableKey) ?? numeric[0]
  const directions = principalDirections(strike, dip, plunge)
  const signature = `${scope.signature}|${variable?.key ?? ''}|${transform}`
  const experiments = storedRun?.signature === signature ? storedRun.experiments : null
  const setExperiments = (next: Experiments | null) => setStoredRun(next === null ? null : { signature, experiments: next })

  const prepared = useMemo((): Prepared | null => {
    if (dataset === undefined || variable === undefined) return null
    const values: number[] = [], coordinates: number[][] = [], holeIds: string[] = [], lengths: number[] = []
    for (const o of dataset.observations) {
      const v = o.values[variable.key]
      if (v === null || v === undefined || !Number.isFinite(v) || !Number.isFinite(o.easting) || !Number.isFinite(o.northing) || (o.easting === 0 && o.northing === 0)) continue
      if (transform === 'log' && v <= 0) continue
      values.push(v); coordinates.push([o.easting, o.northing, -(o.depthFrom + o.depthTo) / 2]); holeIds.push(o.holeId); lengths.push(o.depthTo - o.depthFrom)
    }
    if (values.length < 20) return null
    const extent = Math.max(robustSpan(coordinates.map((p) => p[0] ?? 0)), robustSpan(coordinates.map((p) => p[1] ?? 0)))
    const collarMap = new Map<string, [number, number]>()
    coordinates.forEach((p, i) => { const h = holeIds[i] ?? ''; if (!collarMap.has(h)) collarMap.set(h, [p[0] ?? 0, p[1] ?? 0]) })
    return { values, coordinates, holeIds, extent, compositeLength: Math.max(0.1, median(lengths)), holeCount: collarMap.size, collars: [...collarMap.values()] }
  }, [dataset, variable, transform])

  const advice = useMemo(() => prepared === null ? null : lagAdvice(prepared.collars, prepared.extent), [prepared])
  const autoLag = () => { if (advice !== null) { setLag(advice.lag); setLagCount(advice.lagCount) } }
  useEffect(() => { if (lag === 0) autoLag() }, [prepared]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (prepared === null) return
    setPending('experimental'); setError(null)
    try {
      let values = prepared.values
      if (transform === 'normal-scores') values = (await callEngine('variography.normalScores', { values })).scores
      if (transform === 'log') values = values.map((v) => Math.log(v))
      const base = { coordinates: prepared.coordinates, values }
      const bw = bandwidth > 0 ? bandwidth : undefined
      const [downhole, dirs, fan] = await Promise.all([
        callEngine('variography.experimental', { ...base, lag: prepared.compositeLength, lagCount: DOWNHOLE_LAGS, holeIds: prepared.holeIds, downhole: true }),
        Promise.all(directions.map((d) => callEngine('variography.experimental', { ...base, lag, lagCount, direction: { azimuth: d.azimuth, dip: d.dip, azimuthTolerance: tolerance, dipTolerance: tolerance, ...(bw === undefined ? {} : { bandwidth: bw }) } }))),
        callEngine('variography.fan', { ...base, plane: 'horizontal', lag, lagCount, rays: 18, tolerance: 10 }),
      ])
      const sill = transform === 'normal-scores' ? 1 : downhole.variance
      setExperiments({ downhole, directions: dirs, fan, sill })
      if (model === null) setModel(defaultModel(sill, lag * lagCount, 4))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setPending(null) }
  }

  const autoFit = async () => {
    if (experiments === null) return
    setPending('fit'); setError(null)
    try {
      const fit = await callEngine('variography.autoFit', { experiments: [...experiments.directions, experiments.downhole].map((e) => ({ lags: e.lags })), structureTypes, ...(transform === 'normal-scores' ? { totalSill: 1 } : {}) })
      setModel(withTotalSill(fit))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setPending(null) }
  }

  const updateModel = (next: VariogramModel) => setModel(withTotalSill(next))
  const setStructure = (i: number, patch: Partial<VariogramModel['structures'][number]>) => { if (model) updateModel({ ...model, structures: model.structures.map((s, k) => (k === i ? { ...s, ...patch } : s)) }) }
  const hMax = lag * lagCount
  const spacing = advice?.spacing ?? lag
  const explain: Advice[] = experiments === null ? [] : [
    ...experimentalAdvice('Downhole', experiments.downhole, experiments.sill, prepared?.compositeLength ?? 1),
    ...directions.flatMap((d, i) => experimentalAdvice(d.label, experiments.directions[i] ?? null, experiments.sill, spacing)),
    ...(model === null ? [] : modelAdvice(model, spacing, hMax, prepared?.holeCount ?? 0)),
  ]
  const pairNote = (e: ExperimentalVariogram | undefined) => e === undefined ? '' : ` · ${e.lags.reduce((s, l) => s + l.pairs, 0).toLocaleString()} pairs${e.lags.some((l) => l.pairs < 30) ? ' · some lags < 30' : ''}`
  const downholeMax = prepared === null ? hMax : prepared.compositeLength * DOWNHOLE_LAGS
  const runId = `variography-${signature.replace(/[^a-z0-9]+/gi, '-')}`
  const stem = `variogram-${variable?.key ?? 'variable'}-${transform}`
  const exportBundle = () => model === null || dataset === undefined ? null : variogramExports({ variable: variable?.key ?? '', transform, datasetName: dataset.name, runId, strike, dip, plunge, directions: directions as AxisDirection[], model, hMax })
  const tables: ExportTable[] = [
    { name: 'axes', csv: () => exportBundle()?.axisTable ?? '' },
    { name: 'structures', csv: () => exportBundle()?.structures ?? '' },
    { name: 'leapfrog', csv: () => exportBundle()?.leapfrog ?? '' },
    { name: 'experimental', csv: () => experiments === null ? '' : ['direction,distance_m,gamma,pairs', ...[['downhole', experiments.downhole] as const, ...directions.map((d, i) => [d.label, experiments.directions[i]] as const)].flatMap(([label, e]) => (e?.lags ?? []).map((l) => `${label},${l.distance},${l.gamma},${l.pairs}`))].join('\n') + '\n' },
  ]

  return <div className="page domain-page domain-simple-page vg-page">
    <h1 className="sr-only">Variography</h1>
    {!engineAvailable() ? <section className="panel" role="alert" style={{ padding: 16 }}>The analytics engine runs only in the desktop app.</section> : null}
    {error ? <p role="alert">{error}</p> : null}

    <section className="analysis-toolbar eda-toolbar vg-toolbar">
      <AnalysisScopePicker scope={scope} />
      <label className="tool-select tool-select-field"><span>Variable</span><select aria-label="Variography variable" onChange={(e) => setVariableKey(e.target.value)} value={variable?.key ?? ''}>{numeric.map((v) => <option key={v.key} value={v.key}>{v.shortLabel} · {v.unit}</option>)}</select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field"><span>Transform</span><select aria-label="Transform" onChange={(e) => setTransform(e.target.value as Transform)} value={transform}><option value="normal-scores">Normal scores</option><option value="log">Log</option><option value="raw">Raw</option></select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field tool-number-field" title="Strike azimuth of the mineralised plane"><span>Strike °</span><input aria-label="Strike" inputMode="decimal" onChange={(e) => setStrike(Number(e.target.value) || 0)} value={strike} /></label>
      <label className="tool-select tool-select-field tool-number-field"><span>Dip °</span><input aria-label="Dip" inputMode="decimal" onChange={(e) => setDip(Number(e.target.value) || 0)} value={dip} /></label>
      <label className="tool-select tool-select-field tool-number-field"><span>Plunge °</span><input aria-label="Plunge" inputMode="decimal" onChange={(e) => setPlunge(Number(e.target.value) || 0)} value={plunge} /></label>
      <label className="tool-select tool-select-field tool-number-field"><span>Lag (m)</span><input aria-label="Lag" inputMode="decimal" onChange={(e) => setLag(Number(e.target.value) || 1)} value={lag} /></label>
      <button className="button button-secondary" onClick={autoLag} type="button" title={advice ? `Median collar spacing ${Math.round(advice.spacing)} m → lag ${advice.lag} m × ${advice.lagCount}` : 'Lag from drill spacing'}>Auto</button>
      <label className="tool-select tool-select-field tool-number-field"><span>Lags</span><input aria-label="Lag count" inputMode="numeric" onChange={(e) => setLagCount(Math.max(3, Number(e.target.value) || 12))} value={lagCount} /></label>
      <label className="tool-select tool-select-field tool-number-field"><span>Tolerance °</span><input aria-label="Angular tolerance" inputMode="decimal" onChange={(e) => setTolerance(Number(e.target.value) || 22.5)} value={tolerance} /></label>
      <label className="tool-select tool-select-field tool-number-field" title="0 = none"><span>Band (m)</span><input aria-label="Bandwidth" inputMode="decimal" onChange={(e) => setBandwidth(Number(e.target.value) || 0)} value={bandwidth} /></label>
      <div className="eda-run-control"><span>{prepared === null ? 'Needs ≥20 located samples' : `${prepared.values.length} samples · ${prepared.holeCount} holes · composite ${fmt(prepared.compositeLength, 1)} m`}</span><button className="primary-button" disabled={prepared === null || pending !== null} onClick={() => { void run() }} type="button">{pending === 'experimental' ? <RefreshCw className="is-spinning" size={13} /> : <Play size={13} />}{pending === 'experimental' ? 'Computing…' : 'Compute'}</button></div>
    </section>

    {experiments !== null ? <>
      <section className="vg-grid">
        <Panel color={directionColors[0] ?? ''} detail={`lag ${fmt(prepared?.compositeLength, 1)} m · along hole${pairNote(experiments.downhole)}`} title="Downhole"><VariogramPanel ariaLabel="Downhole variogram" exportName="downhole" color={directionColors[0] ?? ''} directionIndex={3} model={model} onModelChange={updateModel} option={buildVariogramOption(experiments.downhole, model, 3, experiments.sill, directionColors[0] ?? '', downholeMax)} /></Panel>
        {directions.map((d, i) => <Panel color={directionColors[i + 1] ?? ''} detail={`az ${Math.round(d.azimuth)}° · dip ${Math.round(d.dip)}° · ±${tolerance}°${pairNote(experiments.directions[i])}`} key={d.label} title={d.label}><VariogramPanel ariaLabel={`${d.label} variogram`} exportName={`D${i + 1}`} color={directionColors[i + 1] ?? ''} directionIndex={i} model={model} onModelChange={updateModel} option={buildVariogramOption(experiments.directions[i] ?? null, model, i, experiments.sill, directionColors[i + 1] ?? '', hMax)} /></Panel>)}
        <section className="eda-chart-card domain-chart-card vg-panel" style={{ borderTopColor: directionColors[1] }}><header><div><h3>{fanView === 'fan' ? 'Continuity fan' : 'Variogram map'}</h3><p>{fanView === 'fan' ? 'Horizontal · reach to 70 % sill per azimuth · long axis = strike' : 'Horizontal · γ by azimuth and lag · cool = continuous'}</p></div><div className="vg-model-actions"><button className={fanView === 'fan' ? 'ghost is-active' : 'ghost'} onClick={() => setFanView('fan')} type="button">Fan</button><button className={fanView === 'map' ? 'ghost is-active' : 'ghost'} onClick={() => setFanView('map')} type="button">Map</button></div></header><div className="eda-plot">{fanView === 'fan' ? <GeoEyeChart ariaLabel="Horizontal continuity fan" exportFeature="variography" exportName="fan" option={buildFanOption(experiments.fan, experiments.sill)} /> : <GeoEyeChart ariaLabel="Horizontal variogram map" exportFeature="variography" exportName="variogram-map" option={buildVariogramMapOption(experiments.fan, experiments.sill)} />}</div></section>
        <section className="eda-chart-card domain-chart-card vg-panel vg-model" style={{ borderTopColor: directionColors[3] }}>
          <header><div><h3>Model</h3><p>{model ? `total sill ${fmt(model.totalSill, 3)} · nugget ${Math.round((model.nugget / model.totalSill) * 100)} %${model.rmse !== undefined ? ` · fit rmse ${fmt(model.rmse, 3)}` : ''}` : 'no model yet'}</p></div>
            <div className="vg-model-actions"><button className="ghost" disabled={pending !== null} onClick={() => { void autoFit() }} type="button"><Sparkles size={13} /> Auto-fit</button></div></header>
          {model ? <div className="vg-model-table">
            <div className="vg-row is-header"><span>Structure</span><span>Sill</span><span>D1 range</span><span>D2 range</span><span>D3 range</span><span>Downhole</span></div>
            <div className="vg-row"><strong>Nugget</strong><input inputMode="decimal" onChange={(e) => updateModel({ ...model, nugget: Number(e.target.value) || 0 })} step="0.01" type="number" value={Number(model.nugget.toFixed(4))} /><span /><span /><span /><span /></div>
            {model.structures.map((s, i) => <div className="vg-row" key={i}>
              <select onChange={(e) => { setStructure(i, { type: e.target.value as StructureType }); setStructureTypes(model.structures.map((x, k) => (k === i ? e.target.value as StructureType : x.type))) }} value={s.type}><option value="spherical">Spherical</option><option value="exponential">Exponential</option><option value="gaussian">Gaussian</option></select>
              <input inputMode="decimal" onChange={(e) => setStructure(i, { sill: Number(e.target.value) || 0 })} step="0.01" type="number" value={Number(s.sill.toFixed(4))} />
              {[0, 1, 2].map((k) => <input inputMode="decimal" key={k} onChange={(e) => setStructure(i, { ranges: s.ranges.map((r, j) => (j === k ? Number(e.target.value) || 1 : r)) })} step="1" type="number" value={Math.round(s.ranges[k] ?? 0)} />)}
              <small className="vg-dh-range" title="Downhole range (fitted)">↓ {Math.round(s.ranges[3] ?? s.ranges[0] ?? 0)} m</small>
            </div>)}
            <div className="vg-row is-footer"><span>Practical range (95 %)</span><span /><span>{Math.round(practicalRange(model, 0, hMax * 3))} m</span><span>{Math.round(practicalRange(model, 1, hMax * 3))} m</span><span>{Math.round(practicalRange(model, 2, hMax * 3))} m</span><span>{Math.round(practicalRange(model, 3, downholeMax * 3))} m</span></div>
            <div className="vg-row is-footer"><span><Compass size={12} /> Anisotropy D1:D2:D3</span><span /><span>1</span><span>{fmt(practicalRange(model, 1, hMax * 3) / practicalRange(model, 0, hMax * 3), 2)}</span><span>{fmt(practicalRange(model, 2, hMax * 3) / practicalRange(model, 0, hMax * 3), 2)}</span><span /></div>
          </div> : null}
        </section>
      </section>
      {explain.length > 0 ? <section className="panel vg-explain"><header><h3>What the data says</h3><span>{explain.filter((a) => a.severity === 'warn').length} warnings · {explain.filter((a) => a.severity === 'note').length} notes</span></header>
        <ul>{explain.map((a, i) => <li className={`is-${a.severity}`} key={i}><i /><div><strong>{a.title}</strong><p>{a.detail}</p></div></li>)}</ul></section> : null}
      <SaveExportBar disabled={model === null} lineage={() => ({ runId, scope: scope.summary, variable: variable?.key, transform, strike, dip, plunge, lag, lagCount, tolerance, bandwidth, directions, model, gslib: exportBundle()?.gslib })} summary={`${variable?.shortLabel ?? ''} · ${transform} · ${model ? `${model.structures.length} structures` : 'no model'}`} tables={tables} />
    </> : null}
  </div>
}
