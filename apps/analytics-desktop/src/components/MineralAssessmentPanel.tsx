import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Box, GitBranch, Play, Plus, Save, Trash2 } from 'lucide-react'
import { MINERAL_COMPONENTS, MINERAL_CRITERIA, MINERAL_RULE_VERSION, MINERAL_SYSTEM_MODELS } from '../analysis/mineralSystemModels.js'
import { assessmentIsCurrent, assessSourceSensitivity, investigationPriorities, suggestEvidenceBindings, type EvidenceBinding, type EvidenceMatch, type MineralAssessmentConfiguration, type MineralAssessmentInterval, type MineralAssessmentRun } from '../analysis/mineralSystems.js'
import type { EdaDataset } from '../data/edaTypes.js'
import { edaDatasetKind, useProjectEdaDatasets } from '../data/liveEda.js'
import { persistMineralAssessment, readMineralAssessment } from '../data/mineralAssessmentStore.js'
import { barGraphImage } from '../data/analysisGraphImages.js'
import { saveAnalysisResultPackage } from '../data/analysisResultStore.js'
import { recordAnalysisTemplateSave, resolveAnalysisTemplateVersion } from '../data/analysisSaveStore.js'
import { saveSpatialViewRequest } from '../data/spatialViewStore.js'
import { usePersistentState } from '../state/persistentState.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'
import { useGeoEyeSelection } from '../state/SelectionContext.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { useDurableAction } from '../state/useDurableAction.js'
import type { SectionId } from '../types.js'

type AssessmentView = 'mapping' | 'assessment' | 'sensitivity' | 'investigation'
const viewLabels: Array<[AssessmentView, string]> = [['mapping', 'Evidence mapping'], ['assessment', 'Assessment'], ['sensitivity', 'Sensitivity analysis'], ['investigation', 'Investigation priorities']]
const stateLabels = { supports: 'Support', contradicts: 'Contradiction', conflicting: 'Conflicting', 'not-observed': 'Not observed' }
const percentage = (value: number | null | undefined) => value == null ? '—' : value.toFixed(1)

export function MineralAssessmentWorkspace({ onNavigate }: { onNavigate: (section: SectionId) => void }) {
  const query = useProjectEdaDatasets()
  if (query.isPending) return <div className="eda-state panel">Opening mineral assessment inputs…</div>
  if (query.isError) return <div className="eda-state panel" role="alert">The analytical datasets could not be opened.</div>
  return <MineralAssessmentPanel datasets={query.data ?? []} onNavigate={onNavigate} />
}

export function MineralAssessmentPanel({ datasets, onNavigate }: { datasets: readonly EdaDataset[]; onNavigate: (section: SectionId) => void }) {
  const storage = useProjectStorage()
  const workspace = useDataPoolWorkspace()
  const durable = useDurableAction()
  const { selectedIds, replaceSelection } = useGeoEyeSelection()
  const candidates = useMemo(() => datasets.filter(d => edaDatasetKind(d) !== 'integrated' && edaDatasetKind(d) !== 'drillholes'), [datasets])
  const [baseId, setBaseId] = usePersistentState('mineralAssessment.baseId', '')
  const [sourceIds, setSourceIds] = usePersistentState<string[] | null>('mineralAssessment.sourceIds', null)
  const [bindings, setBindings] = usePersistentState<EvidenceBinding[]>('mineralAssessment.bindings', [])
  const [view, setView] = usePersistentState<AssessmentView>('mineralAssessment.view', 'mapping')
  const [systemId, setSystemId] = usePersistentState('mineralAssessment.systemId', 'porphyry')
  const [selectionOnly, setSelectionOnly] = useState(false)
  const [mappingSearch, setMappingSearch] = useState('')
  const [newCriterion, setNewCriterion] = useState('cu')
  const [excludedSources, setExcludedSources] = useState<string[]>([])
  const [run, setRun] = useState(() => readMineralAssessment(storage))
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const base = candidates.find(d => d.id === baseId) ?? candidates.find(d => edaDatasetKind(d) === 'laboratory') ?? candidates[0]
  const sources = useMemo(() => candidates.filter(d => sourceIds === null || sourceIds.includes(d.id)), [candidates, sourceIds])
  const effectiveBindings = useMemo(() => bindings.filter(b => sources.some(d => d.id === b.datasetId)), [bindings, sources])
  const selectedBaseIds = useMemo(() => {
    const selection = new Set(selectedIds)
    return base?.observations.filter(row => (row.sourceObservationIds ?? [row.sourceObservationId]).some(id => selection.has(id))).map(row => row.id) ?? []
  }, [base, selectedIds])
  const configuration: MineralAssessmentConfiguration = { baseDatasetId: base?.id ?? '', bindings: effectiveBindings, ...(selectionOnly ? { baseObservationIds: selectedBaseIds } : {}) }
  const signature = JSON.stringify(configuration)
  const current = run !== null && assessmentIsCurrent(run, datasets) && JSON.stringify(run.configuration) === signature
  const assessment = run?.systems.find(s => s.systemId === systemId) ?? run?.systems[0]
  const selectedModel = MINERAL_SYSTEM_MODELS.find(m => m.id === assessment?.systemId)
  const sensitivity = useMemo(() => run === null ? [] : assessSourceSensitivity(run, excludedSources), [run, excludedSources])
  const priorities = run === null || assessment === undefined ? [] : investigationPriorities(run, assessment.systemId)
  const auditMatches = useMemo(() => {
    const matches = new Map<string, Array<{ interval: MineralAssessmentInterval; match: EvidenceMatch }>>()
    if (run === null) return matches
    run.intervals.forEach(interval => interval.matches.forEach(match => {
      const rows = matches.get(match.criterionId) ?? []
      if (rows.length < 100) rows.push({ interval, match })
      matches.set(match.criterionId, rows)
    }))
    return matches
  }, [run])
  useEffect(() => () => workerRef.current?.terminate(), [])

  if (base === undefined) return <section className="panel eda-state">Import assay, XRF, spectral, or geological interval data to assess mineral-system evidence.</section>

  const updateBinding = (id: string, patch: Partial<EvidenceBinding>) => setBindings(currentBindings => currentBindings.map(b => b.id === id ? { ...b, ...patch } : b))
  const startAssessment = () => {
    workerRef.current?.terminate()
    setPending(true); setNotice(null); setSaved(null)
    const requestId = crypto.randomUUID()
    try {
      const worker = new Worker(new URL('../analysis/mineralSystems.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      worker.onmessage = (event: MessageEvent<{ requestId: string; result?: MineralAssessmentRun; error?: string }>) => {
        if (event.data.requestId !== requestId) return
        worker.terminate(); workerRef.current = null; setPending(false)
        const result = event.data.result
        if (!result) { setNotice(event.data.error ?? 'Assessment failed.'); return }
        setRun(result); setView('assessment'); setExcludedSources([])
        setSystemId(result.systems[0]?.systemId ?? 'porphyry')
        void persistMineralAssessment(storage, result).catch(error => setNotice(`Assessment computed, but workspace persistence failed: ${String(error)}`))
      }
      worker.onerror = () => { worker.terminate(); workerRef.current = null; setPending(false); setNotice('The assessment worker failed. Retry after checking input data.') }
      worker.postMessage({ datasets: candidates, configuration, requestId })
    } catch (error) { setPending(false); setNotice(`Unable to start assessment: ${String(error)}`) }
  }
  const suggestMappings = () => {
    const suggested = suggestEvidenceBindings(sources)
    const identities = new Set(bindings.map(b => `${b.criterionId}:${b.datasetId}:${b.fieldKey}:${b.polarity}`))
    const additions = suggested.filter(b => !identities.has(`${b.criterionId}:${b.datasetId}:${b.fieldKey}:${b.polarity}`))
    setBindings(existing => [...existing, ...additions])
    setNotice(`${additions.length} mappings suggested. Review predicates, screening thresholds, and reliability before running.`)
  }
  const addMapping = () => {
    const criterion = MINERAL_CRITERIA.find(c => c.id === newCriterion)!
    const source = sources[0] ?? base
    setBindings(existing => [...existing, { id: crypto.randomUUID(), criterionId: criterion.id, datasetId: source.id, fieldKey: '',
      operator: criterion.element === undefined ? 'contains' : 'gte', threshold: criterion.threshold ?? 0,
      unit: criterion.element === undefined ? 'native' : 'ppm', terms: [...criterion.tokens ?? []], polarity: 'support', reliability: 0.7 }])
  }
  const linkedIds = (criterionId?: string) => run?.intervals.flatMap(interval => criterionId === undefined
    ? interval.matches.some(m => selectedModel?.criteria.some(c => c.id === m.criterionId)) ? interval.sourceObservationIds : []
    : interval.matches.some(m => m.criterionId === criterionId) ? interval.sourceObservationIds : []) ?? []
  const open3d = () => {
    if (run === null || assessment === undefined || !current) return
    const ids = linkedIds()
    // Keep evidence colours visible; selecting every interval would tint the entire scene.
    replaceSelection([])
    saveSpatialViewRequest(storage, { colorBy: 'mineral.fit', datasetId: run.baseDatasetId, label: `${assessment.label} · mineral evidence`, sourceModule: 'multivariate', sourceObservationIds: ids })
    onNavigate('view-3d')
  }
  const saveResult = (newVersion: boolean) => void durable.perform(async () => {
    if (run === null || !current || workspace.project === null) return
    const templateId = `mineral-assessment:${run.baseDatasetId}`
    const templateVersion = resolveAnalysisTemplateVersion(storage, { templateId, fallbackVersion: 1, mode: newVersion ? 'new-version' : 'overwrite' })
    const analysisFileId = crypto.randomUUID(), savedAt = new Date().toISOString()
    await persistMineralAssessment(storage, run)
    await saveAnalysisResultPackage(storage, { analysisFileId, analysisPayload: { kind: 'mineral-system-assessment', run, selectedSystemId: assessment?.systemId },
      boreholeIds: run.intervals.map(row => row.holeId), createdAt: savedAt, derivedFieldKeys: ['mineral.fit', 'mineral.coverage'],
      feature: 'multivariate', graphs: [barGraphImage('mineral-evidence-fit', 'Mineral-system evidence fit · heuristic index', run.systems.filter(s => s.fit !== null).map(s => ({ label: s.label, value: s.fit! })))],
      inputName: 'Mineral-system assessment', projectId: workspace.project.id, runId: run.runId, sourceFileName: `${base.name}.json`,
      sourceObservationIds: run.intervals.flatMap(row => row.sourceObservationIds), templateId, templateVersion, tenantId: workspace.project.organizationId ?? '_unassigned' })
    recordAnalysisTemplateSave(storage, { analysisFileId, derivedFieldKeys: ['mineral.fit', 'mineral.coverage'], feature: 'multivariate', runId: run.runId, savedAt, templateId, templateVersion })
    await storage.flush?.()
    setSaved(`Assessment and ranking graph saved · v${templateVersion}`)
  })
  const filteredBindings = effectiveBindings.filter(b => `${MINERAL_CRITERIA.find(c => c.id === b.criterionId)?.label} ${b.datasetId} ${b.fieldKey}`.toLowerCase().includes(mappingSearch.toLowerCase()))

  return <div className="mineral-assessment">
    <div className="analysis-toolbar eda-toolbar mineral-toolbar">
      <label className="tool-select tool-select-field"><span>Interval support</span><select aria-label="Mineral assessment interval support" value={base.id} onChange={event => setBaseId(event.target.value)}>{candidates.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
      <label className="mineral-subset"><input type="checkbox" checked={selectionOnly} onChange={event => setSelectionOnly(event.target.checked)} /> Linked selection only ({selectedBaseIds.length})</label>
      <button className="primary-button" type="button" disabled={pending || effectiveBindings.length === 0 || (selectionOnly && selectedBaseIds.length === 0)} onClick={startAssessment}><Play size={13} />{pending ? 'Assessing…' : 'Run assessment'}</button>
      <button className="button button-secondary" type="button" disabled={!current || assessment?.fit == null} onClick={open3d}><Box size={14} /> Evidence in 3D</button>
    </div>
    <section className="panel mineral-source-panel"><header><strong>Evidence inputs</strong><span>Match by drillhole and depth; preserve each method and source row.</span></header><div className="mineral-source-options">{candidates.map(d => <label key={d.id}><input type="checkbox" checked={sources.some(s => s.id === d.id)} onChange={event => setSourceIds(event.target.checked ? [...sources.map(s => s.id), d.id] : sources.filter(s => s.id !== d.id).map(s => s.id))} /><span>{d.name}<small>{d.observations.length.toLocaleString()} observations · {edaDatasetKind(d)}</small></span></label>)}</div></section>
    <div className="eda-view-tabs eda-tool-tabs" role="tablist" aria-label="Mineral assessment views">{viewLabels.map(([id, label]) => <button id={`mineral-tab-${id}`} aria-controls={`mineral-view-${id}`} aria-selected={view === id} className={view === id ? 'is-active' : ''} role="tab" type="button" key={id} onClick={() => setView(id)}>{label}</button>)}</div>
    {notice || durable.notice ? <p className="pool-live-note" role="status">{notice ?? durable.notice}</p> : null}
    {run !== null && !current ? <p className="pool-live-note" role="status">Inputs, mappings, or selection have changed. Results below belong to the previous run. Run assessment again before saving or opening evidence in 3D.</p> : null}
    <div id={`mineral-view-${view}`} role="tabpanel" aria-labelledby={`mineral-tab-${view}`}>
    {view === 'mapping' ? <section className="panel mineral-mapping">
      <header><div><h2>Evidence mapping</h2><p>Define how analytical fields support or contradict geological criteria. Suggested thresholds are screening values in ppm, requiring project review.</p></div><button className="button button-secondary" type="button" onClick={suggestMappings}>Suggest mappings</button></header>
      <div className="mineral-mapping-controls"><label>Criterion<select aria-label="New evidence criterion" value={newCriterion} onChange={event => setNewCriterion(event.target.value)}>{MINERAL_CRITERIA.map(c => <option value={c.id} key={c.id}>{c.component} · {c.label}</option>)}</select></label><button className="button button-secondary" type="button" onClick={addMapping}><Plus size={14} /> Add mapping</button><label>Filter mappings<input aria-label="Filter evidence mappings" value={mappingSearch} onChange={event => setMappingSearch(event.target.value)} /></label></div>
      <div className="mineral-table-scroll"><table className="mineral-table"><thead><tr><th>Criterion</th><th>Dataset / field</th><th>Predicate</th><th>Evidence / reliability</th><th><span className="sr-only">Remove</span></th></tr></thead><tbody>{filteredBindings.map(binding => {
        const definition = MINERAL_CRITERIA.find(c => c.id === binding.criterionId)
        const source = candidates.find(d => d.id === binding.datasetId)
        const fields = [...new Map([...(source?.variables.map(v => [v.key, `${v.label}${v.unit ? ` (${v.unit})` : ''}`] as const) ?? []), ...(source?.dimensions.map(d => [d.key, d.label] as const) ?? [])]).entries()]
        const categorical = binding.operator === 'contains' || binding.operator === 'equals'
        return <tr key={binding.id}><td><strong>{definition?.label ?? binding.criterionId}</strong><small>{definition?.component} · {definition?.group}</small></td><td><select aria-label={`Dataset for ${binding.id}`} value={binding.datasetId} onChange={event => updateBinding(binding.id, { datasetId: event.target.value, fieldKey: '' })}>{sources.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select><select aria-label={`Field for ${binding.id}`} value={binding.fieldKey} onChange={event => updateBinding(binding.id, { fieldKey: event.target.value })}><option value="">Choose a field</option>{fields.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></td><td><select aria-label={`Operator for ${binding.id}`} value={binding.operator} onChange={event => updateBinding(binding.id, { operator: event.target.value as EvidenceBinding['operator'] })}><option value="gte">At least</option><option value="lte">At most</option><option value="contains">Contains phrase</option><option value="equals">Equals phrase</option></select>{categorical ? <input aria-label={`Phrases for ${binding.id}`} value={binding.terms.join(', ')} placeholder="Comma-separated literal phrases" onChange={event => updateBinding(binding.id, { terms: event.target.value.split(',').map(t => t.trim()) })} /> : <div className="mineral-number-unit"><input aria-label={`Threshold for ${binding.id}`} type="number" min="0" step="any" value={Number.isFinite(binding.threshold) ? binding.threshold : ''} onChange={event => updateBinding(binding.id, { threshold: event.target.value === '' ? Number.NaN : Number(event.target.value) })} /><select aria-label={`Threshold unit for ${binding.id}`} value={binding.unit} onChange={event => updateBinding(binding.id, { unit: event.target.value as EvidenceBinding['unit'] })}><option value="ppm">ppm (convert source)</option><option value="native">Source units</option></select></div>}</td><td><select aria-label={`Polarity for ${binding.id}`} value={binding.polarity} onChange={event => updateBinding(binding.id, { polarity: event.target.value as EvidenceBinding['polarity'] })}><option value="support">Support</option><option value="contradict">Contradiction</option></select><label className="mineral-reliability">Reliability<input aria-label={`Reliability for ${binding.id}`} type="number" min="0.01" max="1" step="0.05" value={binding.reliability} onChange={event => updateBinding(binding.id, { reliability: Number(event.target.value) })} /></label><details className="mineral-quality-gate"><summary>Quality filter</summary><select aria-label={`Quality field for ${binding.id}`} value={binding.qualityFieldKey ?? ''} onChange={event => updateBinding(binding.id, { qualityFieldKey: event.target.value, minimumQuality: binding.minimumQuality ?? 0 })}><option value="">No quality filter</option>{source?.variables.filter(variable => variable.dataType !== 'category').map(variable => <option key={variable.key} value={variable.key}>{variable.label}{variable.unit ? ` (${variable.unit})` : ''}</option>)}</select>{binding.qualityFieldKey ? <label>Minimum quality (source units)<input aria-label={`Minimum quality for ${binding.id}`} type="number" step="any" value={binding.minimumQuality ?? 0} onChange={event => updateBinding(binding.id, { minimumQuality: event.target.value === '' ? Number.NaN : Number(event.target.value) })} /></label> : null}</details></td><td><button aria-label={`Remove mapping ${binding.id}`} className="button button-secondary" type="button" onClick={() => setBindings(items => items.filter(b => b.id !== binding.id))}><Trash2 size={13} /></button></td></tr>
      })}</tbody></table></div>
      {filteredBindings.length === 0 ? <p className="eda-state">No mappings. Suggest mappings or choose a criterion and add a field.</p> : null}
      <p className="mineral-method-note">Blank values and predicates that do not match remain unobserved. To encode tested absence, add an explicit contradiction mapping to the recorded test result. Mineral names are literal phrases; numerical spectral scores require an explicit threshold in source units.</p>
    </section> : null}
    {view !== 'mapping' && run === null ? <section className="panel eda-state">Configure the evidence fields and run an assessment to compare mineral systems.</section> : null}
    {view === 'assessment' && run !== null ? <>
      <section className="panel mineral-ranking"><header><div><h2>Mineral-system assessment</h2><p>{run.intervals.length.toLocaleString()} assessed supports · {run.snapshots.length} datasets · {run.ruleVersion}</p></div><span>Heuristic fit index; not discovery probability</span></header>
        <div className="mineral-table-scroll"><table className="mineral-table"><thead><tr><th>Mineral system</th><th>Fit / 100</th><th>Criteria observed</th><th>Evidence reliability</th>{MINERAL_COMPONENTS.map(c => <th key={c} title="Reliability-weighted coverage of component criteria">{c}</th>)}</tr></thead><tbody>{run.systems.map(system => <tr className={assessment?.systemId === system.systemId ? 'is-selected' : ''} key={system.systemId}><td><button className="mineral-system-button" aria-pressed={assessment?.systemId === system.systemId} type="button" onClick={() => setSystemId(system.systemId)}>{system.label}</button></td><td><strong>{percentage(system.fit)}</strong></td><td>{percentage(system.coverage)}%</td><td>{percentage(system.reliability)}%</td>{MINERAL_COMPONENTS.map(c => <td key={c}><span className="mineral-coverage" style={{ '--coverage': `${system.components[c]}%` } as CSSProperties}>{system.components[c].toFixed(0)}%</span></td>)}</tr>)}</tbody></table></div>
      </section>
      {assessment === undefined ? null : <section className="panel mineral-audit"><header><div><h2>{assessment.label} · evidence audit</h2><p>Inspect the observed values and select their intervals across analytical views.</p></div><button className="button button-secondary" type="button" onClick={() => replaceSelection(linkedIds())}>Select evidence intervals</button></header>
        <div className="mineral-table-scroll"><table className="mineral-table"><thead><tr><th>Criterion</th><th>State</th><th>Weighted evidence</th><th>Source observations</th></tr></thead><tbody>{assessment.contributions.map(item => {
          const criterion = MINERAL_CRITERIA.find(c => c.id === item.criterionId)!
          const summary = run.evidence.find(e => e.criterionId === item.criterionId)!
          return <tr key={item.criterionId}><td><strong>{criterion.label}</strong><small>{criterion.component} · weight {item.weight}</small></td><td><span className={`mineral-state is-${item.state}`}>{stateLabels[item.state]}</span></td><td>{item.signed > 0 ? '+' : ''}{item.signed.toFixed(2)}<small>Before correlated-group cap</small></td><td><details><summary>{summary.sourceObservationIds.length} source IDs · {summary.matchCount} linked matches</summary><button className="button button-secondary" type="button" disabled={summary.matchCount === 0} onClick={() => replaceSelection(linkedIds(item.criterionId))}>Select linked intervals</button>{(auditMatches.get(item.criterionId) ?? []).map(({ interval, match }, index) => <div className="mineral-audit-row" key={`${match.bindingId}:${interval.observationId}:${index}`}><strong>{interval.holeId} · {interval.depthFrom}–{interval.depthTo} m</strong><span>{run.snapshots.find(s => s.datasetId === match.datasetId)?.name} · {match.fieldKey}: {match.value}{match.comparedValue !== match.value ? ` → ${match.comparedValue} ppm` : ''}</span><small>{match.polarity} · reliability {match.reliability}{match.quality === undefined ? null : ` · ${match.quality.fieldKey}: ${match.quality.value} ≥ ${match.quality.minimum}`} · {match.sourceObservationIds.join(', ')}</small></div>)}{summary.matchCount > 100 ? <small>Showing first 100 matches. Complete lineage is retained in the saved assessment.</small> : null}</details></td></tr>
        })}</tbody></table></div>
      </section>}
    </> : null}
    {view === 'sensitivity' && run !== null ? <section className="panel mineral-sensitivity"><header><div><h2>Source sensitivity</h2><p>Exclude a method to measure its influence on the assessment. The observed result stays unchanged.</p></div></header><div className="mineral-source-options">{run.snapshots.map(snapshot => <label key={snapshot.datasetId}><input type="checkbox" checked={excludedSources.includes(snapshot.datasetId)} onChange={event => setExcludedSources(ids => event.target.checked ? [...ids, snapshot.datasetId] : ids.filter(id => id !== snapshot.datasetId))} /> Exclude {snapshot.name}</label>)}</div><div className="mineral-table-scroll"><table className="mineral-table"><thead><tr><th>Mineral system</th><th>Observed fit</th><th>Sensitivity fit</th><th>Change</th><th>Coverage</th></tr></thead><tbody>{sensitivity.map(system => { const observed = run.systems.find(s => s.systemId === system.systemId)!; return <tr key={system.systemId}><td>{system.label}</td><td>{percentage(observed.fit)}</td><td>{percentage(system.fit)}</td><td>{observed.fit === null || system.fit === null ? '—' : (system.fit - observed.fit).toFixed(1)}</td><td>{percentage(system.coverage)}%</td></tr> })}</tbody></table></div></section> : null}
    {view === 'investigation' && run !== null ? <section className="panel mineral-investigation"><header><div><h2>Investigation priorities · {assessment?.label}</h2><p>Missing, contradictory, and conflicting criteria ranked by diagnostic weight and relative effort. Priorities are planning proxies.</p></div><select aria-label="Investigation mineral system" value={assessment?.systemId ?? ''} onChange={event => setSystemId(event.target.value)}>{run.systems.map(s => <option key={s.systemId} value={s.systemId}>{s.label}</option>)}</select></header><div className="mineral-table-scroll"><table className="mineral-table"><thead><tr><th>Criterion</th><th>Evidence state</th><th>Recommended investigation</th><th>Effort / 5</th><th>Priority</th></tr></thead><tbody>{priorities.map(c => <tr key={c.id}><td><strong>{c.label}</strong><small>{c.component}</small></td><td>{stateLabels[c.state]}</td><td>{c.work}</td><td>{c.cost}</td><td>{c.priority.toFixed(2)}</td></tr>)}</tbody></table></div>{priorities.length === 0 ? <p>All configured criteria have supporting evidence. Validate spatial and temporal relationships before interpreting a genetic association.</p> : null}</section> : null}
    </div>
    {run === null ? null : <section className="panel mineral-provenance"><div><GitBranch size={15} /><span><strong>Run provenance</strong><small>{run.runId} · {new Date(run.createdAt).toLocaleString()} · {run.excludedLocationCount} invalid supports excluded</small></span></div><details><summary>Method and input audit ({run.issues.length} notices)</summary><p>Fit = nonnegative signed, reliability-weighted evidence divided by configured group capacity. Each component / correlated group is capped at its largest criterion weight. Repeated rows use maximum reliability per criterion. Coverage measures observed criteria; component values show reliability-weighted coverage. Indices do not sum to 100%.</p><p>Starter signatures and weights require geological review. No resource estimate, interpolated mineralized volume, or calibrated probability is produced. Closest support matching uses the greatest interval overlap, then the shallowest / first source row; it does not composite multiple readings.</p><ul>{run.issues.map(issue => <li key={issue}>{issue}</li>)}</ul><p>Rule version: {MINERAL_RULE_VERSION}. Geological model references: <a href="https://pubs.usgs.gov/bul/b1693/" target="_blank" rel="noreferrer">USGS Mineral Deposit Models</a>{selectedModel === undefined ? null : <> · <a href={selectedModel.reference} target="_blank" rel="noreferrer">Selected model reference</a></>}.</p></details><div className="mineral-save-actions"><span role="status">{saved}</span><button className="button button-secondary" type="button" disabled={!current || workspace.project === null || run.evidence.every(e => e.matchCount === 0)} onClick={() => saveResult(true)}>Save As…</button><button className="button button-accent" type="button" disabled={!current || workspace.project === null || run.evidence.every(e => e.matchCount === 0)} onClick={() => saveResult(false)}><Save size={14} /> Save assessment</button></div></section>}
  </div>
}
