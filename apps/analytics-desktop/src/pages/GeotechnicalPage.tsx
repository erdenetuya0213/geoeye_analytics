import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { useEffect, useMemo, useRef, useState } from 'react'
import { GeotechnicalResultsTable, type ResultStatusFilter } from './GeotechnicalResultsTable.js'
import { CompositeRuleEditor } from './CompositeRuleEditor.js'
import { saveRmrDataset } from '../data/savedRmrDatasets.js'
import {
  buildRmr76SourceSignature,
  calculateRmr76Intervals,
  RMR76_METHOD_DEFINITION,
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
import { geotechnicalDatabaseDraft, geotechnicalDatabaseDraftFileName } from '../data/geotechnicalDatabaseDraft.js'
import type { TabularImportInput } from '@geoeye/datapool-client'
import { useDurableAction } from '../state/useDurableAction.js'
import {
  buildSavedRmr76Run,
  readGeotechnicalDerivedDocument,
  saveRmr76DerivedFields,
} from '../data/geotechnicalDerivedStore.js'
import {
  buildDatabaseRmrSources,
  buildFieldLoggingRmrSources,
  buildLocalTabularRmrSources,
  isRmrColumnCompatible,
  isPointLoadColumn,
  rmrColumnLabel,
  rmrSourceOptionLabel,
  groupRmrSources,
  type DatabaseRmrSource,
  type Rmr76ParameterSourceMapping,
} from '../data/geotechnicalDatabase.js'
import { buildCompositeRmrDataset, type CompositeRules } from '../data/geotechnicalComposite.js'
import { prepareCompositePreview } from '../data/compositePreview.js'
import { saveSpatialViewRequest } from '../data/spatialViewStore.js'
import type { SectionId } from '../types.js'
import { usePersistentState } from '../state/persistentState.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'
import { effectiveDrillholes, type LocalProjectSnapshot, type LocalDrillholeDraft } from '../data/localProjectDb.js'

const cachedSources = new WeakMap<LocalProjectSnapshot, { draft: LocalDrillholeDraft | null; sources: DatabaseRmrSource[] }>()
const emptyComposite = buildCompositeRmrDataset([], {}, 'tunnel', { intervalLength: 3, startDepth: 0, boundarySourceId: '', population: 'mean' })

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
  return classification?.match(/^Class\s+(IV|III|II|I|V)\b/)?.[1] ?? '—'
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
    const cached = cachedSources.get(snapshot)
    const holeNames = new Map(effectiveDrillholes(snapshot, workspace.localDrillholeDraft).map((hole) => [hole.id, hole.name]))
    const sources = cached?.draft === workspace.localDrillholeDraft ? cached.sources : [
      ...buildDatabaseRmrSources(snapshot.datasets, snapshot.observations, snapshot.variables, holeNames),
      ...buildFieldLoggingRmrSources(snapshot.fieldLogging.datasets ?? [], holeNames),
    ]
    cachedSources.set(snapshot, { draft: workspace.localDrillholeDraft, sources })
    return [...sources, ...buildLocalTabularRmrSources(Object.values(workspace.localTabularDrafts), holeNames, new Set(sources.filter(source => source.sourceKind === 'field-template').flatMap(source => source.records.flatMap(record => record.holeId ? [record.holeId] : []))))]
  }, [workspace.live, workspace.localDrillholeDraft, workspace.localSnapshot, workspace.localTabularDrafts])
  if (!workspace.live) return <div className="page geotechnical-page"><div className="eda-state panel">No local project data is open.</div></div>
  if (workspace.projectsLoading || workspace.localLoading) return <div className="page geotechnical-page"><div className="eda-state panel">Opening local geotechnical data…</div></div>
  if (workspace.project === null) return <div className="page geotechnical-page"><div className="eda-state panel" role="alert">No project is available for this account.</div></div>
  if (workspace.localSnapshot === null) return <div className="page geotechnical-page"><div className="eda-state panel"><strong>No local project snapshot is available.</strong><button className="button button-accent" onClick={() => onNavigate('data-pool')} type="button">Open Data</button></div></div>
  return <GeotechnicalWorkbench databaseSave={{
    connected: workspace.connected, canWrite: workspace.project.canWrite,
    draft: workspace.localTabularDrafts.geotechnical,
    saveLocally: workspace.saveTabularImportLocally,
    publish: () => workspace.publishLocalTabularImport('geotechnical'),
  }} databaseSources={databaseSources} key={workspace.project.id} onNavigate={onNavigate} projectId={workspace.project.id} snapshotRevision={`${workspace.scope}:${workspace.localSnapshot.refreshedAt}:${workspace.localDrillholeDraft?.updatedAt ?? ''}`} tenantId={workspace.project.organizationId ?? '_unassigned'} />
}

function GeotechnicalWorkbench({ databaseSave, databaseSources, onNavigate, projectId, snapshotRevision, tenantId }: GeotechnicalPageProps & {
  databaseSave?: {
    connected: boolean
    canWrite: boolean
    draft: (TabularImportInput & { dirty: boolean }) | undefined
    saveLocally: (input: TabularImportInput) => Promise<void>
    publish: () => Promise<unknown>
  }
  databaseSources: readonly DatabaseRmrSource[]
  projectId: string
  snapshotRevision: string
  tenantId: string
}) {
  const queryClient = useQueryClient()
  const storage = useProjectStorage()
  const durable = useDurableAction()
  const publishingLock = useRef(false)
  const [publishing, setPublishing] = useState(false)
  const [databaseNotice, setDatabaseNotice] = useState<string | null>(null)
  const persistenceScope = projectId
  const [parameterMappings, setParameterMappings] = usePersistentState<Rmr76ParameterSourceMapping>('geotechnical.parameterSources.v2', {}, { scope: persistenceScope })
  const [excavationType, setExcavationType] = usePersistentState<ExcavationType>('geotechnical.excavationType', 'tunnel', { scope: persistenceScope })
  const [classificationId, setClassificationId] = usePersistentState<ClassificationId>('geotechnical.classificationId', 'rmr76')
  const [holeId, setHoleId] = usePersistentState('geotechnical.holeId', 'all', { scope: persistenceScope })
  const [depthRange, setDepthRange] = usePersistentState<DepthRange>('geotechnical.depthRange', 'all')
  const [compositeRules, setCompositeRules] = usePersistentState<CompositeRules>('geotechnical.compositeRules', { intervalLength: 3, startDepth: 0, boundarySourceId: '', population: 'mean' }, { scope: persistenceScope })
  const [meanFills, setMeanFills] = usePersistentState<Partial<Record<Rmr76CanonicalInputKey, boolean>>>('geotechnical.meanFills', {}, { scope: persistenceScope })
  const [storedRun, setRun] = usePersistentState<Rmr76CalculationRun | null>('geotechnical.run', null, { scope: persistenceScope })
  const [savedRunId, setSavedRunId] = usePersistentState<string | null>('geotechnical.savedRunId', null, { scope: persistenceScope })
  const [savedScenarioName, setSavedScenarioName] = usePersistentState('geotechnical.savedScenarioName', 'Geotechnical logging', { scope: persistenceScope })
  const [analysisName, setAnalysisName] = usePersistentState('geotechnical.analysisName', '', { scope: persistenceScope })
  const effectiveMapping = useMemo(() => {
    const sources = new Map(databaseSources.map((source) => [source.dataset.id, source]))
    return Object.fromEntries(RMR76_METHOD_DEFINITION.requiredInputs.flatMap((definition) => {
      const selection = parameterMappings[definition.key]
      if (selection === undefined) return []
      const source = sources.get(selection.sourceId)
      const column = source?.columns.find((item) => item.key === selection.columnKey)
      return column !== undefined && isRmrColumnCompatible(definition.key, column) ? [[definition.key, definition.key === 'geotech.ucs' && isPointLoadColumn(column) && (selection.strengthMode === undefined || String(selection.strengthMode) === 'point-load-proxy') ? { ...selection, strengthMode: 'point-load' } : selection]] : []
    })) as Rmr76ParameterSourceMapping
  }, [databaseSources, parameterMappings])
  const requiredInputs = RMR76_METHOD_DEFINITION.requiredInputs.filter(definition => definition.key !== 'structure.orientation_rating')
  const sourceNames = [...new Set(['structure.joint_spacing', 'geotech.rqd'].map(key => databaseSources.find(source => source.dataset.id === effectiveMapping[key as Rmr76CanonicalInputKey]?.sourceId)?.dataset.name).filter(Boolean))]
  const analysisLabel = analysisName.trim() || `RMR76 — ${sourceNames.join(' + ') || 'analysis'}`
  const holeLabels = useMemo(() => new Map(databaseSources.flatMap(source => [...source.holeNames])), [databaseSources])
  const run = useMemo(() => storedRun === null ? null : ({ ...storedRun,
    intervals: storedRun.intervals.map(interval => ({ ...interval, holeId: holeLabels.get(interval.holeId) ?? interval.holeId })),
  }), [storedRun, holeLabels])
  const mappingComplete = requiredInputs.every(definition => effectiveMapping[definition.key] !== undefined)
  const sourceRevision = databaseSources.map(source => `${source.dataset.id}:${source.dataset.currentVersion}:${source.dataset.updatedAt}`).join('|')
  const compositeQuery = useQuery({
    queryKey: ['geotech-composite-preview', projectId, snapshotRevision, sourceRevision, effectiveMapping, excavationType, compositeRules, meanFills, holeId, depthRange],
    queryFn: ({ signal }) => prepareCompositePreview({ sources: databaseSources, mapping: effectiveMapping, excavation: excavationType, rules: compositeRules, meanFills, holeId, depthRange }, signal),
    staleTime: Infinity,
  })
  const joinedDatabaseDataset = compositeQuery.data ?? emptyComposite
  const compositePending = compositeQuery.isPending || compositeQuery.isFetching
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
  const stale = run !== null && (run.sourceSignature !== sourceSignature || run.snapshotId !== dataset?.snapshotId)
  const [savedComponents, setSavedComponents] = usePersistentState<boolean | null>('geotechnical.savedComponents', null, { scope: persistenceScope })
  const isSaved = run !== null && savedRunId === run.runId && savedComponents === includeComponents && !stale
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
    setDatabaseNotice(null)
    setRun(null)
    setSavedRunId(null)
    setSelectedIntervalId(null)
  }

  const resetCalculation = () => {
    setDatabaseNotice(null)
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
      const column = databaseSources.find(source => source.dataset.id === selection?.sourceId)?.columns.find(item => item.key === columnKey)
      return {
        ...current,
        [key]: selection === undefined || columnKey === '' ? (selection === undefined ? undefined : { ...selection, columnKey: '' }) : { sourceId: selection.sourceId, columnKey, ...(key === 'geotech.ucs' ? { strengthMode: column?.key === 'field_strength' ? 'field-grade' as const : column !== undefined && isPointLoadColumn(column) ? 'point-load' as const : 'ucs' as const } : {}) },
      }
    })
    resetCalculation()
  }

  const changeExcavationType = (next: ExcavationType) => {
    setExcavationType(next)
    resetCalculation()
  }

  const calculate = () => {
    if (compositePending || !classification.ready || !mappingComplete || scopedIntervals.length === 0) return
    const next = calculateRmr76Intervals(scopedIntervals, selectedSourceIds, makeRunId(classificationId), new Date().toISOString(), dataset.snapshotId)
    setDatabaseNotice(null)
    setRun(next)
    setSavedRunId(null)
    setSelectedIntervalId(next.intervals[0]?.id ?? null)
    setActiveTab('result')
    setResultStatus('all')
    setIntervalDetailsOpen(false)
    document.getElementById('rmr-tab-result')?.focus()
  }

  const save = (createVersion: boolean) => durable.perform(async () => {
    if (run === null || stale || compositePending || publishingLock.current || run.intervals.length === 0) return
    const nextVersion = resolveAnalysisTemplateVersion(storage, {
      fallbackVersion: templateVersionFromId(dataset.targetTemplateId),
      mode: createVersion ? 'new-version' : 'overwrite',
      templateId: dataset.targetTemplateId,
    })
    const savedAt = new Date().toISOString()
    const versionLabel = `${analysisLabel} · v${nextVersion}`
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
      analysisPayload: { ...saved, calculationRun: run, rules: compositeRules, sourceMapping: effectiveMapping, meanFills, excavationType },
      boreholeIds,
      createdAt: savedAt,
      derivedFieldKeys: saved.fieldDefinitions.map((field) => field.key),
      feature: 'geotechnical',
      graphs: [...downholeGraphs, barGraphImage('rmr76-class-distribution', 'RMR76 class distribution', classCounts)],
      inputName: `${analysisLabel}-${holeId === 'all' ? 'all-boreholes' : holeId}-${depthRange}${includeComponents ? '-components' : ''}`,
      projectId,
      runId: run.runId,
      sourceFileName: `${analysisLabel}.json`,
      sourceObservationIds: saved.intervals.flatMap((interval) => interval.sourceLineage.map((lineage) => lineage.observationId)),
      templateId: dataset.targetTemplateId,
      templateVersion: nextVersion,
      tenantId,
    })
    const resultDraft = geotechnicalDatabaseDraft(run, includeComponents, analysisLabel)
    saveRmrDataset(storage, { id: saved.scenarioId, name: versionLabel, draft: { ...resultDraft, dirty: false, updatedAt: savedAt } })
    await databaseSave?.saveLocally(resultDraft)
    setSavedComponents(includeComponents)
    setDatabaseNotice(null)
    setSavedDocument(document)
    setSavedRunId(run.runId)
    setSavedScenarioName(versionLabel)
    setTemplateVersion(nextVersion)
    setSaveAsOpen(false)
    void queryClient.invalidateQueries({ queryKey: ['eda-datasets'] })
  })

  const saving = durable.notice?.startsWith('Saving') === true
  const databaseDraftMatches = run !== null && databaseSave?.draft?.fileName === geotechnicalDatabaseDraftFileName(run.runId, includeComponents, analysisLabel, run.calculatedAt)
  const databaseSaved = databaseDraftMatches && databaseSave?.draft?.dirty === false
  const databaseDisabledReason = saving ? 'Saving locally' : !databaseSave?.connected ? 'Connect to database' : !databaseSave.canWrite ? 'Read-only project' : stale || compositePending ? 'Recalculate first' : !run?.summary.valid ? 'No valid results' : !isSaved || !databaseDraftMatches ? 'Save first' : databaseSaved ? 'Saved to database' : null
  const publish = async () => {
    if (databaseDisabledReason !== null || databaseSave === undefined || publishingLock.current) return
    publishingLock.current = true
    setPublishing(true)
    setDatabaseNotice(null)
    try { await databaseSave.publish(); setDatabaseNotice('Saved to database') }
    catch (error) { setDatabaseNotice(`Database save failed: ${error instanceof Error ? error.message : String(error)}`) }
    finally { publishingLock.current = false; setPublishing(false) }
  }

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
          <button className="button button-accent geotech-primary-action" disabled={compositePending || !classification.ready || !mappingComplete || scopedIntervals.length === 0} onClick={calculate} title={!mappingComplete ? 'Map the five basic RMR76 inputs' : compositePending ? 'Preparing local intervals…' : scopedIntervals.length === 0 ? 'No matching intervals' : undefined} type="button"><Calculator size={15} /> {run === null || !stale ? 'Calculate' : 'Recalculate'}</button>
        </div>
        <div className="geotech-column-mapper" aria-label="RMR76 parameter column mapping">
            <header>
              <strong>Inputs</strong>
              <label><span>Excavation</span><select aria-label="RMR excavation type" onChange={(event) => changeExcavationType(event.target.value as ExcavationType)} value={excavationType}><option value="tunnel">Tunnel</option><option value="foundation">Foundation</option><option value="slope">Slope</option></select><ChevronDown size={13} /></label>
            </header>
            <div className="geotech-composite-rules" aria-label="Composite and boundary rules">
              <CompositeRuleEditor rules={compositeRules} sources={databaseSources} onChange={next => { setCompositeRules(next); resetCalculation() }} />
              <small>{joinedDatabaseDataset.dataset.intervals.length} composite intervals · {joinDiagnostics.matchedIntervalCount} ready.</small>
            </div>
            <div className="geotech-parameter-grid">{RMR76_METHOD_DEFINITION.requiredInputs.map((definition) => {
              const rawSelection = parameterMappings[definition.key]
              const selectedSource = databaseSources.find((source) => source.dataset.id === rawSelection?.sourceId)
              const sourceOptions = databaseSources
              const compatibleColumns = selectedSource?.columns ?? []
              const coverage = joinedDatabaseDataset.coverage[definition.key]
              return <div className={`geotech-parameter-source ${effectiveMapping[definition.key] === undefined ? 'is-unmapped' : 'is-mapped'}`} key={definition.key}><span>{definition.label}{definition.key === 'structure.orientation_rating' ? ' (optional)' : ''}{definition.unit === null ? '' : ` (${definition.unit})`}</span><label><small>Live template or imported data</small><select aria-label={`${definition.label} template`} onChange={(event) => changeParameterSource(definition.key, event.target.value)} value={selectedSource?.dataset.id ?? ''}><option value="">{definition.key === 'structure.orientation_rating' ? 'Not assessed · Basic RMR76' : 'Choose source…'}</option>{groupRmrSources(sourceOptions).map(group => <optgroup key={group.category} label={group.category}>{group.sources.map(source => <option key={source.dataset.id} value={source.dataset.id}>{rmrSourceOptionLabel(source, sourceOptions)}</option>)}</optgroup>)}</select><ChevronDown size={13} /></label><label><small>Value</small><select aria-label={`${definition.label} value`} disabled={selectedSource === undefined} onChange={(event) => changeParameterColumn(definition.key, event.target.value)} value={effectiveMapping[definition.key]?.columnKey ?? ''}><option value="">Choose value…</option>{compatibleColumns.map((column) => <option disabled={!isRmrColumnCompatible(definition.key, column)} key={column.key} value={column.key}>{rmrColumnLabel(column)} · {column.dataType}{isRmrColumnCompatible(definition.key, column) ? '' : ' · incompatible type'}</option>)}</select><ChevronDown size={13} /></label><footer>{effectiveMapping[definition.key] === undefined ? selectedSource === undefined ? definition.key === 'structure.orientation_rating' ? 'Optional · Basic RMR76 will be calculated' : `${sourceOptions.length} sources` : `${compatibleColumns.length} values` : `${coverage.covered} covered · ${coverage.missing - coverage.estimated} missing · ${coverage.estimated} estimated`}</footer>{effectiveMapping[definition.key] !== undefined && coverage.missing > 0 ? <div className="geotech-parameter-mean"><label><input type="checkbox" checked={meanFills[definition.key] === true} disabled={coverage.mean === null} onChange={(event) => { setMeanFills(current => ({ ...current, [definition.key]: event.target.checked })); resetCalculation() }} /> Use mean for missing {definition.label.toLowerCase()}</label><small>{coverage.mean === null ? 'Mean unavailable' : `Mean: ${coverage.mean.toFixed(2)} · ${coverage.samples} intervals`}</small></div> : null}</div>
            })}</div>
            {effectiveMapping['geotech.ucs'] !== undefined ? <div className="geotech-composite-rules">
              <label>Strength interpretation<select aria-label="Strength interpretation" value={effectiveMapping['geotech.ucs']?.strengthMode ?? 'ucs'} onChange={event => { const strengthMode = event.target.value as 'ucs' | 'point-load' | 'field-grade' | 'unconfirmed'; setParameterMappings(current => ({ ...current, 'geotech.ucs': { ...current['geotech.ucs']!, strengthMode, ucsFactor: undefined } })); resetCalculation() }}><option value="unconfirmed">Choose interpretation…</option><option value="field-grade">ISRM field grade · lower RMR rating</option><option value="ucs">Estimated UCS (MPa) · use directly</option><option value="point-load">Point-load Is(50) (MPa) · estimate UCS</option></select></label>
              <label>Strength fallback<select aria-label="Strength fallback" value={effectiveMapping['geotech.ucs']?.fallback?.sourceId ?? ''} onChange={event => { setParameterMappings(current => ({ ...current, 'geotech.ucs': { ...current['geotech.ucs']!, fallback: event.target.value ? { sourceId: event.target.value, columnKey: 'field_strength', strengthMode: 'field-grade' } : undefined } })); resetCalculation() }}><option value="">None</option>{databaseSources.filter(source => source.columns.some(column => column.key === 'field_strength')).map(source => <option key={source.dataset.id} value={source.dataset.id}>{source.dataset.name} · ISRM field grade</option>)}</select></label>
              {effectiveMapping['geotech.ucs']?.strengthMode === 'point-load' ? <label>UCS conversion factor<input aria-label="UCS conversion factor" type="number" min="0.001" step="any" value={effectiveMapping['geotech.ucs']?.ucsFactor ?? ''} onChange={event => { const ucsFactor = event.target.value === '' ? undefined : Number(event.target.value); setParameterMappings(current => ({ ...current, 'geotech.ucs': { ...current['geotech.ucs']!, ucsFactor } })); resetCalculation() }} /></label> : null}

            </div> : null}
          </div>

      </section>

      {compositeQuery.isError ? <p role="alert">Local interval preview failed: {compositeQuery.error.message}</p> : null}
      {compositePending ? <p role="status">Preparing intervals…</p> : null}
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
            <GeotechnicalResultsTable key={run.runId} intervals={run.intervals} holeLabels={holeLabels} selectedId={intervalDetailsOpen ? selectedResult?.id ?? null : null} onSelect={id => { setSelectedIntervalId(id); setIntervalDetailsOpen(true) }} status={resultStatus} onStatusChange={setResultStatus} />



          </main>

          <details className="panel rmr-interval-disclosure" open={intervalDetailsOpen} onToggle={event => setIntervalDetailsOpen(event.currentTarget.open)}><summary>Selected interval details <span>{selectedResult?.holeId} · {selectedResult === null ? '' : formatInterval(selectedResult.depthFrom, selectedResult.depthTo)}</span><ChevronDown size={14} /></summary><aside className="geotech-detail-panel">{selectedResult === null ? null : <><div className="panel-heading"><div><p className="eyebrow">Selected interval</p><h2>{formatInterval(selectedResult.depthFrom, selectedResult.depthTo)}</h2></div><strong className="geotech-detail-score">{selectedResult.calculation?.total ?? '—'}</strong></div><div className="geotech-detail-class"><span>{selectedResult.calculation?.classification ?? statusText(selectedResult)}</span><small>{selectedResult.holeId} · {selectedResult.lithology}</small></div>
            {selectedResult.status === 'missing' ? <div className="geotech-reason-card is-missing"><AlertTriangle size={14} /><span><strong>Missing: {selectedResult.missing.map(missingReason).join('; ')}</strong></span><button onClick={() => onNavigate('data-pool')} type="button">Open Database</button></div> : null}
            {selectedResult.status === 'excluded' ? <div className="geotech-reason-card"><AlertTriangle size={14} /><span><strong>Excluded: {selectedResult.exclusionReason}</strong><small>Source: {selectedResult.exclusionSource ?? 'Database quality rule'}</small></span></div> : null}
            <dl className="geotech-component-list"><div className="geotech-component-heading"><dt>Basic RMR</dt><dd>{selectedResult.calculation?.basic ?? '—'}</dd></div>{(['strength', 'rqd', 'jointSpacing', 'jointCondition', 'groundwater'] as const).map((key) => <div key={key}><dt>{componentLabels[key]}</dt><dd>{scoreFor(selectedResult, key) === null ? '—' : `${scoreFor(selectedResult, key)} pts`}</dd></div>)}<div className="geotech-component-heading"><dt>Orientation adjustment</dt><dd>{scoreFor(selectedResult, 'orientation') === null ? 'Not assessed' : `${scoreFor(selectedResult, 'orientation')} pts`}</dd></div><div className="is-total"><dt>{selectedResult.calculation === null ? 'RMR76 · not calculated' : selectedResult.calculation.ratingBasis === 'basic' ? 'Basic RMR76' : 'Adjusted RMR76'}</dt><dd>{selectedResult.calculation?.total ?? '—'}</dd></div><div className="is-class"><dt>Class</dt><dd>{selectedResult.calculation?.classification ?? '—'}</dd></div></dl>
            <div className="geotech-lineage"><h3>Source lineage</h3>{selectedResult.lineage.map((lineage) => <div key={`${lineage.canonicalKey}-${lineage.observationId}`}><CircleDot size={11} /><span><strong>{lineage.canonicalKey}</strong><small>{lineage.sourceLabel} · {lineage.sourceFieldId}</small></span><b>{availabilityDisplay[lineage.availability].symbol}</b></div>)}</div></>}</aside></details>
        </div>

        <section className="panel geotech-save-strip">
          <span>{isSaved ? 'Saved locally' : 'Unsaved'}</span>
          <label>Analysis name<input aria-label="Analysis name" value={analysisName} placeholder={analysisLabel} onChange={event => { setAnalysisName(event.target.value); setSavedRunId(null) }} /></label>
          <label><input checked={includeComponents} disabled={publishing} onChange={event => { setIncludeComponents(event.target.checked); setDatabaseNotice(null) }} type="checkbox" /> Component ratings</label>
          <button className="button button-secondary" disabled={stale || compositePending || publishing || saving} onClick={() => setSaveAsOpen(true)} type="button">Save As</button>
          <button className="button button-secondary" disabled={stale || compositePending || publishing || saving} onClick={() => save(false)} type="button"><Save size={14} /> Save</button>
          <button className="button button-accent" disabled={publishing || databaseDisabledReason !== null} title={databaseDisabledReason ?? undefined} onClick={() => void publish()} type="button"><Database size={14} />{publishing ? 'Saving…' : 'Save to database'}</button>
          {databaseNotice ? <span role="status">{databaseNotice}</span> : databaseDisabledReason && databaseDisabledReason !== 'Save first' ? <span>{databaseDisabledReason}</span> : null}
        </section>
        {isSaved ? <section className="panel geotech-saved-strip"><CheckCircle2 size={17} /><span><strong>Saved · {savedScenarioName}</strong></span><div className="geotech-after-save-actions"><button className="button button-secondary" onClick={() => onNavigate('explore')} type="button"><BarChart3 size={14} /> Open in Statistics</button><button className="button button-secondary" onClick={() => onNavigate('domain')} type="button"><Layers3 size={14} /> Open in Domain</button><button className="button button-secondary" onClick={() => openSpatial('plan')} type="button"><MapIcon size={14} /> View in 2D</button><button className="button button-secondary" onClick={() => openSpatial('isometric')} type="button"><Box size={14} /> View in 3D</button></div></section> : null}
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
