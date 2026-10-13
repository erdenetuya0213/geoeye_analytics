import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Info } from 'lucide-react'
import type { EChartsCoreOption } from 'echarts/core'
import { schmidtToUcsMpa, SCHMIDT_VALID_RANGE } from '../analysis/schmidt.js'
import {
  DEFAULT_STRENGTH_SETTINGS,
  analyzeStrength,
  guessStrengthSources,
  type SourceRef,
  type StrengthSettings,
  type StrengthSources,
} from '../analysis/strengthCorrelation.js'
import { GeoEyeChart } from '../components/GeoEyeChart.js'
import { SaveExportBar, type ExportTable } from '../components/SaveExportBar.js'
import type { EdaDataset } from '../data/edaTypes.js'
import { useProjectEdaDatasets } from '../data/liveEda.js'
import { csv } from '../data/resultExport.js'
import { usePersistentState } from '../state/persistentState.js'
import { geoEyeChartColors as c } from '../visualization/geoEyeTheme.js'
import { numericFields } from '../data/fieldOptions.js'

type SourceName = 'schmidt' | 'pointLoad' | 'grade' | 'lab'
type Overrides = Partial<Record<SourceName, SourceRef | null>>

const encode = (ref: SourceRef | undefined) => ref === undefined ? '' : JSON.stringify([ref.datasetId, ref.key])
const decode = (value: string): SourceRef | null => {
  if (value === '') return null
  try { const [datasetId, key] = JSON.parse(value) as [string, string]; return { datasetId, key } } catch { return null }
}
const fmt = (value: number | null | undefined, digits = 1) => value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits)
const TEST_TYPE = /test[ _-]?type/i

function Card({ children, detail, title }: { children: React.ReactNode; detail: string; title: string }) {
  return <section className="eda-chart-card domain-chart-card vg-panel"><header><div><h3>{title}</h3><p>{detail}</p></div></header><div className="eda-plot">{children}</div></section>
}

function SourceSelect({ datasets, kind, label, onChange, value }: { datasets: readonly EdaDataset[]; kind: 'numeric' | 'dimension'; label: string; onChange: (ref: SourceRef | null) => void; value: SourceRef | undefined }) {
  return <label className="tool-select tool-select-field"><span>{label}</span>
    <select onChange={(event) => onChange(decode(event.target.value))} value={encode(value)}>
      <option value="">—</option>
      {datasets.map((dataset) => {
        const options = kind === 'numeric'
          ? numericFields(dataset).map((variable) => ({ key: variable.key, label: variable.shortLabel }))
          : dataset.dimensions.map((dimension) => ({ key: dimension.key, label: dimension.label }))
        return options.length === 0 ? null : <optgroup key={dataset.id} label={dataset.name}>{options.map((option) => <option key={option.key} value={encode({ datasetId: dataset.id, key: option.key })}>{option.label}</option>)}</optgroup>
      })}
    </select><ChevronDown size={14} /></label>
}

function NumberField({ label, onChange, title, value }: { label: string; onChange: (value: number) => void; title: string; value: number }) {
  return <label className="tool-select tool-select-field tool-number-field" title={title}><span>{label}</span><input inputMode="decimal" onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next) && next > 0) onChange(next) }} value={value} /></label>
}

/** Custom template: do Schmidt, point-load and lab strength agree with each other and with the logged ISRM grade? */
export function StrengthCorrelationPage() {
  const query = useProjectEdaDatasets()
  const datasets = useMemo(() => query.data ?? [], [query.data])
  const guessed = useMemo(() => guessStrengthSources(datasets), [datasets])
  const [overrides, setOverrides] = usePersistentState<Overrides>('strengthCorr.sources', {})
  const [labTestType, setLabTestType] = usePersistentState<string | null>('strengthCorr.labTestType', null)
  const [settings, setSettings] = usePersistentState<StrengthSettings>('strengthCorr.settings', DEFAULT_STRENGTH_SETTINGS)
  const effectiveSettings: StrengthSettings = { ...DEFAULT_STRENGTH_SETTINGS, ...settings }

  const pick = (name: SourceName): SourceRef | undefined => name in overrides ? (overrides[name] ?? undefined) : guessed[name]
  const labRef = pick('lab')
  const labDataset = datasets.find((dataset) => dataset.id === labRef?.datasetId)
  const testTypeKey = labDataset?.dimensions.find((dimension) => TEST_TYPE.test(`${dimension.key} ${dimension.label}`))?.key
  const testTypes = useMemo(() => testTypeKey === undefined || labDataset === undefined ? [] : [...new Set(labDataset.observations.map((o) => o.dimensions[testTypeKey]).filter((v): v is string => v !== undefined && v !== ''))].sort(), [labDataset, testTypeKey])
  const testType = labTestType ?? (guessed.lab?.datasetId === labRef?.datasetId ? guessed.lab?.testType ?? '' : '')
  const sources: StrengthSources = {
    grade: pick('grade'),
    lab: labRef === undefined ? undefined : { ...labRef, testType: testType === '' ? undefined : testType, testTypeKey },
    pointLoad: pick('pointLoad'),
    schmidt: pick('schmidt'),
  }
  const sourcesKey = JSON.stringify(sources)
  const settingsKey = JSON.stringify(effectiveSettings)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => analyzeStrength(datasets, sources, effectiveSettings), [datasets, sourcesKey, settingsKey])

  if (datasets.length === 0) return <div className="page"><section className="panel" style={{ padding: 16 }}>{query.isPending ? 'Loading datasets…' : 'No datasets in this project yet. Import Schmidt, point-load or lab strength data first.'}</section></div>

  const setSource = (name: SourceName) => (ref: SourceRef | null) => { setOverrides({ ...overrides, [name]: ref }); if (name === 'lab') setLabTestType(null) }
  const schmidtStats = result.ucs[0]!.stats, pliStats = result.ucs[1]!.stats, labStats = result.ucs[2]!.stats
  const labelOf = (dataset: string | undefined, key: string | undefined) => datasets.find((d) => d.id === dataset)?.variables.find((v) => v.key === key)?.shortLabel ?? key ?? ''
  const schmidtRows = sources.schmidt === undefined ? [] : (datasets.find((d) => d.id === sources.schmidt!.datasetId)?.observations ?? []).map((o) => o.values[sources.schmidt!.key]).filter((v): v is number => typeof v === 'number')
  const medianR = schmidtRows.length === 0 ? null : [...schmidtRows].sort((a, b) => a - b)[Math.floor(schmidtRows.length / 2)]!

  const gradeOption: EChartsCoreOption = {
    grid: { left: 56, right: 24, top: 24, bottom: 44 },
    tooltip: { trigger: 'item', formatter: (p: { dataIndex: number }) => { const row = result.grades[p.dataIndex]; return row === undefined ? '' : `${row.grade} · n ${row.n}<br/>median R ${row.median.toFixed(1)}<br/>Q1–Q3 ${row.q1.toFixed(1)}–${row.q3.toFixed(1)}<br/>min–max ${row.min.toFixed(0)}–${row.max.toFixed(0)}` } },
    xAxis: { type: 'category', data: result.grades.map((row) => `${row.grade}\nn=${row.n}`), axisLabel: { color: c.muted, interval: 0 } },
    yAxis: { type: 'value', name: 'Schmidt R', nameLocation: 'middle', nameGap: 36, min: 0 },
    series: [{ type: 'boxplot', data: result.grades.map((row) => [row.min, row.q1, row.median, row.q3, row.max]), itemStyle: { color: c.primarySoft, borderColor: c.primary, borderWidth: 1.4 } }],
  }

  const implied: [number, number][] = []
  for (let r = SCHMIDT_VALID_RANGE.min; r <= SCHMIDT_VALID_RANGE.max; r += 2) {
    const ucs = schmidtToUcsMpa(r, effectiveSettings.unitWeightKnM3)
    if (ucs !== null) implied.push([r, ucs / effectiveSettings.ucsFactor])
  }
  const plotted = result.pairs.filter((pair) => pair.pointLoad > 0)
  const pairOption: EChartsCoreOption = {
    grid: { left: 62, right: 24, top: 34, bottom: 44 },
    legend: { top: 0, textStyle: { color: c.muted } },
    tooltip: { trigger: 'item', formatter: (p: { data: (number | string)[]; seriesType: string }) => p.seriesType === 'scatter' ? `${p.data[2]} · ${Number(p.data[3]).toFixed(1)} m<br/>Schmidt R ${Number(p.data[0]).toFixed(1)} (${p.data[4]} readings)<br/>Is(50) ${Number(p.data[1]).toPrecision(3)} MPa` : `Schmidt R ${p.data[0]} implies Is(50) ${Number(p.data[1]).toPrecision(3)} MPa` },
    xAxis: { type: 'value', name: 'Schmidt R (mean within window)', nameLocation: 'middle', nameGap: 28, min: SCHMIDT_VALID_RANGE.min - 5, max: SCHMIDT_VALID_RANGE.max + 5 },
    yAxis: { type: 'log', name: 'Is(50) MPa', nameLocation: 'middle', nameGap: 44 },
    series: [
      { type: 'line', name: 'Is(50) implied by Schmidt', data: implied, showSymbol: false, silent: false, lineStyle: { color: c.accent, type: 'dashed', width: 1.6 } },
      { type: 'scatter', name: 'Measured Is(50)', symbolSize: 8, itemStyle: { color: c.blue, opacity: 0.8 }, data: plotted.map((pair) => [pair.schmidt, pair.pointLoad, pair.hole, pair.depth, pair.schmidtReadings]) },
    ],
  }

  const ucsGroups = result.ucs.filter((group) => group.stats.count > 0)
  const groupColor: Record<string, string> = { 'Lab UCS': c.primary, 'Point-load-derived': c.blue, 'Schmidt-derived': c.violet }
  const ucsOption: EChartsCoreOption = {
    grid: { left: 62, right: 24, top: 24, bottom: 52 },
    tooltip: { trigger: 'item', formatter: (p: { dataIndex: number }) => { const g = ucsGroups[p.dataIndex]; return g === undefined ? '' : `${g.name} · n ${g.stats.count}<br/>median ${fmt(g.stats.median, 0)} MPa<br/>Q1–Q3 ${fmt(g.stats.q1, 0)}–${fmt(g.stats.q3, 0)}<br/>min–max ${fmt(g.stats.minimum, 0)}–${fmt(g.stats.maximum, 0)}` } },
    xAxis: { type: 'category', data: ucsGroups.map((group) => `${group.name}\nn=${group.stats.count}`), axisLabel: { color: c.muted, interval: 0 } },
    yAxis: { type: 'log', name: 'UCS (MPa)', nameLocation: 'middle', nameGap: 44 },
    series: [{ type: 'boxplot', data: ucsGroups.map((group) => ({ value: [group.stats.minimum, group.stats.q1, group.stats.median, group.stats.q3, group.stats.maximum], itemStyle: { color: `${groupColor[group.name] ?? c.blue}33`, borderColor: groupColor[group.name] ?? c.blue, borderWidth: 1.4 } })) }],
  }

  const check = result.unitCheck
  const tables: ExportTable[] = [
    { name: 'schmidt-by-grade', csv: () => csv(['isrm_grade', 'n', 'min', 'q1', 'median', 'q3', 'max'], result.grades.map((g) => [g.grade, g.n, g.min, g.q1, g.median, g.q3, g.max])) },
    { name: 'pli-vs-schmidt', csv: () => csv(['hole', 'depth_m', 'schmidt_mean_r', 'schmidt_readings', 'is50_mpa'], result.pairs.map((p) => [p.hole, p.depth, p.schmidt, p.schmidtReadings, p.pointLoad])) },
    { name: 'ucs-summary', csv: () => csv(['source', 'n', 'min', 'q1', 'median', 'mean', 'q3', 'max'], result.ucs.map((g) => [g.name, g.stats.count, g.stats.minimum, g.stats.q1, g.stats.median, g.stats.mean, g.stats.q3, g.stats.maximum])) },
    { name: 'by-hole', csv: () => csv(['hole', 'schmidt_readings', 'schmidt_mean_r', 'schmidt_ucs_mpa', 'pli_tests', 'pli_ucs_mpa', 'lab_tests', 'lab_ucs_mpa'], result.holes.map((h) => [h.hole, h.schmidtReadings, h.schmidtMeanR, h.schmidtUcs, h.pliTests, h.pliUcs, h.labTests, h.labUcs])) },
  ]
  const hasAnySource = sources.schmidt !== undefined || sources.pointLoad !== undefined || sources.lab !== undefined
  const rowStyle = { gridTemplateColumns: 'minmax(120px, 1.4fr) repeat(7, minmax(54px, .7fr))' }

  return <div className="page domain-page domain-simple-page strength-correlation-page">
    <section className="analysis-toolbar eda-toolbar">
      <SourceSelect datasets={datasets} kind="numeric" label="Schmidt" onChange={setSource('schmidt')} value={sources.schmidt} />
      <SourceSelect datasets={datasets} kind="numeric" label="Point load Is(50)" onChange={setSource('pointLoad')} value={sources.pointLoad} />
      <SourceSelect datasets={datasets} kind="dimension" label="ISRM grade" onChange={setSource('grade')} value={sources.grade} />
      <SourceSelect datasets={datasets} kind="numeric" label="Lab UCS" onChange={setSource('lab')} value={labRef} />
      {testTypes.length > 0 ? <label className="tool-select tool-select-field"><span>Lab test</span><select onChange={(event) => setLabTestType(event.target.value)} value={testType}><option value="">All tests</option>{testTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select><ChevronDown size={14} /></label> : null}
      <NumberField label="γ (kN/m³)" onChange={(value) => setSettings({ ...effectiveSettings, unitWeightKnM3: value })} title="Unit weight used in the Schmidt → UCS conversion" value={effectiveSettings.unitWeightKnM3} />
      <NumberField label="UCS ≈ K·Is(50)" onChange={(value) => setSettings({ ...effectiveSettings, ucsFactor: value })} title="Point-load factor K (commonly 20–25)" value={effectiveSettings.ucsFactor} />
      <NumberField label="Window (m)" onChange={(value) => setSettings({ ...effectiveSettings, windowM: value })} title="Schmidt readings within ± this distance of a point-load test are averaged" value={effectiveSettings.windowM} />
    </section>

    {!hasAnySource ? <section className="panel" style={{ padding: 16 }}>Pick at least a Schmidt variable, a point-load variable or a lab UCS variable above. Schmidt and point-load data can be imported from Data → Strength.</section> : <>
      <section className="domain-review-kpis">
        <article><span>Schmidt readings</span><strong>{schmidtStats.count.toLocaleString()}</strong><small>median R {fmt(medianR, 0)} · {result.grades.length} ISRM grade{result.grades.length === 1 ? '' : 's'} matched</small></article>
        <article><span>Point-load tests</span><strong>{pliStats.count.toLocaleString()}</strong><small>{result.pairs.length} within ±{effectiveSettings.windowM} m of Schmidt · median Is(50) {fmt(pliStats.median === null ? null : pliStats.median / effectiveSettings.ucsFactor, 2)} MPa</small></article>
        <article><span>Point load vs Schmidt</span><strong>{result.spearman === null ? '—' : `ρ ${result.spearman.toFixed(2)}`}</strong><small>{result.pearson !== null ? `Pearson ${result.pearson.toFixed(2)} · n ${result.pairs.length}` : result.pairs.length < 3 ? 'needs ≥ 3 depth-matched pairs' : 'values do not vary across the pairs'}</small></article>
        <article><span>Point-load unit check</span><strong>{check === null ? '—' : check.flag === 'ok' ? 'Consistent' : check.flag === 'measured-low' ? `${fmt(check.ratio, 0)}× low` : `${fmt(1 / check.ratio, 0)}× high`}</strong><small>{check === null ? 'needs ≥ 3 pairs' : `Schmidt implies ${fmt(check.impliedIs50, 2)} MPa`}</small></article>
        <article><span>Lab UCS</span><strong>{labStats.median === null ? '—' : `${fmt(labStats.median, 0)} MPa`}</strong><small>{labStats.count} test{labStats.count === 1 ? '' : 's'} · Schmidt-derived {fmt(schmidtStats.median, 0)} MPa</small></article>
      </section>

      {result.findings.length > 0 ? <section className="panel" style={{ padding: '10px 14px', display: 'grid', gap: 6 }} aria-label="Findings">
        {result.findings.map((finding, index) => <p key={index} style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11 }}>
          <span style={{ color: finding.level === 'warn' ? c.accent : finding.level === 'ok' ? c.primary : c.muted, flex: '0 0 auto', marginTop: 1 }}>{finding.level === 'warn' ? <AlertTriangle size={14} /> : finding.level === 'ok' ? <CheckCircle2 size={14} /> : <Info size={14} />}</span>{finding.text}</p>)}
      </section> : null}

      <section className="vg-grid">
        <Card detail="Hammer rebound against the ISRM grade logged at the same depth — R should rise with grade" title="Schmidt R by logged ISRM grade">
          {result.grades.length === 0 ? <p className="domain-empty-hint">Needs a Schmidt variable and an ISRM-grade field (values like “R3 Medium strong rock”) at the same holes.</p> : <GeoEyeChart ariaLabel="Schmidt rebound by ISRM grade" exportFeature="custom" exportName="strength-schmidt-by-grade" option={gradeOption} />}
        </Card>
        <Card detail={`${labelOf(sources.pointLoad?.datasetId, sources.pointLoad?.key) || 'Is(50)'} against mean Schmidt R within ±${effectiveSettings.windowM} m · dashed line = Is(50) the Schmidt readings imply (γ ${effectiveSettings.unitWeightKnM3}, K ${effectiveSettings.ucsFactor})`} title="Point load vs Schmidt">
          {plotted.length === 0 ? <p className="domain-empty-hint">No point-load test has a Schmidt reading within the window in the same hole. Widen the window or check the hole IDs and depths.</p> : <GeoEyeChart ariaLabel="Point load against Schmidt rebound" exportFeature="custom" exportName="strength-pli-vs-schmidt" option={pairOption} />}
        </Card>
        <Card detail="Indicative UCS from each source on a log axis — Schmidt (γ-based), point load (K × Is(50)) and measured lab UCS" title="Estimated vs lab UCS">
          {ucsGroups.length === 0 ? <p className="domain-empty-hint">No strength values to compare yet.</p> : <GeoEyeChart ariaLabel="Estimated and laboratory UCS" exportFeature="custom" exportName="strength-ucs-comparison" option={ucsOption} />}
        </Card>
        <section className="eda-chart-card domain-chart-card vg-panel"><header><div><h3>By hole</h3><p>Mean R and mean estimated UCS per hole · lab tests without a hole can only be compared overall</p></div></header>
          <div className="domain-supporting-table">
            <div className="is-header" style={rowStyle}><span>Hole</span><span>Schmidt n</span><span>Mean R</span><span>Schmidt UCS</span><span>PLI n</span><span>PLI UCS</span><span>Lab n</span><span>Lab UCS</span></div>
            {result.holes.map((h) => <div key={h.hole} style={rowStyle}><strong>{h.hole}</strong><span>{h.schmidtReadings}</span><span>{fmt(h.schmidtMeanR, 1)}</span><span>{fmt(h.schmidtUcs, 0)}</span><span>{h.pliTests}</span><span>{fmt(h.pliUcs, 0)}</span><span>{h.labTests}</span><span>{fmt(h.labUcs, 0)}</span></div>)}
            {result.holes.length === 0 ? <p className="domain-empty-hint">No hole-referenced strength data.</p> : null}
          </div>
        </section>
      </section>
      <p style={{ margin: '2px 4px 0', fontSize: 10, color: c.muted }}>Schmidt → UCS uses UCS = 10^(0.00088·γ·R + 1.01) for R {SCHMIDT_VALID_RANGE.min}–{SCHMIDT_VALID_RANGE.max} (indicative, not a lab substitute — calibrate against your own UCS tests). Point load UCS ≈ K·Is(50).</p>
    </>}

    <SaveExportBar
      lineage={() => ({ sources, settings: effectiveSettings, formulas: { schmidtToUcs: 'UCS = 10^(0.00088*gamma*R + 1.01), R 10-70', pointLoadToUcs: 'UCS = K * Is50' } })}
      summary={`Strength correlation · ${result.pairs.length} PLI/Schmidt pairs · ${result.grades.length} grades`}
      tables={tables}
    />
  </div>
}
