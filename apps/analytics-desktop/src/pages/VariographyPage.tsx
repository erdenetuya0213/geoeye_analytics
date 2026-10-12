import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Compass, Copy, Play, RefreshCw, Sparkles } from 'lucide-react'
import { callEngine, engineAvailable, type ExperimentalVariogram, type FanResult, type StructureType, type VariogramModel } from '../analysis/engineClient.js'
import { defaultModel, practicalRange, withTotalSill } from '../analysis/variogramModel.js'
import { GeoEyeChart } from '../components/GeoEyeChart.js'
import { useProjectEdaDatasets } from '../data/liveEda.js'
import { usePersistentState } from '../state/persistentState.js'
import { buildFanOption, buildVariogramOption, directionColors } from '../visualization/variogramCharts.js'

type Transform = 'raw' | 'normal-scores' | 'log'
interface Prepared { values: number[]; coordinates: number[][]; holeIds: string[]; extent: number; compositeLength: number; holeCount: number }
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
  const datasetsQuery = useProjectEdaDatasets()
  const datasets = datasetsQuery.data ?? []
  const [datasetId, setDatasetId] = usePersistentState('vg.datasetId', '')
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
  const [error, setError] = useState<string | null>(null)

  const dataset = datasets.find((d) => d.id === datasetId) ?? datasets[0]
  const numeric = dataset?.variables.filter((v) => v.dataType !== 'category') ?? []
  const variable = numeric.find((v) => v.key === variableKey) ?? numeric[0]
  const directions = principalDirections(strike, dip, plunge)
  const signature = `${dataset?.id ?? ''}|${variable?.key ?? ''}|${transform}`
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
    return { values, coordinates, holeIds, extent, compositeLength: Math.max(0.1, median(lengths)), holeCount: new Set(holeIds).size }
  }, [dataset, variable, transform])

  const autoLag = () => { if (prepared !== null) setLag(Number((prepared.extent / Math.max(2, Math.sqrt(prepared.holeCount))).toPrecision(2))) }
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
  const downholeMax = prepared === null ? hMax : prepared.compositeLength * DOWNHOLE_LAGS
  const exportJson = () => { if (model) void navigator.clipboard.writeText(JSON.stringify({ variable: variable?.key, transform, directions, model }, null, 2)) }

  return <div className="page domain-page domain-simple-page vg-page">
    <h1 className="sr-only">Variography</h1>
    {!engineAvailable() ? <section className="panel" role="alert" style={{ padding: 16 }}>The analytics engine runs only in the desktop app.</section> : null}
    {error ? <p role="alert">{error}</p> : null}

    <section className="analysis-toolbar eda-toolbar vg-toolbar">
      <label className="tool-select tool-select-field eda-dataset-select"><span>Dataset snapshot</span><select aria-label="Variography dataset" onChange={(e) => setDatasetId(e.target.value)} value={dataset?.id ?? ''}>{datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field"><span>Variable</span><select aria-label="Variography variable" onChange={(e) => setVariableKey(e.target.value)} value={variable?.key ?? ''}>{numeric.map((v) => <option key={v.key} value={v.key}>{v.shortLabel} · {v.unit}</option>)}</select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field"><span>Transform</span><select aria-label="Transform" onChange={(e) => setTransform(e.target.value as Transform)} value={transform}><option value="normal-scores">Normal scores</option><option value="log">Log</option><option value="raw">Raw</option></select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field tool-number-field" title="Strike azimuth of the mineralised plane"><span>Strike °</span><input aria-label="Strike" inputMode="decimal" onChange={(e) => setStrike(Number(e.target.value) || 0)} value={strike} /></label>
      <label className="tool-select tool-select-field tool-number-field"><span>Dip °</span><input aria-label="Dip" inputMode="decimal" onChange={(e) => setDip(Number(e.target.value) || 0)} value={dip} /></label>
      <label className="tool-select tool-select-field tool-number-field"><span>Plunge °</span><input aria-label="Plunge" inputMode="decimal" onChange={(e) => setPlunge(Number(e.target.value) || 0)} value={plunge} /></label>
      <label className="tool-select tool-select-field tool-number-field"><span>Lag (m)</span><input aria-label="Lag" inputMode="decimal" onChange={(e) => setLag(Number(e.target.value) || 1)} value={lag} /></label>
      <button className="button button-secondary" onClick={autoLag} type="button" title="≈ drill spacing (extent / √holes)">Auto</button>
      <label className="tool-select tool-select-field tool-number-field"><span>Lags</span><input aria-label="Lag count" inputMode="numeric" onChange={(e) => setLagCount(Math.max(3, Number(e.target.value) || 12))} value={lagCount} /></label>
      <label className="tool-select tool-select-field tool-number-field"><span>Tolerance °</span><input aria-label="Angular tolerance" inputMode="decimal" onChange={(e) => setTolerance(Number(e.target.value) || 22.5)} value={tolerance} /></label>
      <label className="tool-select tool-select-field tool-number-field" title="0 = none"><span>Band (m)</span><input aria-label="Bandwidth" inputMode="decimal" onChange={(e) => setBandwidth(Number(e.target.value) || 0)} value={bandwidth} /></label>
      <div className="eda-run-control"><span>{prepared === null ? 'Needs ≥20 located samples' : `${prepared.values.length} samples · ${prepared.holeCount} holes · composite ${fmt(prepared.compositeLength, 1)} m`}</span><button className="primary-button" disabled={prepared === null || pending !== null} onClick={() => { void run() }} type="button">{pending === 'experimental' ? <RefreshCw className="is-spinning" size={13} /> : <Play size={13} />}{pending === 'experimental' ? 'Computing…' : 'Compute'}</button></div>
    </section>

    {experiments !== null ? <>
      <section className="vg-grid">
        <Panel color={directionColors[0] ?? ''} detail={`lag ${fmt(prepared?.compositeLength, 1)} m · along hole`} title="Downhole"><GeoEyeChart ariaLabel="Downhole variogram" option={buildVariogramOption(experiments.downhole, model, 3, experiments.sill, directionColors[0] ?? '', downholeMax)} /></Panel>
        {directions.map((d, i) => <Panel color={directionColors[i + 1] ?? ''} detail={`az ${Math.round(d.azimuth)}° · dip ${Math.round(d.dip)}° · ±${tolerance}°`} key={d.label} title={d.label}><GeoEyeChart ariaLabel={`${d.label} variogram`} option={buildVariogramOption(experiments.directions[i] ?? null, model, i, experiments.sill, directionColors[i + 1] ?? '', hMax)} /></Panel>)}
        <Panel color={directionColors[1] ?? ''} detail="Horizontal plane · 18 rays · 70 % sill reach" title="Continuity fan"><GeoEyeChart ariaLabel="Horizontal continuity fan" option={buildFanOption(experiments.fan, experiments.sill)} /></Panel>
        <section className="eda-chart-card domain-chart-card vg-panel vg-model" style={{ borderTopColor: directionColors[3] }}>
          <header><div><h3>Model</h3><p>{model ? `total sill ${fmt(model.totalSill, 3)} · nugget ${Math.round((model.nugget / model.totalSill) * 100)} %${model.rmse !== undefined ? ` · fit rmse ${fmt(model.rmse, 3)}` : ''}` : 'no model yet'}</p></div>
            <div className="vg-model-actions"><button className="ghost" disabled={pending !== null} onClick={() => { void autoFit() }} type="button"><Sparkles size={13} /> Auto-fit</button><button className="ghost" disabled={model === null} onClick={exportJson} type="button"><Copy size={13} /> Copy JSON</button></div></header>
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
    </> : null}
  </div>
}
