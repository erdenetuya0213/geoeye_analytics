import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Box, CheckCircle2, ChevronDown, CopyPlus, Database, GitBranch, Layers3, Play, RefreshCw, Save, ScatterChart, TableProperties, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildMultivariateRunRequest,
  multivariateConfigurationSignature,
  type MultivariateConfiguration,
  type MultivariateCorrelationMethod,
  type MultivariateMissingPolicy,
  type MultivariateRunRequest,
  type MultivariateRunResult,
  type MultivariateScaling,
} from '../analysis/multivariateEngine.js'
import { useMultivariateEngine } from '../analysis/useMultivariateEngine.js'
import { GeoEyeChart } from '../components/GeoEyeChart.js'
import { EdaDatasetOptions } from '../components/EdaDatasetOptions.js'
import { type EdaDataset, type EdaVariableDefinition } from '../data/edaTypes.js'
import { useProjectEdaDatasets } from '../data/liveEda.js'
import { currentAnalysisTemplateVersion, recordAnalysisTemplateSave, resolveAnalysisTemplateVersion } from '../data/analysisSaveStore.js'
import { barGraphImage, scatterGraphImage } from '../data/analysisGraphImages.js'
import { saveAnalysisResultPackage } from '../data/analysisResultStore.js'
import { useDurableAction } from '../state/useDurableAction.js'
import { saveMultivariateDerivedVariables } from '../data/multivariateDerivedStore.js'
import { saveMultivariateDomainEvidence } from '../data/multivariateEvidenceStore.js'
import { saveSpatialViewRequest } from '../data/spatialViewStore.js'
import { useGeoEyeSelection } from '../state/SelectionContext.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import type { SectionId } from '../types.js'
import { usePersistentState } from '../state/persistentState.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'
import {
  buildClusterProfilesOption,
  buildClusterScoresOption,
  buildExplainedVarianceOption,
  buildGroupComparisonOption,
  buildLoadingsOption,
  buildMultivariateCorrelationOption,
  buildPcaScoresOption,
} from '../visualization/multivariateCharts.js'

type MultivariateView = 'overview' | 'pca' | 'clusters' | 'detail'

const scalingLabels: Record<MultivariateScaling, string> = { none: 'None (raw units)', robust: 'Robust (median / IQR)', standard: 'Standardize (z-score)' }
const missingLabels: Record<MultivariateMissingPolicy, string> = { 'complete-case': 'Complete cases', 'median-impute': 'Median imputation' }
const clusterColors = ['#25887c', '#c7732d', '#6d5a9b', '#5488a5', '#70a58e', '#b06f7b', '#9d874d', '#537067']

function nextRunNumber(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const key = 'geoeye.analytics.multivariate-run-number.v1'
  const current = Number.parseInt(storage.getItem(key) ?? '0', 10)
  const next = Number.isFinite(current) ? current + 1 : 1
  storage.setItem(key, String(next))
  return next
}

function dimensionValues(dataset: EdaDataset, key: string) {
  return Array.from(new Set(dataset.observations.flatMap((observation) => observation.dimensions[key] === undefined ? [] : [observation.dimensions[key]]))).sort()
}

function selectedVariables(dataset: EdaDataset, keys: readonly string[]) {
  return keys.flatMap((key) => {
    const variable = dataset.variables.find((candidate) => candidate.key === key)
    return variable === undefined ? [] : [variable]
  })
}

function dimensionLabel(dataset: EdaDataset | undefined, key: string | null) {
  if (key === null) return 'all observations'
  if (key === 'cluster') return 'Cluster'
  if (key === 'drillhole') return 'Hole'
  return dataset?.dimensions.find((dimension) => dimension.key === key)?.label ?? key.replaceAll('_', ' ')
}

function comparisonDimensions(dataset: EdaDataset | undefined) {
  if (dataset === undefined) return []
  return dataset.dimensions.filter((dimension) => dimensionValues(dataset, dimension.key).length > 0)
}

function clusterIsSmall(count: number, total: number) {
  return count < Math.max(10, Math.ceil(total * 0.03))
}

function clusterProfile(centroid: readonly number[], variables: readonly EdaVariableDefinition[]) {
  const values = variables.map((variable, index) => ({ label: variable.shortLabel, value: centroid[index] ?? 0 }))
  const high = [...values].sort((left, right) => right.value - left.value).slice(0, 2).map((item) => item.label)
  const low = [...values].sort((left, right) => left.value - right.value).slice(0, 2).map((item) => item.label)
  return { high, low }
}

function ChartCard({ actions, children, className = '', detail, title }: { actions?: React.ReactNode; children: React.ReactNode; className?: string; detail: string; title: string }) {
  return <section className={`eda-chart-card mv-chart-card ${className}`.trim()}><header><div><h3>{title}</h3><p>{detail}</p></div>{actions === undefined ? null : <div className="mv-chart-header-actions">{actions}</div>}</header><div className="eda-plot">{children}</div></section>
}

interface MultivariatePageProps {
  onNavigate: (section: SectionId) => void
}

export function MultivariatePage({ onNavigate }: MultivariatePageProps) {
  const storage = useProjectStorage()
  const durable = useDurableAction()
  const workspace = useDataPoolWorkspace()
  const queryClient = useQueryClient()
  const datasetsQuery = useProjectEdaDatasets()
  const [datasetId, setDatasetId] = usePersistentState('multivariate.datasetId', '')
  const [variableKeys, setVariableKeys] = usePersistentState<string[]>('multivariate.variableKeys', ['assay.au', 'assay.cu', 'assay.as', 'geotech.rqd', 'geotech.ucs'])
  const [activeFilterKeys, setActiveFilterKeys] = usePersistentState<string[]>('multivariate.activeFilterKeys', [])
  const [filterValues, setFilterValues] = usePersistentState<Record<string, string>>('multivariate.filterValues', {})
  const [scaling, setScaling] = usePersistentState<MultivariateScaling>('multivariate.scaling', 'standard')
  const [missingPolicy, setMissingPolicy] = usePersistentState<MultivariateMissingPolicy>('multivariate.missingPolicy', 'complete-case')
  const [clusterCount, setClusterCount] = usePersistentState('multivariate.clusterCount', 3)
  const [groupBy, setGroupBy] = usePersistentState<string | null>('multivariate.groupBy', 'lithology')
  const [secondGroup, setSecondGroup] = usePersistentState<string | null>('multivariate.secondGroup', null)
  const [view, setView] = usePersistentState<MultivariateView>('multivariate.view', 'overview')
  const [submittedRequest, setSubmittedRequest] = useState<MultivariateRunRequest | null>(null)
  const [activeRun, setActiveRun] = usePersistentState<MultivariateRunResult | null>('multivariate.activeRun', null)
  const [displayCorrelation, setDisplayCorrelation] = usePersistentState<MultivariateCorrelationMethod>('multivariate.displayCorrelation', 'pearson')
  const [comparisonBy, setComparisonBy] = usePersistentState('multivariate.comparisonBy', 'lithology')
  const [pcaX, setPcaX] = usePersistentState('multivariate.pcaX', 0)
  const [pcaY, setPcaY] = usePersistentState('multivariate.pcaY', 1)
  const [pcaColorBy, setPcaColorBy] = usePersistentState('multivariate.pcaColorBy', 'lithology')
  const [showBiplot, setShowBiplot] = usePersistentState('multivariate.showBiplot', false)
  const [saveClusters, setSaveClusters] = usePersistentState('multivariate.saveClusters', true)
  const [saveClusterMetrics, setSaveClusterMetrics] = usePersistentState('multivariate.saveClusterMetrics', false)
  const [savedPcaComponents, setSavedPcaComponents] = usePersistentState<number[]>('multivariate.savedPcaComponents', [0, 1])
  const [savedRunId, setSavedRunId] = usePersistentState<string | null>('multivariate.savedRunId', null)
  const [savedTemplateVersion, setSavedTemplateVersion] = usePersistentState<number | null>('multivariate.savedTemplateVersion', null)
  const [evidenceCluster, setEvidenceCluster] = usePersistentState<number | null>('multivariate.evidenceCluster', null)
  const [hasRun, setHasRun] = usePersistentState('multivariate.hasRun', false)
  const autoRunRequestedRef = useRef(false)
  // True while the automatic run only rebuilds a result whose view state was restored.
  const restoringRunRef = useRef(false)
  const { clearSelection, replaceSelection, selectedIds, toggleSelection } = useGeoEyeSelection()
  const runEngine = useMultivariateEngine(submittedRequest)
  const datasets = datasetsQuery.data ?? []
  const dataset = datasets.find((candidate) => candidate.id === datasetId) ?? datasets[0]
  const effectiveVariableKeys = dataset === undefined ? [] : variableKeys.filter((key) => dataset.variables.some((variable) => variable.key === key && variable.dataType !== 'category'))

  const draftConfiguration = useMemo((): MultivariateConfiguration | null => dataset === undefined ? null : ({
    activeFilterKeys, clusterCount, correlationMethod: 'pearson', datasetId: dataset.id, datasetName: dataset.name, filterValues,
    groupBy, method: 'full', missingPolicy, scaling, secondGroup: groupBy === null ? null : secondGroup, snapshotAt: dataset.snapshotAt, supportLabel: dataset.support, variableKeys: effectiveVariableKeys,
  }), [activeFilterKeys, clusterCount, dataset, effectiveVariableKeys, filterValues, groupBy, missingPolicy, scaling, secondGroup])
  const draftSignature = draftConfiguration === null ? null : multivariateConfigurationSignature(draftConfiguration)
  const configurationChanged = activeRun !== null && activeRun.configurationSignature !== draftSignature

  useEffect(() => {
    if (dataset === undefined || dataset.source !== 'live') return
    const numericKeys = dataset.variables.filter((variable) => variable.dataType !== 'category').map((variable) => variable.key)
    const validKeys = variableKeys.filter((key) => numericKeys.includes(key))
    const datasetChanged = datasetId !== dataset.id
    if (datasetChanged) setDatasetId(dataset.id)
    if (validKeys.length < Math.min(2, numericKeys.length)) setVariableKeys(numericKeys.slice(0, 6))
    else if (validKeys.length !== variableKeys.length) setVariableKeys(validKeys)
    if (groupBy !== null && !dataset.dimensions.some((dimension) => dimension.key === groupBy)) setGroupBy(dataset.dimensions[0]?.key ?? null)
    if (secondGroup !== null && (groupBy === null || !dataset.dimensions.some((dimension) => dimension.key === secondGroup) || secondGroup === groupBy)) setSecondGroup(null)
    if (datasetChanged) {
      autoRunRequestedRef.current = false
      setSubmittedRequest(null)
      setActiveRun(null)
      setHasRun(false)
      setGroupBy(dataset.dimensions.find((dimension) => dimension.key === 'lithology')?.key ?? dataset.dimensions[0]?.key ?? null)
      setSecondGroup(null)
    }
  }, [dataset, datasetId, groupBy, secondGroup, variableKeys])

  useEffect(() => {
    if (runEngine.result === null) return
    setActiveRun(runEngine.result)
    setHasRun(true)
    if (restoringRunRef.current) {
      restoringRunRef.current = false
      return
    }
    setDisplayCorrelation(runEngine.result.configuration.correlationMethod)
    setComparisonBy(runEngine.result.configuration.groupBy ?? 'lithology')
    setPcaColorBy(runEngine.result.configuration.groupBy ?? 'cluster')
    setPcaX(0)
    setPcaY(Math.min(1, runEngine.result.pca.componentCount - 1))
    setSavedPcaComponents([0, Math.min(1, runEngine.result.pca.componentCount - 1)].filter((value, index, values) => values.indexOf(value) === index))
    setView('overview')
    setSavedRunId(null)
    setSavedTemplateVersion(null)
    setEvidenceCluster(null)
    clearSelection()
  }, [clearSelection, runEngine.result])

  useEffect(() => {
    if (autoRunRequestedRef.current || draftConfiguration === null || dataset === undefined || activeRun !== null || submittedRequest !== null || draftConfiguration.variableKeys.length < 2) return
    autoRunRequestedRef.current = true
    restoringRunRef.current = hasRun
    const runNumber = typeof window === 'undefined' ? 1 : nextRunNumber(storage)
    setSubmittedRequest(buildMultivariateRunRequest(draftConfiguration, dataset, runNumber))
  }, [activeRun, dataset, draftConfiguration, submittedRequest])

  if (datasetsQuery.isPending) return <div className="page multivariate-page"><div className="eda-state panel">Opening the local analytical database…</div></div>
  if (datasetsQuery.isError) return <div className="page multivariate-page"><div className="eda-state panel">The local analytical database could not be opened.</div></div>
  if (dataset === undefined) return <div className="page multivariate-page"><div className="eda-state panel">The local database is ready. Import a CSV or drillhole collar/survey to start an analysis.</div></div>

  const draftVariables = selectedVariables(dataset, variableKeys)
  const runDataset = datasets.find((candidate) => candidate.id === activeRun?.configuration.datasetId)
  const runVariables = runDataset === undefined || activeRun === null ? [] : selectedVariables(runDataset, activeRun.configuration.variableKeys)
  const selectedSet = new Set(selectedIds)
  const availableFilters = dataset.dimensions.filter((dimension) => !activeFilterKeys.includes(dimension.key))
  const comparisonOptions = comparisonDimensions(runDataset)
  const componentOptions = activeRun === null ? [] : Array.from({ length: activeRun.pca.componentCount }, (_, index) => index)
  const currentTemplateVersion = activeRun === null || typeof window === 'undefined'
    ? 1
    : currentAnalysisTemplateVersion(storage, activeRun.configuration.datasetId, 1)
  const smallClusters = activeRun === null ? [] : activeRun.clustering.counts.flatMap((count, index) => clusterIsSmall(count, activeRun.missing.analysisCount) ? [index + 1] : [])
  const orderedRows = activeRun === null ? [] : [...activeRun.rows].sort((left, right) => {
    const leftSelected = left.sourceObservationIds.some((id) => selectedSet.has(id))
    const rightSelected = right.sourceObservationIds.some((id) => selectedSet.has(id))
    return Number(rightSelected) - Number(leftSelected)
  })

  const changeDataset = (nextId: string) => {
    const next = datasets.find((candidate) => candidate.id === nextId)
    if (next === undefined) return
    const numeric = next.variables.filter((variable) => variable.dataType !== 'category').slice(0, 6)
    setDatasetId(next.id)
    setVariableKeys(numeric.map((variable) => variable.key))
    setActiveFilterKeys([])
    setFilterValues({})
    setGroupBy(next.dimensions.find((dimension) => dimension.key === 'lithology')?.key ?? next.dimensions[0]?.key ?? null)
    setSecondGroup(null)
    clearSelection()
  }
  const toggleVariable = (key: string) => {
    setVariableKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key])
    clearSelection()
  }
  const addFilter = (key: string) => {
    if (key === '' || activeFilterKeys.includes(key)) return
    setActiveFilterKeys((current) => [...current, key])
    setFilterValues((current) => ({ ...current, [key]: 'all' }))
  }
  const removeFilter = (key: string) => {
    setActiveFilterKeys((current) => current.filter((candidate) => candidate !== key))
    setFilterValues((current) => Object.fromEntries(Object.entries(current).filter(([candidate]) => candidate !== key)))
    clearSelection()
  }
  const runAnalysis = () => {
    if (draftConfiguration === null || draftConfiguration.variableKeys.length < 2 || runEngine.pending) return
    restoringRunRef.current = false
    const runNumber = typeof window === 'undefined' ? (activeRun?.runNumber ?? 0) + 1 : nextRunNumber(storage)
    setSubmittedRequest(buildMultivariateRunRequest(draftConfiguration, dataset, runNumber))
  }
  const toggleSavedComponent = (component: number) => {
    setSavedPcaComponents((current) => current.includes(component) ? current.filter((candidate) => candidate !== component) : [...current, component].sort())
  }
  const saveDerived = (createVersion: boolean) => durable.perform(async () => {
    if (activeRun === null || workspace.project === null || typeof window === 'undefined' || (!saveClusters && savedPcaComponents.length === 0 && !saveClusterMetrics)) return
    const templateId = activeRun.configuration.datasetId
    const templateVersion = resolveAnalysisTemplateVersion(storage, {
      fallbackVersion: 1,
      mode: createVersion ? 'new-version' : 'overwrite',
      templateId,
    })
    const savedAt = new Date().toISOString()
    const analysisFileId = `multivariate/${templateId}/v${templateVersion}.json`
    const document = saveMultivariateDerivedVariables(storage, activeRun, {
      clusterMetrics: saveClusterMetrics,
      clusters: saveClusters,
      pcaComponents: savedPcaComponents,
      templateId,
      templateVersion,
    }, savedAt)
    const derivedFieldKeys = document.fields
      .filter((field) => field.templateId === templateId && field.templateVersion === templateVersion)
      .map((field) => field.key)
    recordAnalysisTemplateSave(storage, {
      analysisFileId,
      derivedFieldKeys,
      feature: 'multivariate',
      runId: activeRun.runId,
      savedAt,
      templateId,
      templateVersion,
    })
    await saveAnalysisResultPackage(storage, {
      analysisFileId,
      analysisPayload: activeRun,
      boreholeIds: activeRun.rows.flatMap((row) => row.holeId === undefined ? [] : [row.holeId]),
      createdAt: savedAt,
      derivedFieldKeys,
      feature: 'multivariate',
      graphs: [
        barGraphImage('pca-explained-variance', 'PCA explained variance', activeRun.pca.explainedVarianceRatio.map((value, index) => ({ label: `PC${index + 1}`, value: value * 100 }))),
        barGraphImage('cluster-counts', 'Multivariate cluster counts', activeRun.clustering.counts.map((value, index) => ({ label: `Cluster ${index + 1}`, value }))),
        scatterGraphImage('pca-scores', 'PCA scores · PC1 / PC2', activeRun.rows.map((row) => ({ x: row.scores[0] ?? 0, y: row.scores[1] ?? 0 }))),
      ],
      inputName: activeRun.configuration.variableKeys.join('-'),
      projectId: workspace.project.id,
      runId: activeRun.runId,
      sourceFileName: `${activeRun.configuration.datasetName}.json`,
      sourceObservationIds: activeRun.rows.flatMap((row) => row.sourceObservationIds),
      templateId,
      templateVersion,
      tenantId: workspace.project.organizationId ?? '_unassigned',
    })
    setSavedRunId(activeRun.runId)
    setSavedTemplateVersion(templateVersion)
    void queryClient.invalidateQueries({ queryKey: ['eda-datasets'] })
  })
  const selectCluster = (cluster: number) => {
    if (activeRun === null) return
    replaceSelection(activeRun.rows.filter((row) => row.cluster === cluster).flatMap((row) => row.sourceObservationIds))
  }
  const compareClusterGeology = (cluster: number) => {
    selectCluster(cluster)
    setComparisonBy(runDataset?.dimensions.some((dimension) => dimension.key === 'lithology') ? 'lithology' : comparisonOptions[0]?.key ?? 'drillhole')
    setView('overview')
  }
  const sendDomainEvidence = (cluster: number) => {
    if (activeRun === null || typeof window === 'undefined') return
    saveMultivariateDomainEvidence(storage, activeRun, [cluster])
    setEvidenceCluster(cluster)
    selectCluster(cluster)
    onNavigate('domain')
  }
  const openCentralView = (cluster?: number) => {
    if (activeRun === null || typeof window === 'undefined') return
    const ids = cluster === undefined
      ? [...selectedIds]
      : activeRun.rows.filter((row) => row.cluster === cluster).flatMap((row) => row.sourceObservationIds)
    replaceSelection(ids)
    saveSpatialViewRequest(storage, {
      colorBy: cluster === undefined ? 'lithology' : 'candidate',
      datasetId: activeRun.configuration.datasetId,
      label: `Multivariate Run #${String(activeRun.runNumber).padStart(2, '0')}${cluster === undefined ? ' · linked selection' : ` · Cluster C${cluster}`}`,
      sourceModule: 'multivariate',
      sourceObservationIds: ids,
    })
    onNavigate('view-3d')
  }

  const tabItems: Array<{ icon: React.ReactNode; id: MultivariateView; label: string }> = [
    { icon: <TableProperties size={15} />, id: 'overview', label: 'Overview' },
    { icon: <ScatterChart size={15} />, id: 'pca', label: 'PCA' },
    { icon: <Layers3 size={15} />, id: 'clusters', label: 'Clusters' },
    { icon: <Database size={15} />, id: 'detail', label: 'Rows & provenance' },
  ]

  const linkedActions = <div className="mv-linked-actions">
    <button className="button button-secondary" disabled={selectedIds.length === 0} onClick={() => setView('detail')} type="button">Linked rows</button>
    <button className="button button-secondary" disabled={selectedIds.length === 0} onClick={() => openCentralView()} type="button">Open 3D Analysis</button>
  </div>

  return <div className="page multivariate-page">
    {durable.notice ? <p role="status">{durable.notice}</p> : null}
    <h1 className="sr-only">Multivariate analysis</h1>
    <div className="analysis-toolbar eda-toolbar mv-toolbar">
      <label className="tool-select tool-select-field mv-dataset-select"><span>Dataset snapshot</span><select aria-label="Multivariate dataset" onChange={(event) => changeDataset(event.target.value)} value={dataset.id}><EdaDatasetOptions datasets={datasets} /></select><ChevronDown size={14} /></label>
      <details className="eda-variable-picker mv-variable-picker"><summary aria-label="Select multivariate variables"><span>Variables</span><strong>{draftVariables.length} selected</strong><ChevronDown size={14} /></summary><div><div className="mv-picker-heading"><span>Numeric inputs</span><small>Choose 2–10</small></div>{dataset.variables.filter((item) => item.dataType !== 'category').map((item) => <label key={item.key}><input checked={variableKeys.includes(item.key)} disabled={!variableKeys.includes(item.key) && variableKeys.length >= 10} onChange={() => toggleVariable(item.key)} type="checkbox" /><span><strong>{item.shortLabel}</strong><small>{item.label} · {item.unit}</small></span>{item.origin === 'derived' ? <em>Derived</em> : null}</label>)}<div className="mv-picker-heading"><span>Categorical context</span><small>Initial comparison</small></div>{dataset.dimensions.map((dimension) => <label key={dimension.key}><input checked={groupBy === dimension.key} onChange={() => { setGroupBy(dimension.key); if (secondGroup === dimension.key) setSecondGroup(null) }} type="radio" /><span><strong>{dimension.label}</strong><small>Retained for population comparison</small></span></label>)}</div></details>
      {activeFilterKeys.map((key) => { const dimension = dataset.dimensions.find((candidate) => candidate.key === key); if (dimension === undefined) return null; return <div className="eda-filter-control" key={key}><label className="tool-select tool-select-field"><span>{dimension.label}</span><select aria-label={`Filter by ${dimension.label}`} onChange={(event) => { setFilterValues((current) => ({ ...current, [key]: event.target.value })); clearSelection() }} value={filterValues[key] ?? 'all'}><option value="all">All</option>{dimensionValues(dataset, key).map((value) => <option key={value} value={value}>{value}</option>)}</select><ChevronDown size={14} /></label><button aria-label={`Remove ${dimension.label} filter`} onClick={() => removeFilter(key)} type="button"><X size={13} /></button></div> })}
      {availableFilters.length > 0 ? <label className="tool-select tool-select-field eda-add-filter"><span>Filters</span><select aria-label="Add multivariate filter" onChange={(event) => { addFilter(event.target.value); event.target.value = '' }} value=""><option value="">Add filter…</option>{availableFilters.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select><ChevronDown size={14} /></label> : null}
      <label className="tool-select tool-select-field"><span>Compare by</span><select aria-label="Multivariate primary grouping dimension" onChange={(event) => { const value = event.target.value || null; setGroupBy(value); if (value === null || value === secondGroup) setSecondGroup(null) }} value={groupBy ?? ''}><option value="">None</option>{dataset.dimensions.map((dimension) => <option key={dimension.key} value={dimension.key}>{dimension.label}</option>)}</select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field"><span>Second group</span><select aria-label="Multivariate second grouping dimension" disabled={groupBy === null} onChange={(event) => setSecondGroup(event.target.value || null)} value={secondGroup ?? ''}><option value="">None</option>{dataset.dimensions.filter((dimension) => dimension.key !== groupBy).map((dimension) => <option key={dimension.key} value={dimension.key}>{dimension.label}</option>)}</select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field"><span>Scaling</span><select aria-label="Scaling method" onChange={(event) => setScaling(event.target.value as MultivariateScaling)} value={scaling}>{Object.entries(scalingLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field"><span>Missing data</span><select aria-label="Missing data handling" onChange={(event) => setMissingPolicy(event.target.value as MultivariateMissingPolicy)} value={missingPolicy}>{Object.entries(missingLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field mv-cluster-count"><span>Clusters (k)</span><select aria-label="Cluster count" onChange={(event) => setClusterCount(Number(event.target.value))} value={clusterCount}>{Array.from({ length: 7 }, (_, index) => index + 2).map((value) => <option key={value} value={value}>{value}</option>)}</select><ChevronDown size={14} /></label>
      <div className={`eda-run-control ${configurationChanged ? 'is-stale' : ''}`}>{activeRun === null ? null : <span>{configurationChanged ? 'Configuration changed' : `Run #${String(activeRun.runNumber).padStart(2, '0')} · Up to date`}</span>}<button className="primary-button" disabled={runEngine.pending || variableKeys.length < 2} onClick={runAnalysis} type="button">{runEngine.pending ? <RefreshCw className="is-spinning" size={13} /> : <Play size={13} />}{runEngine.pending ? 'Running locally…' : activeRun === null ? 'Run analysis' : configurationChanged ? 'Update analysis' : 'Run again'}</button></div>
    </div>

    <div className="eda-view-tabs mv-view-tabs" role="tablist" aria-label="Multivariate results">
      {tabItems.map((tab) => <button aria-selected={view === tab.id} className={view === tab.id ? 'is-active' : ''} key={tab.id} onClick={() => setView(tab.id)} role="tab" type="button">{tab.icon}<strong>{tab.label}</strong></button>)}
      <span className="mv-run-method">Patterns → candidate populations → Domain validation</span>
      <span className="mv-selection-status"><strong>{selectedIds.length}</strong> linked{selectedIds.length > 0 ? <button aria-label="Clear linked selection" onClick={clearSelection} type="button"><X size={12} /></button> : null}</span>
    </div>

    {runEngine.error === null ? null : <div className="mv-error" role="alert"><AlertTriangle size={15} /> {runEngine.error}</div>}
    {activeRun === null ? <section className="panel eda-run-empty mv-empty"><GitBranch size={23} /><div><h2>{runEngine.pending ? 'Building the multivariate workspace…' : 'Find multivariable population structure'}</h2><p>{runEngine.pending ? 'The GeoEye engine is calculating correlation, PCA, and clusters from the selected analysis snapshot.' : 'Find relationships and candidate statistical populations for later geological and spatial validation in Domain Analysis.'}</p><span>{draftVariables.length} variables · {dataset.observations.length.toLocaleString()} source rows · IDs retained</span></div><button className="primary-button" disabled={runEngine.pending || variableKeys.length < 2} onClick={runAnalysis} type="button">{runEngine.pending ? <RefreshCw className="is-spinning" size={13} /> : <Play size={13} />}{runEngine.pending ? 'Running analysis…' : 'Run analysis'}</button></section> : <>
      {view === 'overview' ? <div className="mv-overview">
        <section className="mv-kpi-grid">
          <article><span>Analysis rows</span><strong>{activeRun.missing.analysisCount.toLocaleString()}</strong><small>{activeRun.missing.excludedOrImputedCount.toLocaleString()} {activeRun.configuration.missingPolicy === 'median-impute' ? 'imputed' : 'excluded'}</small></article>
          <article><span>Variables</span><strong>{activeRun.configuration.variableKeys.length}</strong><small>{activeRun.configuration.scaling === 'standard' ? 'Standardized' : scalingLabels[activeRun.configuration.scaling]}</small></article>
          <article><span>Variance · PC1 + PC2</span><strong>{((activeRun.pca.cumulativeVarianceRatio[1] ?? activeRun.pca.cumulativeVarianceRatio[0] ?? 0) * 100).toFixed(1)}%</strong><small>{activeRun.pca.componentCount} components calculated</small></article>
          <article className={smallClusters.length > 0 ? 'has-warning' : ''}><span>K-means populations</span><strong>{activeRun.clustering.clusterCount}</strong><small>{smallClusters.length > 0 ? `Cluster ${smallClusters.join(', ')} may be unstable` : activeRun.clustering.counts.map((count) => count.toLocaleString()).join(' · ') + ' rows'}</small></article>
        </section>
        <section className="panel mv-overview-grid">
          <ChartCard actions={<div className="mv-chart-actions"><div className="segmented-control" role="group" aria-label="Correlation coefficient">{(['pearson', 'spearman'] as const).map((item) => <button className={displayCorrelation === item ? 'is-active' : ''} key={item} onClick={() => setDisplayCorrelation(item)} type="button">{item === 'pearson' ? 'Pearson' : 'Spearman'}</button>)}</div></div>} detail="Coefficients shown in every cell · hover for pair count" title="Correlation matrix"><GeoEyeChart ariaLabel="Multivariate correlation matrix" clickSelection="replace" option={buildMultivariateCorrelationOption(activeRun, runVariables, displayCorrelation)} renderer="svg" /></ChartCard>
          <ChartCard detail="Individual and cumulative explained variance" title="PCA variance"><GeoEyeChart ariaLabel="PCA explained variance" option={buildExplainedVarianceOption(activeRun)} /></ChartCard>
          <ChartCard actions={<label className="mv-inline-select"><span>Compare by</span><select aria-label="Compare cluster proportions by" onChange={(event) => setComparisonBy(event.target.value)} value={comparisonBy}>{comparisonOptions.map((dimension) => <option key={dimension.key} value={dimension.key}>{dimensionLabel(runDataset, dimension.key)}</option>)}</select></label>} detail={`Do clusters correspond to known ${dimensionLabel(runDataset, comparisonBy).toLowerCase()} populations?`} title="Population comparison"><GeoEyeChart ariaLabel="Cluster population comparison" clickSelection="replace" option={buildGroupComparisonOption(activeRun, comparisonBy)} /></ChartCard>
        </section>
      </div> : null}

      {view === 'pca' ? <div className="panel mv-pca-view">
        <div className="mv-result-controls">
          <span><strong>PCA score space</strong><small>{activeRun.missing.analysisCount.toLocaleString()} linked observations</small></span>
          <label>X axis<select aria-label="PCA horizontal axis" onChange={(event) => { const next = Number(event.target.value); setPcaX(next); if (next === pcaY) setPcaY(componentOptions.find((component) => component !== next) ?? next) }} value={pcaX}>{componentOptions.map((component) => <option key={component} value={component}>PC{component + 1}</option>)}</select></label>
          <label>Y axis<select aria-label="PCA vertical axis" onChange={(event) => { const next = Number(event.target.value); setPcaY(next); if (next === pcaX) setPcaX(componentOptions.find((component) => component !== next) ?? next) }} value={pcaY}>{componentOptions.map((component) => <option key={component} value={component}>PC{component + 1}</option>)}</select></label>
          <label>Color by<select aria-label="Color PCA scores by" onChange={(event) => setPcaColorBy(event.target.value)} value={pcaColorBy}><option value="cluster">Cluster</option>{comparisonOptions.map((dimension) => <option key={dimension.key} value={dimension.key}>{dimensionLabel(runDataset, dimension.key)}</option>)}</select></label>
          <label className="mv-check-control"><input checked={showBiplot} onChange={(event) => setShowBiplot(event.target.checked)} type="checkbox" /> Variable vectors</label>
          {linkedActions}
        </div>
        <div className="mv-pca-grid">
          <ChartCard className="mv-pca-score-card" detail={`Colored by ${dimensionLabel(runDataset, pcaColorBy)} · brush or click to link observations`} title={showBiplot ? 'PCA biplot' : 'PCA scores'}><GeoEyeChart ariaLabel="PCA scores plot" brushSelection="replace" clickSelection="toggle" option={buildPcaScoresOption(activeRun, { biplot: showBiplot, colorBy: pcaColorBy, variables: runVariables, xComponent: pcaX, yComponent: pcaY })} /></ChartCard>
          <ChartCard detail="Variance retained by each component" title="Explained variance"><GeoEyeChart ariaLabel="PCA explained variance" option={buildExplainedVarianceOption(activeRun)} /></ChartCard>
          <ChartCard detail="Signed contribution of each analysis variable" title={`Loadings · PC${pcaX + 1} / PC${pcaY + 1}`}><GeoEyeChart ariaLabel="PCA loadings" option={buildLoadingsOption(activeRun, runVariables, [pcaX, pcaY])} /></ChartCard>
          <section className="mv-loadings-table"><header><h3>Loading table</h3><p>Magnitude and sign describe component contribution</p></header><div className="mv-table-row is-header"><span>Variable</span>{componentOptions.slice(0, 3).map((component) => <span key={component}>PC{component + 1}</span>)}</div>{runVariables.map((variable, index) => <div className="mv-table-row" key={variable.key}><strong>{variable.shortLabel}<small>{variable.unit}</small></strong>{componentOptions.slice(0, 3).map((component) => <span key={component}>{(activeRun.pca.loadings[index]?.[component] ?? 0).toFixed(3)}</span>)}</div>)}</section>
        </div>
      </div> : null}

      {view === 'clusters' ? <div className="mv-clusters-view">
        <section className="panel">
          <div className="mv-result-notice"><span><strong>K-means · k = {activeRun.clustering.clusterCount}</strong><small>Centroids use {scalingLabels[activeRun.configuration.scaling].toLowerCase()} · distance and relative membership strength retained</small></span><em>Candidate statistical populations only</em></div>
          <div className="mv-two-charts"><ChartCard actions={linkedActions} detail="Memberships projected into PC1 / PC2 · brush or click to link" title="Cluster map"><GeoEyeChart ariaLabel="K-means clusters in PCA space" brushSelection="replace" clickSelection="toggle" option={buildClusterScoresOption(activeRun)} /></ChartCard><ChartCard detail="Centroid values in the configured analysis scale" title="Cluster profiles"><GeoEyeChart ariaLabel="Cluster centroid profiles" option={buildClusterProfilesOption(activeRun, runVariables)} /></ChartCard></div>
          <div className="mv-cluster-cards">{activeRun.clustering.counts.map((count, index) => {
            const cluster = index + 1
            const unstable = clusterIsSmall(count, activeRun.missing.analysisCount)
            const profile = clusterProfile(activeRun.clustering.centroids[index] ?? [], runVariables)
            const clusterRows = activeRun.rows.filter((row) => row.cluster === cluster)
            const averageDistance = clusterRows.reduce((sum, row) => sum + (row.clusterDistance ?? 0), 0) / Math.max(1, clusterRows.length)
            const averageStrength = clusterRows.reduce((sum, row) => sum + (row.membershipStrength ?? 1), 0) / Math.max(1, clusterRows.length)
            return <article className={unstable ? 'has-warning' : ''} key={cluster}><header><i style={{ '--cluster-color': clusterColors[index] } as React.CSSProperties} /><span><strong>Cluster {cluster}</strong><small>{count.toLocaleString()} rows · {(count / activeRun.missing.analysisCount * 100).toFixed(1)}%</small></span>{unstable ? <em><AlertTriangle size={11} /> Unstable</em> : null}</header><div className="mv-cluster-profile-copy"><span><b>High</b> {profile.high.join(', ')}</span><span><b>Low</b> {profile.low.join(', ')}</span><small>Mean distance {averageDistance.toFixed(2)} · membership {(averageStrength * 100).toFixed(0)}%</small></div><div className="mv-centroid-values">{runVariables.map((variable, variableIndex) => <span key={variable.key}>{variable.shortLabel} <b>{(activeRun.clustering.centroids[index]?.[variableIndex] ?? 0).toFixed(2)}</b></span>)}</div><footer><button onClick={() => openCentralView(cluster)} type="button"><Box size={12} /> Open in 3D</button><button onClick={() => compareClusterGeology(cluster)} type="button">Compare geology</button><button onClick={() => sendDomainEvidence(cluster)} type="button">Use as Domain evidence</button></footer></article>
          })}</div>
        </section>
        {evidenceCluster === null ? null : <div className="mv-evidence-notice"><CheckCircle2 size={15} /> Cluster {evidenceCluster} was packaged as statistical evidence. Domain Analysis must still perform spatial and geological validation.</div>}
        <section className={`panel mv-save-strip ${savedRunId === activeRun.runId ? 'is-saved' : ''}`}>{savedRunId === activeRun.runId ? <><CheckCircle2 size={17} /><span><strong>Saved · template v{savedTemplateVersion}</strong><small>Derived fields, the multivariate analysis file, and graph images were saved together. Source observations remain unchanged.</small></span><button className="button button-secondary" onClick={() => onNavigate('explore')} type="button">Open in Statistics</button><button className="button button-secondary" onClick={() => saveDerived(true)} title={`Create template v${currentTemplateVersion + 1}`} type="button"><CopyPlus size={14} /> Save As…</button><button className="button button-accent" onClick={() => saveDerived(false)} title={`Overwrite template v${currentTemplateVersion}`} type="button"><Save size={14} /> Save</button></> : <><div><Save size={17} /><span><strong>Save multivariate analysis</strong><small>Writes selected GeoEye-owned fields, the analysis file, and graph images to template v{currentTemplateVersion}.</small></span></div><fieldset className="mv-save-components"><legend>PCA scores</legend>{componentOptions.slice(0, 5).map((component) => <label key={component}><input checked={savedPcaComponents.includes(component)} onChange={() => toggleSavedComponent(component)} type="checkbox" /> PC{component + 1}</label>)}</fieldset><label><input checked={saveClusters} onChange={(event) => setSaveClusters(event.target.checked)} type="checkbox" /> Cluster ID</label><label><input checked={saveClusterMetrics} onChange={(event) => setSaveClusterMetrics(event.target.checked)} type="checkbox" /> Distance / confidence</label><button className="button button-secondary" disabled={!saveClusters && savedPcaComponents.length === 0 && !saveClusterMetrics} onClick={() => saveDerived(true)} title={`Create template v${currentTemplateVersion + 1}`} type="button"><CopyPlus size={14} /> Save As…</button><button className="button button-accent" disabled={!saveClusters && savedPcaComponents.length === 0 && !saveClusterMetrics} onClick={() => saveDerived(false)} title={`Overwrite template v${currentTemplateVersion}`} type="button"><Save size={14} /> Save</button></>}</section>
      </div> : null}

      {view === 'detail' ? <div className="mv-detail-layout"><section className="panel mv-detail-table"><header><div><h2>Analysis rows</h2><p>Every score and Cluster ID retains observation, interval, dataset, variable, and run lineage.</p></div><span>{selectedIds.length > 0 ? `${selectedIds.length} linked · ` : ''}{activeRun.rows.length.toLocaleString()} rows</span></header><div className="mv-detail-scroll"><div className="mv-detail-row is-header"><span>Observation / source</span><span>Hole / depth</span><span>PC1</span><span>PC2</span><span>Cluster</span><span>Distance</span><span>Strength</span></div>{orderedRows.slice(0, 300).map((row) => { const selected = row.sourceObservationIds.some((id) => selectedSet.has(id)); return <button className={`mv-detail-row ${selected ? 'is-selected' : ''}`} key={row.observationId} onClick={() => toggleSelection(row.sourceObservationIds)} type="button"><span><strong>{row.observationId.replace('analytical-', '').slice(0, 36)}</strong><small>{row.sourceObservationIds.length} source ID{row.sourceObservationIds.length === 1 ? '' : 's'} · {(row.sourceDatasetIds ?? [activeRun.configuration.datasetId]).join(', ')}</small></span><span><strong>{row.holeId ?? '—'}</strong><small>{row.depthFrom?.toFixed(1) ?? '—'}–{row.depthTo?.toFixed(1) ?? '—'} m</small></span><span>{(row.scores[0] ?? 0).toFixed(2)}</span><span>{(row.scores[1] ?? 0).toFixed(2)}</span><b>C{row.cluster}</b><span>{(row.clusterDistance ?? 0).toFixed(2)}</span><span>{((row.membershipStrength ?? 1) * 100).toFixed(0)}%</span></button> })}</div></section><aside className="panel mv-provenance"><div className="panel-heading"><div><p className="eyebrow">Run provenance</p><h2>Reproducible result</h2></div><Database size={16} /></div><dl><div><dt>Run</dt><dd>#{String(activeRun.runNumber).padStart(2, '0')}</dd></div><div><dt>Run ID</dt><dd title={activeRun.runId}>{activeRun.runId}</dd></div><div><dt>Engine</dt><dd>{activeRun.provenance.engine}</dd></div><div><dt>Version</dt><dd>{activeRun.provenance.algorithmVersion}</dd></div><div><dt>Snapshot</dt><dd>{new Date(activeRun.configuration.snapshotAt).toLocaleString()}</dd></div><div><dt>Source datasets</dt><dd>{new Set(activeRun.rows.flatMap((row) => row.sourceDatasetIds ?? [activeRun.configuration.datasetId])).size}</dd></div><div><dt>Variables</dt><dd title={activeRun.configuration.variableKeys.join(', ')}>{activeRun.configuration.variableKeys.join(', ')}</dd></div><div><dt>Scaling</dt><dd>{scalingLabels[activeRun.configuration.scaling]}</dd></div><div><dt>Missing</dt><dd>{missingLabels[activeRun.configuration.missingPolicy]}</dd></div><div><dt>Input / analysis</dt><dd>{activeRun.missing.inputCount} / {activeRun.missing.analysisCount}</dd></div><div><dt>Seed</dt><dd>{activeRun.provenance.randomSeed}</dd></div></dl><div className="mv-lineage-note"><GitBranch size={15} /><span><strong>Linked lineage preserved</strong><small>Scores and memberships map to source observation IDs used by Statistics, 3D Analysis, and strip log.</small></span></div><div className="mv-provenance-actions"><button className="button button-secondary" onClick={() => onNavigate('explore')} type="button">Statistics</button><button className="button button-secondary" onClick={() => onNavigate('view-3d')} type="button">3D Analysis</button></div></aside></div> : null}
    </>}
  </div>
}
