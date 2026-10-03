import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  BarChart3,
  Box,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Database,
  ExternalLink,
  History,
  Layers3,
  Map as MapIcon,
  RefreshCw,
  Save,
  Table2,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  buildRmr76SourceSignature,
  calculateRmr76Intervals,
  InputResolver,
  RMR76_METHOD_DEFINITION,
  summarizeInputReadiness,
  type InputAvailability,
  type Rmr76CalculationRun,
  type Rmr76CanonicalInputKey,
  type Rmr76IntervalResult,
} from '../analysis/geotechnicalWorkflow.js'
import { GEOTECHNICAL_REFERENCES } from '../analysis/geotechnical.js'
import {
  currentAnalysisTemplateVersion,
  recordAnalysisTemplateSave,
  resolveAnalysisTemplateVersion,
} from '../data/analysisSaveStore.js'
import { barGraphImage } from '../data/analysisGraphImages.js'
import { saveAnalysisResultPackage } from '../data/analysisResultStore.js'
import {
  buildSavedRmr76Run,
  readGeotechnicalDerivedDocument,
  saveRmr76DerivedFields,
} from '../data/geotechnicalDerivedStore.js'
import { formatInterval, latestRmrDataset, rmrDatasets } from '../data/geotechnicalDemo.js'
import { saveSpatialViewRequest } from '../data/spatialViewStore.js'
import type { SectionId } from '../types.js'
import { usePersistentState } from '../state/persistentState.js'

type ClassificationId = 'rmr76' | 'rmr89' | 'mrmr' | 'q-system'
type DepthRange = 'all' | 'shallow' | 'deep'
type DetailTab = 'method' | 'mapping' | 'references' | 'history'
type ResultTab = 'downhole' | 'table' | 'components'

interface GeotechnicalPageProps {
  onNavigate: (section: SectionId) => void
}

const classifications: ReadonlyArray<{ id: ClassificationId; label: string; method: string; ready: boolean }> = [
  { id: 'rmr76', label: 'RMR76', method: 'Bieniawski 1976', ready: true },
  { id: 'rmr89', label: 'RMR89', method: 'Bieniawski 1989', ready: false },
  { id: 'mrmr', label: 'MRMR', method: 'Laubscher', ready: false },
  { id: 'q-system', label: 'Q-System', method: 'NGI', ready: false },
]

const availabilityDisplay: Record<InputAvailability, { label: string; symbol: string }> = {
  direct: { label: 'Direct', symbol: '✓' },
  derived: { label: 'Derived', symbol: '◇' },
  fallback: { label: 'Fallback', symbol: '△' },
  missing: { label: 'Missing', symbol: '!' },
}

const componentLabels = {
  groundwater: 'Groundwater',
  jointCondition: 'Joint condition',
  jointSpacing: 'Joint spacing',
  orientation: 'Orientation adjustment',
  rqd: 'RQD',
  strength: 'Strength',
} as const

function makeRunId(methodId: string) {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${methodId}-${Date.now().toString(36)}`
}

function classCode(classification: string | null | undefined) {
  return classification?.match(/^Class\s+(I{1,3}|IV|V)/)?.[1] ?? '—'
}

function formatScore(value: number | null) {
  return value === null ? '—' : Number.isInteger(value) ? value.toString() : value.toFixed(1)
}

function statusText(result: Rmr76IntervalResult) {
  if (result.status === 'excluded') return 'Excluded'
  if (result.status === 'missing') return 'Missing'
  return 'Valid'
}

function templateVersionFromId(templateId: string) {
  return Number(templateId.match(/\.v(\d+)$/)?.[1] ?? 1)
}

function scoreFor(result: Rmr76IntervalResult, key: keyof typeof componentLabels) {
  const calculation = result.calculation
  if (calculation === null) return null
  if (key === 'orientation') return calculation.orientationAdjustment
  return calculation.scores[key]
}

function missingReason(key: Rmr76CanonicalInputKey) {
  return `${RMR76_METHOD_DEFINITION.requiredInputs.find((input) => input.key === key)?.label ?? key} unavailable`
}

export function GeotechnicalPage({ onNavigate }: GeotechnicalPageProps) {
  const queryClient = useQueryClient()
  const [classificationId, setClassificationId] = usePersistentState<ClassificationId>('geotechnical.classificationId', 'rmr76')
  const [snapshotId, setSnapshotId] = usePersistentState('geotechnical.snapshotId', '43')
  const [refreshChecked, setRefreshChecked] = usePersistentState('geotechnical.refreshChecked', false)
  const [holeId, setHoleId] = usePersistentState('geotechnical.holeId', 'all')
  const [depthRange, setDepthRange] = usePersistentState<DepthRange>('geotechnical.depthRange', 'all')
  const [run, setRun] = usePersistentState<Rmr76CalculationRun | null>('geotechnical.run', null)
  const [savedRunId, setSavedRunId] = usePersistentState<string | null>('geotechnical.savedRunId', null)
  const [savedScenarioName, setSavedScenarioName] = usePersistentState('geotechnical.savedScenarioName', 'Geotechnical logging')
  const [templateVersion, setTemplateVersion] = useState(() => {
    const initialDataset = rmrDatasets[0]
    if (initialDataset === undefined) return 1
    return currentAnalysisTemplateVersion(
      window.localStorage,
      initialDataset.targetTemplateId,
      templateVersionFromId(initialDataset.targetTemplateId),
    )
  })
  const [selectedIntervalId, setSelectedIntervalId] = usePersistentState<string | null>('geotechnical.selectedIntervalId', null)
  const [includeComponents, setIncludeComponents] = usePersistentState('geotechnical.includeComponents', false)
  const [detailTab, setDetailTab] = usePersistentState<DetailTab>('geotechnical.detailTab', 'method')
  const [resultTab, setResultTab] = usePersistentState<ResultTab>('geotechnical.resultTab', 'downhole')
  const [sourceDetailKey, setSourceDetailKey] = usePersistentState<Rmr76CanonicalInputKey | null>('geotechnical.sourceDetailKey', null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [savedDocument, setSavedDocument] = useState(() => readGeotechnicalDerivedDocument(window.localStorage))

  const snapshotOptions = useMemo(() => refreshChecked
    ? [latestRmrDataset, ...rmrDatasets]
    : snapshotId === latestRmrDataset.snapshotId ? [latestRmrDataset, ...rmrDatasets] : rmrDatasets, [refreshChecked, snapshotId])
  const dataset = snapshotOptions.find((item) => item.snapshotId === snapshotId) ?? rmrDatasets[0]
  const classification = classifications.find((item) => item.id === classificationId) ?? classifications[0]!
  const selectedSourceIds = useMemo(() => new Set(dataset?.sources.map((source) => source.id) ?? []), [dataset])
  const holes = useMemo(() => [...new Set(dataset?.intervals.map((interval) => interval.holeId) ?? [])].sort(), [dataset])
  const scopedIntervals = useMemo(() => dataset?.intervals.filter((interval) => {
    if (holeId !== 'all' && interval.holeId !== holeId) return false
    if (depthRange === 'shallow') return interval.depthFrom < 60
    if (depthRange === 'deep') return interval.depthTo > 60
    return true
  }) ?? [], [dataset, depthRange, holeId])
  const sourceSignature = useMemo(
    () => buildRmr76SourceSignature(scopedIntervals, selectedSourceIds),
    [scopedIntervals, selectedSourceIds],
  )
  const readiness = useMemo(
    () => classification.ready ? summarizeInputReadiness(scopedIntervals, selectedSourceIds) : [],
    [classification.ready, scopedIntervals, selectedSourceIds],
  )
  const availableInputCount = readiness.filter((item) => item.availability !== 'missing').length
  const stale = run !== null && (run.sourceSignature !== sourceSignature || run.snapshotId !== dataset?.snapshotId)
  const isSaved = run !== null && savedRunId === run.runId && !stale
  const selectedResult = run?.intervals.find((interval) => interval.id === selectedIntervalId)
    ?? run?.intervals[0]
    ?? null
  const groupedResults = useMemo(() => {
    const groups = new Map<string, Rmr76IntervalResult[]>()
    for (const interval of run?.intervals ?? []) groups.set(interval.holeId, [...(groups.get(interval.holeId) ?? []), interval])
    return [...groups.entries()]
  }, [run])
  const resolver = useMemo(() => new InputResolver(), [])
  const sourceDetail = sourceDetailKey === null ? null : scopedIntervals
    .map((interval) => resolver.resolve(interval, selectedSourceIds).inputs[sourceDetailKey])
    .find((resolved) => resolved.availability !== 'missing')
    ?? null

  if (dataset === undefined) return null

  const changeClassification = (next: ClassificationId) => {
    setClassificationId(next)
    setRun(null)
    setSavedRunId(null)
    setSelectedIntervalId(null)
    setSourceDetailKey(null)
  }

  const calculate = () => {
    if (!classification.ready) return
    const next = calculateRmr76Intervals(scopedIntervals, selectedSourceIds, makeRunId(classificationId), new Date().toISOString(), dataset.snapshotId)
    setRun(next)
    setSavedRunId(null)
    setSelectedIntervalId(next.intervals[0]?.id ?? null)
    setResultTab('downhole')
  }

  const save = (createVersion: boolean) => {
    if (run === null || stale || run.summary.valid === 0) return
    const nextVersion = resolveAnalysisTemplateVersion(window.localStorage, {
      fallbackVersion: templateVersionFromId(dataset.targetTemplateId),
      mode: createVersion ? 'new-version' : 'overwrite',
      templateId: dataset.targetTemplateId,
    })
    const savedAt = new Date().toISOString()
    const versionLabel = `Geotechnical logging v${nextVersion}`
    const analysisFileId = `geotechnical/${dataset.targetTemplateId}/v${nextVersion}.rmr76.json`
    const saved = buildSavedRmr76Run(run, dataset.targetTemplateId, savedAt, includeComponents, {
      scenarioId: `${dataset.targetTemplateId}:v${nextVersion}`,
      scenarioName: versionLabel,
    })
    const document = saveRmr76DerivedFields(window.localStorage, saved)
    recordAnalysisTemplateSave(window.localStorage, {
      analysisFileId,
      derivedFieldKeys: saved.fieldDefinitions.map((field) => field.key),
      feature: 'geotechnical',
      runId: run.runId,
      savedAt,
      templateId: dataset.targetTemplateId,
      templateVersion: nextVersion,
    })
    const boreholeIds = [...new Set(saved.intervals.map((interval) => interval.holeId))]
    const downholeGraphs = boreholeIds.map((boreholeId) => barGraphImage(
      'rmr76-downhole',
      `${boreholeId} · RMR76 downhole`,
      saved.intervals
        .filter((interval) => interval.holeId === boreholeId)
        .map((interval) => ({ label: `${interval.depthFrom.toFixed(1)}–${interval.depthTo.toFixed(1)} m`, value: interval.rmr76 })),
      boreholeId,
    ))
    const classCounts = Object.entries(run.summary.classCounts).map(([label, value]) => ({ label, value }))
    saveAnalysisResultPackage(window.localStorage, {
      analysisFileId,
      analysisPayload: saved,
      boreholeIds,
      createdAt: savedAt,
      derivedFieldKeys: saved.fieldDefinitions.map((field) => field.key),
      feature: 'geotechnical',
      graphs: [...downholeGraphs, barGraphImage('rmr76-class-distribution', 'RMR76 class distribution', classCounts)],
      inputName: `rmr76-${holeId}-${depthRange}${includeComponents ? '-components' : ''}`,
      projectId: 'Oyu Ridge',
      runId: run.runId,
      sourceFileName: `${dataset.id}.json`,
      sourceObservationIds: saved.intervals.flatMap((interval) => interval.sourceLineage.map((lineage) => lineage.observationId)),
      templateId: dataset.targetTemplateId,
      templateVersion: nextVersion,
      tenantId: 'GeoEye Demo',
    })
    setSavedDocument(document)
    setSavedRunId(run.runId)
    setSavedScenarioName(versionLabel)
    setTemplateVersion(nextVersion)
    setSaveAsOpen(false)
    void queryClient.invalidateQueries({ queryKey: ['eda-datasets'] })
  }

  const chooseStatus = (status: Rmr76IntervalResult['status']) => {
    const match = run?.intervals.find((interval) => interval.status === status)
    if (match === undefined) return
    setSelectedIntervalId(match.id)
    setResultTab('table')
  }

  const openSpatial = (mode: 'plan' | 'isometric') => {
    if (run === null) return
    saveSpatialViewRequest(window.localStorage, {
      colorBy: 'geotech.rmr76',
      datasetId: 'demo-geotechnical-log-v4',
      label: savedScenarioName,
      sourceModule: 'manual',
      sourceObservationIds: [...new Set(run.intervals.flatMap((interval) => interval.lineage.map((item) => item.observationId)))],
    })
    const url = new URL(window.location.href)
    url.searchParams.set('section', 'view-3d')
    url.searchParams.set('sceneView', mode)
    window.history.replaceState({}, '', url)
    onNavigate('view-3d')
  }

  return (
    <div className="page geotechnical-page geotech-calculator">
      <h1 className="sr-only">Geotechnical classification</h1>

      <section className="panel geotech-setup" aria-label="Geotechnical calculation setup">
        <div className="geotech-setup-row">
          <div className="geotech-workspace-title" aria-hidden="true">
            <span><Calculator size={18} /></span>
            <div><small>Engineering analysis</small><strong>Rock mass classification</strong></div>
          </div>
          <label className="tool-select tool-select-field geotech-method-select">
            <span>Classification</span>
            <select aria-label="Classification method" onChange={(event) => changeClassification(event.target.value as ClassificationId)} value={classificationId}>{classifications.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
            <ChevronDown size={14} />
          </label>
          <div className="geotech-snapshot-picker">
            <span>Data Snapshot</span>
            <div><label><select aria-label="Data Pool snapshot" onChange={(event) => setSnapshotId(event.target.value)} value={snapshotId}>{snapshotOptions.map((item) => <option key={item.snapshotId} value={item.snapshotId}>{item.snapshotLabel}</option>)}</select><ChevronDown size={13} /></label><button className="button button-secondary" onClick={() => setRefreshChecked(true)} type="button"><RefreshCw size={13} /> Refresh</button></div>
          </div>
          <div className="geotech-scope-picker">
            <span>Scope</span>
            <div><label><select aria-label="RMR hole" onChange={(event) => setHoleId(event.target.value)} value={holeId}><option value="all">All holes</option>{holes.map((hole) => <option key={hole} value={hole}>{hole}</option>)}</select><ChevronDown size={13} /></label><label><select aria-label="RMR depth range" onChange={(event) => setDepthRange(event.target.value as DepthRange)} value={depthRange}><option value="all">All depths</option><option value="shallow">Above 60 m</option><option value="deep">60 m and below</option></select><ChevronDown size={13} /></label></div>
          </div>
          <div className="geotech-readiness-total"><span>Input readiness</span><strong>{classification.ready ? `${availableInputCount} / ${RMR76_METHOD_DEFINITION.requiredInputs.length} available` : 'Method setup required'}</strong></div>
          <button className="button button-accent geotech-primary-action" disabled={!classification.ready || scopedIntervals.length === 0} onClick={calculate} type="button"><Calculator size={15} /> {run === null || !stale ? 'Calculate' : 'Recalculate'}</button>
        </div>
        {refreshChecked && Number(snapshotId) < latestRmrDataset.version ? <div className="geotech-snapshot-update" role="status"><RefreshCw size={13} /><span><strong>Snapshot #44 available</strong><small>Your active calculation snapshot has not changed.</small></span><button className="button button-secondary" onClick={() => { setSnapshotId(latestRmrDataset.snapshotId); setRefreshChecked(false) }} type="button">Use latest</button></div> : null}
        {classification.ready ? <div className="geotech-readiness-list" aria-label="Canonical input readiness">{readiness.map((item) => <button aria-expanded={sourceDetailKey === item.key} className={`availability-${item.availability} ${sourceDetailKey === item.key ? 'is-active' : ''}`} key={item.key} onClick={() => setSourceDetailKey((current) => current === item.key ? null : item.key)} type="button"><b>{availabilityDisplay[item.availability].symbol}</b><span>{item.label}</span><small>{availabilityDisplay[item.availability].label}</small></button>)}</div> : <div className="geotech-method-unavailable"><AlertTriangle size={14} /><span><strong>{classification.label} starts a separate method workspace.</strong> Its deterministic {classification.method} definition and required Data Pool mappings are not installed, so no RMR76 result can be overwritten.</span></div>}
        {sourceDetailKey !== null ? <div className={`geotech-source-detail availability-${sourceDetail?.availability ?? 'missing'}`}><CircleDot size={12} /><span><strong>{RMR76_METHOD_DEFINITION.requiredInputs.find((item) => item.key === sourceDetailKey)?.label}</strong><small>{sourceDetail?.lineage === null || sourceDetail === null ? 'No compatible source in this snapshot and scope.' : `${sourceDetail.lineage.sourceLabel} · ${sourceDetail.lineage.sourceFieldId} · ${sourceDetail.lineage.observationId}`}</small></span>{sourceDetail === null ? <button className="button button-secondary" onClick={() => onNavigate('data-pool')} type="button">Open Data Pool</button> : <b>{availabilityDisplay[sourceDetail.availability].label}</b>}</div> : null}
      </section>

      {run === null ? <section className="panel geotech-empty-state"><div className="geotech-empty-hero"><span className="geotech-empty-icon"><Database size={27} /></span><p className="eyebrow">Deterministic classification</p><h2>{classification.ready ? `${classification.label} is ready to calculate` : `${classification.label} requires a deterministic method definition`}</h2><p className="geotech-empty-copy">{classification.ready ? 'Canonical inputs are resolved from the preferred compatible Data Pool source. The calculation creates a reviewable result without changing primary observations.' : 'RMR76 stays available as the current production engine. Other classifications remain isolated until their own inputs, formulas, versions, and save fields are defined.'}</p>{classification.ready ? <><div className="geotech-empty-metrics"><span><strong>{scopedIntervals.length}</strong><small>Intervals in scope</small></span><span><strong>{availableInputCount} / {RMR76_METHOD_DEFINITION.requiredInputs.length}</strong><small>Inputs available</small></span><span><strong>#{dataset.snapshotId}</strong><small>Data snapshot</small></span></div><button className="button button-accent geotech-empty-action" disabled={scopedIntervals.length === 0} onClick={calculate} type="button"><Calculator size={15} /> Calculate {classification.label}</button><div className="geotech-availability-legend" aria-label="Input availability legend"><span><b className="availability-direct">✓</b> Direct</span><span><b className="availability-derived">◇</b> Derived</span><span><b className="availability-fallback">△</b> Fallback</span><span><b className="availability-missing">!</b> Missing</span></div></> : null}</div></section> : <>
        {stale ? <div className="geotech-stale-banner" role="status"><AlertTriangle size={15} /><span>Snapshot or scope changed. Run {run.runId.slice(0, 8)} remains pinned to snapshot #{run.snapshotId} for review until you recalculate.</span></div> : null}
        <section className="geotech-summary-grid" aria-label="RMR76 result summary">
          <div><span>Mean RMR</span><strong>{formatScore(run.summary.mean)}</strong><small>Valid intervals</small></div><div><span>Median RMR</span><strong>{formatScore(run.summary.median)}</strong><small>Valid intervals</small></div><div><span>Valid</span><strong>{run.summary.valid}</strong><small>Calculated</small></div>
          <button disabled={run.summary.excluded === 0} onClick={() => chooseStatus('excluded')} type="button"><span>Excluded</span><strong>{run.summary.excluded}</strong><small>Click for exact reason</small></button><button disabled={run.summary.missing === 0} onClick={() => chooseStatus('missing')} type="button"><span>Missing</span><strong>{run.summary.missing}</strong><small>Click for exact reason</small></button>
          <div className="geotech-class-proportions"><span>Class proportions</span><div>{Object.entries(run.summary.classCounts).map(([classificationName, count]) => <i key={classificationName} style={{ flex: count }} title={`${classificationName}: ${count}`}><b>{classCode(classificationName)}</b><small>{Math.round(count / Math.max(1, run.summary.valid) * 100)}%</small></i>)}</div></div>
        </section>

        <div className="geotech-results-workspace">
          <main className="panel geotech-results-panel">
            <div className="panel-heading geotech-results-heading"><div><p className="eyebrow">Interval results</p><h2>{RMR76_METHOD_DEFINITION.name}</h2></div><span className="geotech-run-id">Run {run.runId.slice(0, 8)} · Snapshot #{run.snapshotId}</span></div>
            <div className="geotech-result-tabs" role="tablist" aria-label="Result views"><button aria-selected={resultTab === 'downhole'} className={resultTab === 'downhole' ? 'is-active' : ''} onClick={() => setResultTab('downhole')} role="tab" type="button"><Layers3 size={13} />Downhole</button><button aria-selected={resultTab === 'table'} className={resultTab === 'table' ? 'is-active' : ''} onClick={() => setResultTab('table')} role="tab" type="button"><Table2 size={13} />Table</button><button aria-selected={resultTab === 'components'} className={resultTab === 'components' ? 'is-active' : ''} onClick={() => setResultTab('components')} role="tab" type="button"><Calculator size={13} />Components</button></div>
            {resultTab === 'downhole' ? <div className="geotech-downhole-groups" aria-label="Downhole RMR view grouped by hole">{groupedResults.map(([groupHoleId, intervals]) => <section key={groupHoleId}><header><Database size={12} /><strong>{groupHoleId}</strong><small>{intervals.length} intervals · {formatInterval(intervals[0]?.depthFrom ?? 0, intervals.at(-1)?.depthTo ?? 0)}</small></header><div className="geotech-downhole">{intervals.map((interval) => <button className={interval.id === selectedResult?.id ? 'is-selected' : ''} key={interval.id} onClick={() => setSelectedIntervalId(interval.id)} type="button"><span>{formatInterval(interval.depthFrom, interval.depthTo)}</span><i className={`status-${interval.status}`} style={{ width: `${interval.calculation?.total ?? 7}%` }} /><b>{interval.calculation?.total ?? '—'}</b></button>)}</div></section>)}</div> : null}
            {resultTab === 'table' ? <div className="geotech-result-table" role="table" aria-label="RMR76 interval results"><div className="geotech-result-row is-header" role="row"><span>Hole / depth</span><span>RMR</span><span>Class</span><span>RQD</span><span>UCS</span><span>Joint condition</span><span>Status</span></div>{run.intervals.map((interval) => { const jointCondition = interval.resolvedInputs['geotech.joint_condition']; return <button className={`geotech-result-row ${interval.id === selectedResult?.id ? 'is-selected' : ''}`} key={interval.id} onClick={() => setSelectedIntervalId(interval.id)} role="row" type="button"><span><strong>{interval.holeId}</strong><small>{formatInterval(interval.depthFrom, interval.depthTo)}</small></span><b>{interval.calculation?.total ?? '—'}</b><span>{classCode(interval.calculation?.classification)}</span><span>{interval.inputValues.rqdPercent?.toFixed(1) ?? '—'}%</span><span>{interval.inputValues.ucsMpa?.toFixed(0) ?? '—'} MPa</span><span>{jointCondition.availability === 'missing' ? '—' : String(jointCondition.value).replaceAll('-', ' ')}</span><span className={`geotech-status status-${interval.status}`}>{statusText(interval)}</span></button> })}</div> : null}
            {resultTab === 'components' ? <div className="geotech-components-table" role="table" aria-label="RMR76 component ratings"><div className="is-header"><span>Hole / depth</span><span>Basic</span><span>Strength</span><span>RQD</span><span>Spacing</span><span>Condition</span><span>Water</span><span>Orient.</span><span>Final</span></div>{run.intervals.map((interval) => <button className={interval.id === selectedResult?.id ? 'is-selected' : ''} key={interval.id} onClick={() => setSelectedIntervalId(interval.id)} role="row" type="button"><span><strong>{interval.holeId}</strong><small>{formatInterval(interval.depthFrom, interval.depthTo)}</small></span><b>{interval.calculation?.basic ?? '—'}</b><span>{scoreFor(interval, 'strength') ?? '—'}</span><span>{scoreFor(interval, 'rqd') ?? '—'}</span><span>{scoreFor(interval, 'jointSpacing') ?? '—'}</span><span>{scoreFor(interval, 'jointCondition') ?? '—'}</span><span>{scoreFor(interval, 'groundwater') ?? '—'}</span><span>{scoreFor(interval, 'orientation') ?? '—'}</span><b>{interval.calculation?.total ?? '—'}</b></button>)}</div> : null}
          </main>

          <aside className="panel geotech-detail-panel">{selectedResult === null ? null : <><div className="panel-heading"><div><p className="eyebrow">Selected interval</p><h2>{formatInterval(selectedResult.depthFrom, selectedResult.depthTo)}</h2></div><strong className="geotech-detail-score">{selectedResult.calculation?.total ?? '—'}</strong></div><div className="geotech-detail-class"><span>{selectedResult.calculation?.classification ?? statusText(selectedResult)}</span><small>{selectedResult.holeId} · {selectedResult.lithology}</small></div>
            {selectedResult.status === 'missing' ? <div className="geotech-reason-card is-missing"><AlertTriangle size={14} /><span><strong>Missing: {selectedResult.missing.map(missingReason).join('; ')}</strong><small>The interval is retained, but no final classification is calculated.</small></span><button onClick={() => onNavigate('data-pool')} type="button">Open Data Pool</button></div> : null}
            {selectedResult.status === 'excluded' ? <div className="geotech-reason-card"><AlertTriangle size={14} /><span><strong>Excluded: {selectedResult.exclusionReason}</strong><small>Source: {selectedResult.exclusionSource ?? 'Data Pool quality rule'}</small></span></div> : null}
            {selectedResult.missing.some((key) => key.startsWith('structure.')) ? <div className="geotech-structure-missing"><AlertTriangle size={15} /><span><strong>Accepted structure result required</strong><small>Joint spacing and orientation resolve from accepted J1/J2/J3.</small></span><button onClick={() => onNavigate('structure')} type="button">Open Structure Analysis</button></div> : null}
            <dl className="geotech-component-list"><div className="geotech-component-heading"><dt>Basic RMR</dt><dd>{selectedResult.calculation?.basic ?? '—'}</dd></div>{(['strength', 'rqd', 'jointSpacing', 'jointCondition', 'groundwater'] as const).map((key) => <div key={key}><dt>{componentLabels[key]}</dt><dd>{scoreFor(selectedResult, key) === null ? '—' : `${scoreFor(selectedResult, key)} pts`}</dd></div>)}<div className="geotech-component-heading"><dt>Orientation adjustment</dt><dd>{scoreFor(selectedResult, 'orientation') === null ? '—' : `${scoreFor(selectedResult, 'orientation')} pts`}</dd></div><div className="is-total"><dt>Final RMR</dt><dd>{selectedResult.calculation?.total ?? '—'}</dd></div><div className="is-class"><dt>Class</dt><dd>{selectedResult.calculation?.classification ?? '—'}</dd></div></dl>
            <div className="geotech-lineage"><h3>Source lineage</h3>{selectedResult.lineage.map((lineage) => <div key={`${lineage.canonicalKey}-${lineage.observationId}`}><CircleDot size={11} /><span><strong>{lineage.canonicalKey}</strong><small>{lineage.sourceLabel} · {lineage.sourceFieldId}</small></span><b>{availabilityDisplay[lineage.availability].symbol}</b></div>)}</div></>}</aside>
        </div>

        {!isSaved && !stale && run.summary.valid > 0 ? <section className="panel geotech-save-strip"><div><Save size={17} /><span><strong>Save RMR76 analysis</strong><small>Updates template v{templateVersion} with GeoEye-owned derived fields, its analysis file, and graph images.</small></span></div><label><input checked={includeComponents} onChange={(event) => setIncludeComponents(event.target.checked)} type="checkbox" /> Component ratings</label><button className="button button-secondary" onClick={() => setSaveAsOpen(true)} type="button">Save As…</button><button className="button button-accent" onClick={() => save(false)} type="button"><Save size={14} /> Save</button></section> : null}
        {isSaved ? <section className="panel geotech-saved-strip"><CheckCircle2 size={17} /><span><strong>Saved · {savedScenarioName}</strong><small>Derived fields, the RMR76 analysis file, and graph images were saved together.</small></span><div className="geotech-after-save-actions"><button className="button button-secondary" onClick={() => onNavigate('explore')} type="button"><BarChart3 size={14} /> Open in Statistics</button><button className="button button-secondary" onClick={() => onNavigate('domain')} type="button"><Layers3 size={14} /> Open in Domain</button><button className="button button-secondary" onClick={() => openSpatial('plan')} type="button"><MapIcon size={14} /> View in 2D</button><button className="button button-secondary" onClick={() => openSpatial('isometric')} type="button"><Box size={14} /> View in 3D</button><button className="button button-secondary" onClick={() => setSaveAsOpen(true)} type="button">Save As…</button><button className="button button-accent" onClick={() => save(false)} type="button"><Save size={14} /> Save</button></div></section> : null}
      </>}

      <section className="panel geotech-details-panel"><div className="geotech-detail-tabs" role="tablist" aria-label="Geotechnical details">{([['method', 'Method details'], ['mapping', 'Source mapping'], ['references', 'References'], ['history', 'Run history']] as const).map(([id, label]) => <button aria-selected={detailTab === id} className={detailTab === id ? 'is-active' : ''} key={id} onClick={() => setDetailTab(id)} role="tab" type="button">{id === 'history' ? <History size={13} /> : null}{label}</button>)}</div>
        {detailTab === 'method' ? <div className="geotech-method-details"><div><span>Method</span><strong>{classification.label} · {classification.method}</strong></div><div><span>Version</span><strong>{classification.ready ? RMR76_METHOD_DEFINITION.version : 'Not installed'}</strong></div><div><span>Execution</span><strong>{classification.ready ? 'Deterministic · interval support' : 'Separate method required'}</strong></div><p>{classification.ready ? 'Five basic component ratings plus the excavation-specific orientation adjustment are evaluated from Data Pool-resolved canonical inputs. Thresholds and class boundaries remain in the engineering calculation module.' : `${classification.label} cannot reuse RMR76 formulas. It will create separate runs and result fields when its deterministic method definition is installed.`}</p></div> : null}
        {detailTab === 'mapping' ? <div className="geotech-mapping-list">{classification.ready ? RMR76_METHOD_DEFINITION.requiredInputs.map((definition) => { const resolved = scopedIntervals[0] === undefined ? null : resolver.resolve(scopedIntervals[0], selectedSourceIds).inputs[definition.key]; return <div key={definition.key}><span className={`availability-${resolved?.availability ?? 'missing'}`}>{availabilityDisplay[resolved?.availability ?? 'missing'].symbol}</span><strong>{definition.label}</strong><small>{resolved?.lineage == null ? 'No compatible Data Pool source' : `${resolved.lineage.sourceLabel} · ${resolved.lineage.sourceFieldId}`}</small></div> }) : <p>Source mapping is method-specific and has not been configured for {classification.label}.</p>}</div> : null}
        {detailTab === 'references' ? <div className="geotech-reference-list"><a href={GEOTECHNICAL_REFERENCES.rmr76.url} rel="noreferrer" target="_blank"><span><strong>Bieniawski 1976</strong><small>Original publication record</small></span><ExternalLink size={14} /></a><a href={GEOTECHNICAL_REFERENCES.rmr76Table.url} rel="noreferrer" target="_blank"><span><strong>RMR76 rating tables</strong><small>Hoek, Kaiser &amp; Bawden · pp. 103–104</small></span><ExternalLink size={14} /></a></div> : null}
        {detailTab === 'history' ? <div className="geotech-run-history">{savedDocument.runs.length === 0 ? <p>No saved classification runs yet.</p> : savedDocument.runs.map((item) => <div key={`${item.scenarioId}-${item.runId}`}><Check size={13} /><span><strong>{item.scenarioName} · {item.runId.slice(0, 8)}</strong><small>{item.classificationId.toUpperCase()} · snapshot #{item.snapshotId} · {new Date(item.savedAt).toLocaleString()} · {item.includeComponentRatings ? 'with components' : 'final fields only'}</small></span></div>)}</div> : null}
      </section>

      {saveAsOpen ? <div className="dialog-backdrop geotech-save-as-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSaveAsOpen(false) }} role="presentation"><form aria-labelledby="geotech-save-as-title" aria-modal="true" className="geotech-save-as-dialog" onSubmit={(event) => { event.preventDefault(); save(true) }} role="dialog"><header><div><p className="eyebrow">New template revision</p><h2 id="geotech-save-as-title">Save As v{templateVersion + 1}</h2></div><button aria-label="Close Save As" className="icon-button" onClick={() => setSaveAsOpen(false)} type="button"><X size={17} /></button></header><div><p>Template v{templateVersion} remains unchanged. The new version receives the derived RMR fields and its own analysis file, run lineage, snapshot, and timestamp.</p></div><footer><button className="button button-secondary" onClick={() => setSaveAsOpen(false)} type="button">Cancel</button><button className="button button-accent" type="submit"><Save size={14} /> Save As v{templateVersion + 1}</button></footer></form></div> : null}
    </div>
  )
}
