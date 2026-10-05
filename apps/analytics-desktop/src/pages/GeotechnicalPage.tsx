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
  Save,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { GeotechnicalResultsTable, type ResultStatusFilter } from './GeotechnicalResultsTable.js'
import {
  buildRmr76SourceSignature,
  calculateRmr76Intervals,
  RMR76_METHOD_DEFINITION,
  summarizeInputReadiness,
  type InputAvailability,
  type Rmr76CalculationRun,
  type Rmr76CanonicalInputKey,
  type Rmr76IntervalResult,
} from '../analysis/geotechnicalWorkflow.js'
import { GEOTECHNICAL_REFERENCES, type ExcavationType } from '../analysis/geotechnical.js'
import {
  currentAnalysisTemplateVersion,
  recordAnalysisTemplateSave,
  resolveAnalysisTemplateVersion,
} from '../data/analysisSaveStore.js'
import { barGraphImage } from '../data/analysisGraphImages.js'
import { saveAnalysisResultPackage } from '../data/analysisResultStore.js'
import { useDurableAction } from '../state/useDurableAction.js'
import {
  buildSavedRmr76Run,
  readGeotechnicalDerivedDocument,
  saveRmr76DerivedFields,
} from '../data/geotechnicalDerivedStore.js'
import {
  buildDatabaseRmrSources,
  buildFieldLoggingRmrSources,
  buildJoinedRmrDataset,
  isCompleteRmrSourceMapping,
  isRmrColumnCompatible,
  rmrColumnLabel,
  rmrSourceOptionLabel,
  type DatabaseRmrSource,
  type Rmr76ParameterSourceMapping,
} from '../data/geotechnicalDatabase.js'
import { saveSpatialViewRequest } from '../data/spatialViewStore.js'
import type { SectionId } from '../types.js'
import { usePersistentState } from '../state/persistentState.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'
import { effectiveDrillholes } from '../data/localProjectDb.js'

type ClassificationId = 'rmr76' | 'rmr89' | 'mrmr' | 'q-system'
type DepthRange = 'all' | 'shallow' | 'deep'
type DetailTab = 'method' | 'mapping' | 'references' | 'history'

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
  fallback: { label: 'Estimated', symbol: '△' },
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

function formatInterval(depthFrom: number, depthTo: number) {
  return `${depthFrom.toFixed(1)}–${depthTo.toFixed(1)} m`
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
  const workspace = useDataPoolWorkspace()
  const databaseSources = useMemo(() => {
    const snapshot = workspace.localSnapshot
    if (!workspace.live || snapshot === null) return []
    const holeNames = new Map(effectiveDrillholes(snapshot, workspace.localDrillholeDraft).map((hole) => [hole.id, hole.name]))
    return [
      ...buildDatabaseRmrSources(snapshot.datasets, snapshot.observations, snapshot.variables, holeNames),
      ...buildFieldLoggingRmrSources(snapshot.fieldLogging.datasets ?? [], holeNames),
    ]
  }, [workspace.live, workspace.localDrillholeDraft, workspace.localSnapshot])
  if (!workspace.live) return <div className="page geotechnical-page"><div className="eda-state panel">No local project data is open.</div></div>
  if (workspace.projectsLoading || workspace.localLoading) return <div className="page geotechnical-page"><div className="eda-state panel">Opening local geotechnical data…</div></div>
  if (workspace.project === null) return <div className="page geotechnical-page"><div className="eda-state panel" role="alert">No project is available for this account.</div></div>
  if (workspace.localSnapshot === null) return <div className="page geotechnical-page"><div className="eda-state panel"><strong>No local project snapshot is available.</strong><button className="button button-accent" onClick={() => onNavigate('data-pool')} type="button">Open Data</button></div></div>
  return <GeotechnicalWorkbench databaseSources={databaseSources} key={workspace.project.id} onNavigate={onNavigate} projectId={workspace.project.id} tenantId={workspace.project.organizationId ?? '_unassigned'} />
}

function GeotechnicalWorkbench({ databaseSources, onNavigate, projectId, tenantId }: GeotechnicalPageProps & {
  databaseSources: readonly DatabaseRmrSource[]
  projectId: string
  tenantId: string
}) {
  const queryClient = useQueryClient()
  const storage = useProjectStorage()
  const durable = useDurableAction()
  const persistenceScope = projectId
  const [parameterMappings, setParameterMappings] = usePersistentState<Rmr76ParameterSourceMapping>('geotechnical.parameterSources.v2', {}, { scope: persistenceScope })
  const [excavationType, setExcavationType] = usePersistentState<ExcavationType>('geotechnical.excavationType', 'tunnel', { scope: persistenceScope })
  const [classificationId, setClassificationId] = usePersistentState<ClassificationId>('geotechnical.classificationId', 'rmr76')
  const [holeId, setHoleId] = usePersistentState('geotechnical.holeId', 'all', { scope: persistenceScope })
  const [depthRange, setDepthRange] = usePersistentState<DepthRange>('geotechnical.depthRange', 'all')
  const [useJointConditionMean, setUseJointConditionMean] = usePersistentState('geotechnical.useJointConditionMean', false, { scope: persistenceScope })
  const [run, setRun] = usePersistentState<Rmr76CalculationRun | null>('geotechnical.run', null, { scope: persistenceScope })
  const [savedRunId, setSavedRunId] = usePersistentState<string | null>('geotechnical.savedRunId', null, { scope: persistenceScope })
  const [savedScenarioName, setSavedScenarioName] = usePersistentState('geotechnical.savedScenarioName', 'Geotechnical logging', { scope: persistenceScope })
  const effectiveMapping = useMemo(() => {
    const sources = new Map(databaseSources.map((source) => [source.dataset.id, source]))
    return Object.fromEntries(RMR76_METHOD_DEFINITION.requiredInputs.flatMap((definition) => {
      const selection = parameterMappings[definition.key]
      if (selection === undefined) return []
      const source = sources.get(selection.sourceId)
      const column = source?.columns.find((item) => item.key === selection.columnKey)
      return column !== undefined && isRmrColumnCompatible(definition.key, column) ? [[definition.key, selection]] : []
    })) as Rmr76ParameterSourceMapping
  }, [databaseSources, parameterMappings])
  const mappingComplete = isCompleteRmrSourceMapping(effectiveMapping, databaseSources)
  const joinedDatabaseDataset = useMemo(() => buildJoinedRmrDataset(databaseSources, effectiveMapping, excavationType, {
    useJointConditionMean,
    inScope: (record, source) => {
      if (holeId !== 'all' && (source.holeNames.get(record.holeId ?? '') ?? record.holeId) !== holeId) return false
      if (depthRange === 'shallow') return record.depthFrom !== null && record.depthFrom < 60
      if (depthRange === 'deep') return record.depthTo !== null && record.depthTo > 60
      return true
    },
  }), [databaseSources, effectiveMapping, excavationType, useJointConditionMean, holeId, depthRange])
  const baseDatasets = [joinedDatabaseDataset.dataset]
  const joinDiagnostics = joinedDatabaseDataset.diagnostics
  const [templateVersion, setTemplateVersion] = useState(() => {
    const initialDataset = baseDatasets[0]
    if (initialDataset === undefined) return 1
    return currentAnalysisTemplateVersion(
      storage,
      initialDataset.targetTemplateId,
      templateVersionFromId(initialDataset.targetTemplateId),
    )
  })
  const [selectedIntervalId, setSelectedIntervalId] = usePersistentState<string | null>('geotechnical.selectedIntervalId', null, { scope: persistenceScope })
  const [includeComponents, setIncludeComponents] = usePersistentState('geotechnical.includeComponents', false)
  const [detailTab, setDetailTab] = usePersistentState<DetailTab>('geotechnical.detailTab', 'method')
  const [activeTab, setActiveTab] = useState<'input' | 'result'>(run === null ? 'input' : 'result')
  const [intervalDetailsOpen, setIntervalDetailsOpen] = useState(false)
  const [resultStatus, setResultStatus] = useState<ResultStatusFilter>('all')
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [savedDocument, setSavedDocument] = useState(() => readGeotechnicalDerivedDocument(storage))

  const dataset = baseDatasets[0]
  const classification = classifications.find((item) => item.id === classificationId) ?? classifications[0]!
  const selectedSourceIds = useMemo(() => new Set(dataset?.sources.map((source) => source.id) ?? []), [dataset])
  const holes = useMemo(() => [...new Set(databaseSources.flatMap((source) => source.records.flatMap((record) => record.holeId === null
      ? []
      : [source.holeNames.get(record.holeId) ?? record.holeId])))].sort(), [databaseSources])
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
  const stale = run !== null && (run.sourceSignature !== sourceSignature || run.snapshotId !== dataset?.snapshotId)
  const isSaved = run !== null && savedRunId === run.runId && !stale
  const selectedResult = run?.intervals.find((interval) => interval.id === selectedIntervalId)
    ?? run?.intervals[0]
    ?? null
  useEffect(() => {
    if (dataset === undefined) return
    if (holeId !== 'all' && !holes.includes(holeId)) setHoleId('all')
  }, [dataset, holeId, holes, setHoleId])

  if (dataset === undefined) return <div className="page geotechnical-page"><div className="eda-state panel"><strong>No local analytical snapshot is available.</strong><button className="button button-accent" onClick={() => onNavigate('data-pool')} type="button">Open Data</button></div></div>

  const changeClassification = (next: ClassificationId) => {
    setClassificationId(next)
    setRun(null)
    setSavedRunId(null)
    setSelectedIntervalId(null)
  }

  const resetCalculation = () => {
    setRun(null)
    setSavedRunId(null)
    setSelectedIntervalId(null)
  }

  const changeParameterSource = (key: Rmr76CanonicalInputKey, sourceId: string) => {
    setParameterMappings((current) => ({
      ...current,
      [key]: sourceId === '' ? undefined : { columnKey: '', sourceId },
    }))
    setHoleId('all')
    resetCalculation()
  }

  const changeParameterColumn = (key: Rmr76CanonicalInputKey, columnKey: string) => {
    setParameterMappings((current) => {
      const selection = current[key]
      return {
        ...current,
        [key]: selection === undefined || columnKey === '' ? (selection === undefined ? undefined : { ...selection, columnKey: '' }) : { ...selection, columnKey },
      }
    })
    resetCalculation()
  }

  const changeExcavationType = (next: ExcavationType) => {
    setExcavationType(next)
    resetCalculation()
  }

  const calculate = () => {
    if (!classification.ready || !mappingComplete || scopedIntervals.length === 0) return
    const next = calculateRmr76Intervals(scopedIntervals, selectedSourceIds, makeRunId(classificationId), new Date().toISOString(), dataset.snapshotId)
    setRun(next)
    setSavedRunId(null)
    setSelectedIntervalId(next.intervals[0]?.id ?? null)
    setActiveTab('result')
    setResultStatus('all')
    setIntervalDetailsOpen(false)
    document.getElementById('rmr-tab-result')?.focus()
  }

  const save = (createVersion: boolean) => durable.perform(async () => {
    if (run === null || stale || run.summary.valid === 0) return
    const nextVersion = resolveAnalysisTemplateVersion(storage, {
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
    const document = saveRmr76DerivedFields(storage, saved)
    recordAnalysisTemplateSave(storage, {
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
    await saveAnalysisResultPackage(storage, {
      analysisFileId,
      analysisPayload: saved,
      boreholeIds,
      createdAt: savedAt,
      derivedFieldKeys: saved.fieldDefinitions.map((field) => field.key),
      feature: 'geotechnical',
      graphs: [...downholeGraphs, barGraphImage('rmr76-class-distribution', 'RMR76 class distribution', classCounts)],
      inputName: `rmr76-${holeId}-${depthRange}${includeComponents ? '-components' : ''}`,
      projectId,
      runId: run.runId,
      sourceFileName: `${dataset.id}.json`,
      sourceObservationIds: saved.intervals.flatMap((interval) => interval.sourceLineage.map((lineage) => lineage.observationId)),
      templateId: dataset.targetTemplateId,
      templateVersion: nextVersion,
      tenantId,
    })
    setSavedDocument(document)
    setSavedRunId(run.runId)
    setSavedScenarioName(versionLabel)
    setTemplateVersion(nextVersion)
    setSaveAsOpen(false)
    void queryClient.invalidateQueries({ queryKey: ['eda-datasets'] })
  })

  const chooseStatus = (status: Rmr76IntervalResult['status']) => {
    const match = run?.intervals.find((interval) => interval.status === status)
    if (match === undefined) return
    setSelectedIntervalId(match.id)
    setResultStatus(status)
    setActiveTab('result')
  }

  const openSpatial = (mode: 'plan' | 'isometric') => {
    if (run === null) return
    saveSpatialViewRequest(storage, {
      colorBy: 'geotech.rmr76',
      datasetId: dataset.id,
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
      {durable.notice ? <p role="status">{durable.notice}</p> : null}

      <div className="rmr-workbench-tabs" role="tablist" aria-label="RMR workspace" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 'input' : event.key === 'End' ? 'result' : activeTab === 'input' ? 'result' : 'input'
        setActiveTab(next)
        document.getElementById('rmr-tab-' + next)?.focus()
      }}>
        <button id="rmr-tab-input" role="tab" aria-selected={activeTab === 'input'} aria-controls="rmr-input-panel" tabIndex={activeTab === 'input' ? 0 : -1} onClick={() => setActiveTab('input')} type="button">Input</button>
        <button id="rmr-tab-result" role="tab" aria-selected={activeTab === 'result'} aria-controls="rmr-result-panel" tabIndex={activeTab === 'result' ? 0 : -1} onClick={() => setActiveTab('result')} type="button">Result</button>
      </div>
      <div id="rmr-input-panel" role="tabpanel" aria-labelledby="rmr-tab-input" hidden={activeTab !== 'input'}>
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
          <div className="geotech-local-input-summary"><span>Templates</span><strong>{databaseSources.length} available</strong></div>
          <div className="geotech-scope-picker">
            <span>Scope</span>
            <div><label><select aria-label="RMR hole" onChange={(event) => setHoleId(event.target.value)} value={holeId}><option value="all">All holes</option>{holes.map((hole) => <option key={hole} value={hole}>{hole}</option>)}</select><ChevronDown size={13} /></label><label><select aria-label="RMR depth range" onChange={(event) => setDepthRange(event.target.value as DepthRange)} value={depthRange}><option value="all">All depths</option><option value="shallow">Above 60 m</option><option value="deep">60 m and below</option></select><ChevronDown size={13} /></label></div>
          </div>
          <div className="geotech-readiness-total"><span>Intervals</span><strong>{classification.ready ? `${joinDiagnostics.matchedIntervalCount} matched` : 'Setup required'}</strong></div>
          <button className="button button-accent geotech-primary-action" disabled={!classification.ready || !mappingComplete || scopedIntervals.length === 0} onClick={calculate} title={!mappingComplete ? 'Map every RMR76 input' : scopedIntervals.length === 0 ? 'No matching intervals' : undefined} type="button"><Calculator size={15} /> {run === null || !stale ? 'Calculate' : 'Recalculate'}</button>
        </div>
        <div className="geotech-column-mapper" aria-label="RMR76 parameter column mapping">
            <header>
              <strong>Inputs</strong>
              <label><span>Excavation</span><select aria-label="RMR excavation type" onChange={(event) => changeExcavationType(event.target.value as ExcavationType)} value={excavationType}><option value="tunnel">Tunnel</option><option value="foundation">Foundation</option><option value="slope">Slope</option></select><ChevronDown size={13} /></label>
            </header>
            <div className="geotech-parameter-grid">{RMR76_METHOD_DEFINITION.requiredInputs.map((definition) => {
              const rawSelection = parameterMappings[definition.key]
              const selectedSource = databaseSources.find((source) => source.dataset.id === rawSelection?.sourceId)
              const sourceOptions = databaseSources
              const compatibleColumns = selectedSource?.columns ?? []
              const diagnostic = joinDiagnostics?.parameters[definition.key]
              return <div className={`geotech-parameter-source ${effectiveMapping[definition.key] === undefined ? 'is-unmapped' : 'is-mapped'}`} key={definition.key}><span>{definition.label}{definition.unit === null ? '' : ` (${definition.unit})`}</span><label><small>Live template or imported data</small><select aria-label={`${definition.label} template`} onChange={(event) => changeParameterSource(definition.key, event.target.value)} value={selectedSource?.dataset.id ?? ''}><option value="">Choose source…</option>{sourceOptions.map((source) => <option key={source.dataset.id} value={source.dataset.id}>{rmrSourceOptionLabel(source, sourceOptions)}</option>)}</select><ChevronDown size={13} /></label><label><small>Value</small><select aria-label={`${definition.label} value`} disabled={selectedSource === undefined} onChange={(event) => changeParameterColumn(definition.key, event.target.value)} value={effectiveMapping[definition.key]?.columnKey ?? ''}><option value="">Choose value…</option>{compatibleColumns.map((column) => <option disabled={!isRmrColumnCompatible(definition.key, column)} key={column.key} value={column.key}>{rmrColumnLabel(column)} · {column.dataType}{isRmrColumnCompatible(definition.key, column) ? '' : ' · incompatible type'}</option>)}</select><ChevronDown size={13} /></label><footer>{effectiveMapping[definition.key] === undefined ? selectedSource === undefined ? `${sourceOptions.length} sources` : `${compatibleColumns.length} values` : `${diagnostic?.sourceIntervalCount ?? 0} rows · ${diagnostic?.unmatchedIntervalCount ?? 0} unmatched`}</footer></div>
            })}</div>
            <div className="geotech-mean-option">
              <label><input type="checkbox" checked={useJointConditionMean} onChange={(event) => { setUseJointConditionMean(event.target.checked); resetCalculation() }} /> Use mean for missing joint condition</label>
              <p role="status">{effectiveMapping['geotech.joint_condition'] === undefined
                ? 'Select a joint-condition template and value first.'
                : joinDiagnostics.jointConditionMean === null
                  ? 'No valid joint-condition ratings in this scope. A mean cannot be calculated; missing values remain missing.'
                  : `Scoped mean: ${joinDiagnostics.jointConditionMean.toFixed(2)} / 25 from ${joinDiagnostics.jointConditionSampleCount} distinct intervals. ${useJointConditionMean ? `${joinDiagnostics.jointConditionEstimatedCount} missing intervals filled as estimates.` : 'Enable to fill missing intervals as estimates.'} Existing values are preserved.`}</p>
            </div>
          </div>
        {classification.ready ? <div className="geotech-readiness-list" aria-label="Canonical input readiness">{readiness.map((item) => <button aria-expanded="false" className={`availability-${item.availability}`} key={item.key} type="button"><b>{availabilityDisplay[item.availability].symbol}</b><span>{item.label}</span><small>{availabilityDisplay[item.availability].label}</small></button>)}</div> : <div className="geotech-method-unavailable"><AlertTriangle size={14} /><span><strong>{classification.label} starts a separate method workspace.</strong> Its deterministic {classification.method} definition and required Database mappings are not installed, so no RMR76 result can be overwritten.</span></div>}
      </section>

      </div>
      <div id="rmr-result-panel" role="tabpanel" aria-labelledby="rmr-tab-result" hidden={activeTab !== 'result'}>
      {run === null ? <section className="panel rmr-empty-result"><strong>No results</strong><button className="button button-secondary" onClick={() => setActiveTab('input')} type="button">Go to Input</button></section> : <>
        {stale ? <div className="geotech-stale-banner" role="status"><AlertTriangle size={15} /><span>Results out of date.</span><button className="button button-secondary" type="button" onClick={() => setActiveTab('input')}>Update inputs</button></div> : null}
        <section className="geotech-summary-grid" aria-label="RMR76 result summary">
          <div><span>Mean RMR</span><strong>{formatScore(run.summary.mean)}</strong></div><div><span>Median RMR</span><strong>{formatScore(run.summary.median)}</strong></div><div><span>Calculated</span><strong>{run.summary.valid}</strong></div>
          <button disabled={run.summary.excluded === 0} onClick={() => chooseStatus('excluded')} type="button"><span>Excluded</span><strong>{run.summary.excluded}</strong></button><button disabled={run.summary.missing === 0} onClick={() => chooseStatus('missing')} type="button"><span>Missing</span><strong>{run.summary.missing}</strong></button>
          <div className="geotech-class-proportions"><span>Class proportions</span><div>{Object.entries(run.summary.classCounts).map(([classificationName, count]) => <i key={classificationName} style={{ flex: count }} title={`${classificationName}: ${count}`}><b>{classCode(classificationName)}</b><small>{Math.round(count / Math.max(1, run.summary.valid) * 100)}%</small></i>)}</div></div>
        </section>

        <div className="geotech-results-workspace rmr-table-workspace">
          <main className="panel geotech-results-panel">
            <div className="panel-heading geotech-results-heading"><div><p className="eyebrow">Interval results</p><h2>RMR results &amp; derived values</h2></div><span className="geotech-run-id">{run.intervals.length.toLocaleString()} intervals · {new Set(run.intervals.map(interval => interval.holeId)).size} boreholes</span></div>
            <GeotechnicalResultsTable key={run.runId} intervals={run.intervals} selectedId={intervalDetailsOpen ? selectedResult?.id ?? null : null} onSelect={id => { setSelectedIntervalId(id); setIntervalDetailsOpen(true) }} status={resultStatus} onStatusChange={setResultStatus} />



          </main>

          <details className="panel rmr-interval-disclosure" open={intervalDetailsOpen} onToggle={event => setIntervalDetailsOpen(event.currentTarget.open)}><summary>Selected interval details <span>{selectedResult?.holeId} · {selectedResult === null ? '' : formatInterval(selectedResult.depthFrom, selectedResult.depthTo)}</span><ChevronDown size={14} /></summary><aside className="geotech-detail-panel">{selectedResult === null ? null : <><div className="panel-heading"><div><p className="eyebrow">Selected interval</p><h2>{formatInterval(selectedResult.depthFrom, selectedResult.depthTo)}</h2></div><strong className="geotech-detail-score">{selectedResult.calculation?.total ?? '—'}</strong></div><div className="geotech-detail-class"><span>{selectedResult.calculation?.classification ?? statusText(selectedResult)}</span><small>{selectedResult.holeId} · {selectedResult.lithology}</small></div>
            {selectedResult.status === 'missing' ? <div className="geotech-reason-card is-missing"><AlertTriangle size={14} /><span><strong>Missing: {selectedResult.missing.map(missingReason).join('; ')}</strong></span><button onClick={() => onNavigate('data-pool')} type="button">Open Database</button></div> : null}
            {selectedResult.status === 'excluded' ? <div className="geotech-reason-card"><AlertTriangle size={14} /><span><strong>Excluded: {selectedResult.exclusionReason}</strong><small>Source: {selectedResult.exclusionSource ?? 'Database quality rule'}</small></span></div> : null}
            <dl className="geotech-component-list"><div className="geotech-component-heading"><dt>Basic RMR</dt><dd>{selectedResult.calculation?.basic ?? '—'}</dd></div>{(['strength', 'rqd', 'jointSpacing', 'jointCondition', 'groundwater'] as const).map((key) => <div key={key}><dt>{componentLabels[key]}</dt><dd>{scoreFor(selectedResult, key) === null ? '—' : `${scoreFor(selectedResult, key)} pts`}</dd></div>)}<div className="geotech-component-heading"><dt>Orientation adjustment</dt><dd>{scoreFor(selectedResult, 'orientation') === null ? 'Not assessed' : `${scoreFor(selectedResult, 'orientation')} pts`}</dd></div><div className="is-total"><dt>{selectedResult.calculation === null ? 'RMR76 · not calculated' : selectedResult.calculation.ratingBasis === 'basic' ? 'Basic RMR76' : 'Adjusted RMR76'}</dt><dd>{selectedResult.calculation?.total ?? '—'}</dd></div><div className="is-class"><dt>Class</dt><dd>{selectedResult.calculation?.classification ?? '—'}</dd></div></dl>
            <div className="geotech-lineage"><h3>Source lineage</h3>{selectedResult.lineage.map((lineage) => <div key={`${lineage.canonicalKey}-${lineage.observationId}`}><CircleDot size={11} /><span><strong>{lineage.canonicalKey}</strong><small>{lineage.sourceLabel} · {lineage.sourceFieldId}</small></span><b>{availabilityDisplay[lineage.availability].symbol}</b></div>)}</div></>}</aside></details>
        </div>

        {!isSaved && !stale && run.summary.valid > 0 ? <section className="panel geotech-save-strip"><div><Save size={17} /><span><strong>Save RMR76 analysis</strong></span></div><label><input checked={includeComponents} onChange={(event) => setIncludeComponents(event.target.checked)} type="checkbox" /> Component ratings</label><button className="button button-secondary" onClick={() => setSaveAsOpen(true)} type="button">Save As…</button><button className="button button-accent" onClick={() => save(false)} type="button"><Save size={14} /> Save</button></section> : null}
        {isSaved ? <section className="panel geotech-saved-strip"><CheckCircle2 size={17} /><span><strong>Saved · {savedScenarioName}</strong></span><div className="geotech-after-save-actions"><button className="button button-secondary" onClick={() => onNavigate('explore')} type="button"><BarChart3 size={14} /> Open in Statistics</button><button className="button button-secondary" onClick={() => onNavigate('domain')} type="button"><Layers3 size={14} /> Open in Domain</button><button className="button button-secondary" onClick={() => openSpatial('plan')} type="button"><MapIcon size={14} /> View in 2D</button><button className="button button-secondary" onClick={() => openSpatial('isometric')} type="button"><Box size={14} /> View in 3D</button><button className="button button-secondary" onClick={() => setSaveAsOpen(true)} type="button">Save As…</button><button className="button button-accent" onClick={() => save(false)} type="button"><Save size={14} /> Save</button></div></section> : null}
      </>}
      </div>

      <details hidden={activeTab !== 'input'} className="panel rmr-method-disclosure"><summary>Method, source mapping and run history<ChevronDown size={14} /></summary><section className="geotech-details-panel"><div className="geotech-detail-tabs" role="tablist" aria-label="Geotechnical details">{([['method', 'Method details'], ['mapping', 'Source mapping'], ['references', 'References'], ['history', 'Run history']] as const).map(([id, label]) => <button aria-selected={detailTab === id} className={detailTab === id ? 'is-active' : ''} key={id} onClick={() => setDetailTab(id)} role="tab" type="button">{id === 'history' ? <History size={13} /> : null}{label}</button>)}</div>
        {detailTab === 'method' ? <div className="geotech-method-details"><div><span>Method</span><strong>{classification.label} · {classification.method}</strong></div><div><span>Version</span><strong>{classification.ready ? RMR76_METHOD_DEFINITION.version : 'Not installed'}</strong></div><div><span>Execution</span><strong>{classification.ready ? 'Deterministic' : 'Setup required'}</strong></div></div> : null}
        {detailTab === 'mapping' ? <div className="geotech-mapping-list">{classification.ready ? RMR76_METHOD_DEFINITION.requiredInputs.map((definition) => {
          const selection = effectiveMapping[definition.key]
          const source = databaseSources.find((item) => item.dataset.id === selection?.sourceId)
          const column = source?.columns.find((item) => item.key === selection?.columnKey)
          const mapped = column !== undefined
          return <div key={definition.key}><span className={`availability-${mapped ? 'direct' : 'missing'}`}>{availabilityDisplay[mapped ? 'direct' : 'missing'].symbol}</span><strong>{definition.label}</strong><small>{column === undefined ? 'Not mapped' : `${source?.dataset.name} → ${rmrColumnLabel(column)} · ${column.key}`}</small></div>
        }) : <p>Source mapping is method-specific and has not been configured for {classification.label}.</p>}</div> : null}
        {detailTab === 'references' ? <div className="geotech-reference-list"><a href={GEOTECHNICAL_REFERENCES.rmr76.url} rel="noreferrer" target="_blank"><span><strong>Bieniawski 1976</strong><small>Original publication record</small></span><ExternalLink size={14} /></a><a href={GEOTECHNICAL_REFERENCES.rmr76Table.url} rel="noreferrer" target="_blank"><span><strong>RMR76 rating tables</strong><small>Hoek, Kaiser &amp; Bawden · pp. 103–104</small></span><ExternalLink size={14} /></a></div> : null}
        {detailTab === 'history' ? <div className="geotech-run-history">{savedDocument.runs.length === 0 ? <p>No saved classification runs yet.</p> : savedDocument.runs.map((item) => <div key={`${item.scenarioId}-${item.runId}`}><Check size={13} /><span><strong>{item.scenarioName} · {item.runId.slice(0, 8)}</strong><small>{item.classificationId.toUpperCase()} · snapshot #{item.snapshotId} · {new Date(item.savedAt).toLocaleString()} · {item.includeComponentRatings ? 'with components' : 'final fields only'}</small></span></div>)}</div> : null}
      </section></details>

      {saveAsOpen ? <div className="dialog-backdrop geotech-save-as-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSaveAsOpen(false) }} role="presentation"><form aria-labelledby="geotech-save-as-title" aria-modal="true" className="geotech-save-as-dialog" onSubmit={(event) => { event.preventDefault(); save(true) }} role="dialog"><header><div><p className="eyebrow">New template revision</p><h2 id="geotech-save-as-title">Save As v{templateVersion + 1}</h2></div><button aria-label="Close Save As" className="icon-button" onClick={() => setSaveAsOpen(false)} type="button"><X size={17} /></button></header><div><p>Template v{templateVersion} remains unchanged. The new version receives the derived RMR fields and its own analysis file, run lineage, snapshot, and timestamp.</p></div><footer><button className="button button-secondary" onClick={() => setSaveAsOpen(false)} type="button">Cancel</button><button className="button button-accent" type="submit"><Save size={14} /> Save As v{templateVersion + 1}</button></footer></form></div> : null}
    </div>
  )
}
