import {
  Activity, Box, Check, CheckCircle2, ChevronDown, Clock3, Database, GitBranch, History,
  CopyPlus, Layers3, Map as MapIcon, Play, Plus, RefreshCw, Save, Settings2, SlidersHorizontal, TableProperties,
  TestTube2, Trash2, X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { buildDomainAnalysisRequest, runDomainAnalysis, type DomainType } from '../analysis/domainAnalysis.js'
import {
  buildGenerateDomainCandidatesRequest, defaultNumericRanges, domainPrefix, generateDomainCandidates,
  type DomainCandidateGroup, type DomainCandidateRange, type DomainCandidateRun, type DomainPrimarySource,
} from '../analysis/domainCandidateEngine.js'
import { GeoEyeChart } from '../components/GeoEyeChart.js'
import {
  readDomainMembershipDocument, saveDomainCandidateSet, type DomainMembershipDocument,
} from '../data/domainMembershipStore.js'
import { currentAnalysisTemplateVersion, recordAnalysisTemplateSave, resolveAnalysisTemplateVersion } from '../data/analysisSaveStore.js'
import { type EdaDataset } from '../data/edaDemo.js'
import { useProjectEdaDatasets } from '../data/liveEda.js'
import { readMultivariateDomainEvidence } from '../data/multivariateEvidenceStore.js'
import { saveSpatialViewRequest } from '../data/spatialViewStore.js'
import { barGraphImage } from '../data/analysisGraphImages.js'
import { saveAnalysisResultPackage } from '../data/analysisResultStore.js'
import { useGeoEyeSelection } from '../state/SelectionContext.js'
import type { SectionId } from '../types.js'
import { usePersistentState } from '../state/persistentState.js'
import {
  buildContactProfileOption, buildPopulationBoxOption, buildPopulationCdfOption, buildPopulationHistogramOption,
} from '../visualization/domainCharts.js'

type DomainView = 'candidates' | 'review' | 'history'
type AdvancedView = 'contacts' | 'population' | 'stationarity'

interface DomainPageProps { onNavigate: (section: SectionId) => void }
interface PrimarySourceOption extends DomainPrimarySource {
  available: boolean
  group: string
}

const domainTypes: Array<{ id: DomainType; label: string }> = [
  { id: 'geotechnical', label: 'Geotechnical' },
  { id: 'estimation', label: 'Estimation' },
  { id: 'geological', label: 'Geological' },
  { id: 'structural', label: 'Structural' },
  { id: 'alteration-spectral', label: 'Alteration / Spectral' },
]

const evidenceCatalog = [
  { category: 'Geotechnical', key: 'geotech.rqd', label: 'RQD' },
  { category: 'Geotechnical', key: 'geotech.ucs', label: 'UCS' },
  { category: 'Geotechnical', key: 'geotech.fracture_frequency', label: 'Fracture frequency' },
  { category: 'Geology', key: 'lithology', label: 'Lithology' },
  { category: 'Geology', key: 'alteration', label: 'Alteration' },
  { category: 'Assay', key: 'assay.au', label: 'Au assay' },
  { category: 'Assay', key: 'assay.cu', label: 'Cu assay' },
  { category: 'Assay', key: 'assay.as', label: 'As assay' },
  { category: 'Structure', key: 'structure.joint_set', label: 'Joint sets / trends' },
  { category: 'Multivariate', key: 'multivariate.pc1', label: 'PCA scores' },
  { category: 'Multivariate', key: 'multivariate.cluster_id', label: 'Cluster IDs' },
] as const

const domainLabels = Object.fromEntries(domainTypes.map((type) => [type.id, type.label])) as Record<DomainType, string>

function nextRunNumber(storage: Storage) {
  const key = 'geoeye.analytics.domain-run-number.v2'
  const current = Number.parseInt(storage.getItem(key) ?? '0', 10)
  const next = Number.isFinite(current) ? current + 1 : 1
  storage.setItem(key, String(next))
  return next
}

function formatNumber(value: number | null | undefined, decimals = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: decimals })
}

function valuesForDimension(dataset: EdaDataset, key: string) {
  return [...new Set(dataset.observations.flatMap((observation) => observation.dimensions[key] ?? []))].sort()
}

function primarySourceOptions(
  dataset: EdaDataset,
  multivariateEvidence: ReturnType<typeof readMultivariateDomainEvidence>,
  domainType: DomainType,
): PrimarySourceOption[] {
  const options: PrimarySourceOption[] = []
  if (multivariateEvidence !== null && multivariateEvidence.datasetId === dataset.id) {
    options.push({
      available: true, group: 'Multivariate candidates', id: `multivariate:${multivariateEvidence.runId}`, kind: 'multivariate',
      label: `Run #${String(multivariateEvidence.runNumber).padStart(2, '0')} · ${multivariateEvidence.clusterIds.map((cluster) => `Cluster C${cluster}`).join(', ')}`,
    })
  }
  if (domainType === 'geotechnical' && !dataset.variables.some((variable) => variable.key === 'geotech.rmr76')) {
    options.push({
      available: false, group: 'Geotechnical results', id: 'variable:geotech.rmr76', kind: 'numeric-ranges',
      label: 'RMR76 · unavailable in this snapshot', variableKey: 'geotech.rmr76',
    })
  }
  const preferredVariables = ['geotech.rmr76', 'geotech.rqd', 'geotech.ucs', 'assay.au', 'assay.cu', 'assay.as']
  dataset.variables
    .filter((variable) => variable.dataType !== 'category')
    .sort((left, right) => {
      const leftIndex = preferredVariables.indexOf(left.key)
      const rightIndex = preferredVariables.indexOf(right.key)
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex)
    })
    .forEach((variable) => options.push({
      available: dataset.observations.some((observation) => typeof observation.values[variable.key] === 'number' && Number.isFinite(observation.values[variable.key])),
      group: variable.key.startsWith('geotech.') ? 'Geotechnical results' : variable.key.startsWith('assay.') ? 'Grade variables' : 'Numeric variables',
      id: `variable:${variable.key}`, kind: 'numeric-ranges', label: `${variable.shortLabel} · ${variable.label}`, variableKey: variable.key,
    }))
  if (dataset.variables.some((variable) => variable.key === 'assay.au')) options.push({ available: true, group: 'Grade thresholds', id: 'threshold:assay.au', kind: 'threshold', label: 'Au grade threshold', operator: 'gte', threshold: 1, variableKey: 'assay.au' })
  valuesForDimension(dataset, 'domain').forEach((value) => options.push({ available: true, dimensionKey: 'domain', dimensionValue: value, group: 'Existing domains', id: `dimension:domain:${value}`, kind: 'dimension', label: `Existing domain · ${value}` }))
  valuesForDimension(dataset, 'lithology').forEach((value) => options.push({ available: true, dimensionKey: 'lithology', dimensionValue: value, group: 'Geological codes', id: `dimension:lithology:${value}`, kind: 'dimension', label: `Lithology · ${value}` }))
  valuesForDimension(dataset, 'alteration').forEach((value) => options.push({ available: true, dimensionKey: 'alteration', dimensionValue: value, group: 'Alteration codes', id: `dimension:alteration:${value}`, kind: 'dimension', label: `Alteration · ${value}` }))
  valuesForDimension(dataset, 'joint_set').forEach((value) => options.push({ available: true, dimensionKey: 'joint_set', dimensionValue: value, group: 'Structural evidence', id: `dimension:joint_set:${value}`, kind: 'dimension', label: `Joint set · ${value}` }))
  valuesForDimension(dataset, 'structure_type').forEach((value) => options.push({ available: true, dimensionKey: 'structure_type', dimensionValue: value, group: 'Structural evidence', id: `dimension:structure_type:${value}`, kind: 'dimension', label: `Structure · ${value}` }))
  return options
}

function groupedOptions(options: readonly PrimarySourceOption[]) {
  return [...new Set(options.map((option) => option.group))].map((group) => ({ group, options: options.filter((option) => option.group === group) }))
}

function preferredSource(options: readonly PrimarySourceOption[], domainType: DomainType) {
  const preferred = domainType === 'geotechnical'
    ? options.find((option) => option.id === 'variable:geotech.rmr76')
    : domainType === 'estimation'
      ? options.find((option) => option.kind === 'multivariate') ?? options.find((option) => option.group === 'Existing domains') ?? options.find((option) => option.id === 'threshold:assay.au')
      : domainType === 'structural'
        ? options.find((option) => option.group === 'Structural evidence')
        : domainType === 'geological'
          ? options.find((option) => option.dimensionKey === 'lithology')
          : options.find((option) => option.dimensionKey === 'alteration')
  return preferred ?? options.find((option) => option.available) ?? options[0]
}

function defaultDomainSetId(domainType: DomainType, source: DomainPrimarySource | undefined) {
  const sourceToken = source?.variableKey?.split('.').at(-1)
    ?? (source?.kind === 'multivariate' ? 'MV' : source?.dimensionKey ?? 'DOMAIN')
  const normalized = sourceToken.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toUpperCase()
  return `${domainPrefix(domainType)}-${normalized || 'DOMAIN'}-01`
}

function ChartCard({ children, detail, title }: { children: React.ReactNode; detail: string; title: string }) {
  return <section className="eda-chart-card domain-chart-card"><header><div><h3>{title}</h3><p>{detail}</p></div></header><div className="eda-plot">{children}</div></section>
}

export function DomainPage({ onNavigate }: DomainPageProps) {
  const datasetsQuery = useProjectEdaDatasets()
  const multivariateEvidence = useMemo(() => readMultivariateDomainEvidence(typeof window === 'undefined' ? undefined : window.localStorage), [])
  // New multivariate evidence starts a fresh configuration instead of restoring the previous one.
  const evidenceScope = multivariateEvidence?.runId ?? ''
  const [domainType, setDomainType] = usePersistentState<DomainType>('domain.domainType', multivariateEvidence === null ? 'geotechnical' : 'estimation', { scope: evidenceScope })
  const [datasetId, setDatasetId] = usePersistentState('domain.datasetId', multivariateEvidence?.datasetId ?? 'demo-geotechnical-log-v4', { scope: evidenceScope })
  const [primarySourceId, setPrimarySourceId] = usePersistentState('domain.primarySourceId', multivariateEvidence === null ? 'variable:geotech.rmr76' : `multivariate:${multivariateEvidence.runId}`, { scope: evidenceScope })
  const [evidenceKeys, setEvidenceKeys] = usePersistentState<string[]>('domain.evidenceKeys', ['geotech.rqd', 'geotech.ucs', 'lithology', 'alteration'], { scope: evidenceScope })
  const [ranges, setRanges] = usePersistentState<DomainCandidateRange[]>('domain.ranges', defaultNumericRanges('geotech.rmr76', 'GT'), { scope: evidenceScope })
  const [threshold, setThreshold] = usePersistentState('domain.threshold', 1)
  const [candidateRun, setCandidateRun] = usePersistentState<DomainCandidateRun | null>('domain.candidateRun', null, { scope: evidenceScope })
  const [selectedGroupId, setSelectedGroupId] = usePersistentState<string | null>('domain.selectedGroupId', null, { scope: evidenceScope })
  const [scopeId, setScopeId] = usePersistentState<'dataset' | 'linked-selection'>('domain.scopeId', 'dataset', { scope: evidenceScope })
  const [view, setView] = usePersistentState<DomainView>('domain.view', 'candidates')
  const [advancedOpen, setAdvancedOpen] = usePersistentState('domain.advancedOpen', false)
  const [advancedView, setAdvancedView] = usePersistentState<AdvancedView>('domain.advancedView', 'contacts')
  const [populationVariable, setPopulationVariable] = usePersistentState('domain.populationVariable', 'geotech.rqd')
  const [domainSetId, setDomainSetId] = usePersistentState('domain.domainSetId', 'GT-RMR76-01', { scope: evidenceScope })
  const [running, setRunning] = useState(false)
  const [savedDomainSetId, setSavedDomainSetId] = usePersistentState<string | null>('domain.savedDomainSetId', null, { scope: evidenceScope })
  const [savedTemplateVersion, setSavedTemplateVersion] = usePersistentState<number | null>('domain.savedTemplateVersion', null, { scope: evidenceScope })
  const [history, setHistory] = useState<DomainMembershipDocument>(() => readDomainMembershipDocument(typeof window === 'undefined' ? undefined : window.localStorage))
  const { clearSelection, replaceSelection, selectedIds } = useGeoEyeSelection()

  const datasets = datasetsQuery.data ?? []
  const dataset = datasets.find((item) => item.id === datasetId) ?? datasets[0]
  const sourceOptions = dataset === undefined ? [] : primarySourceOptions(dataset, multivariateEvidence, domainType)
  const selectedSource = sourceOptions.find((option) => option.id === primarySourceId) ?? preferredSource(sourceOptions, domainType)
  const rqdSource = sourceOptions.find((option) => option.variableKey === 'geotech.rqd' && option.available)
  const selectedGroup = candidateRun?.groups.find((group) => group.id === selectedGroupId) ?? candidateRun?.groups.find((group) => group.rowCount > 0) ?? candidateRun?.groups[0]
  const rmrUnavailable = selectedSource?.variableKey === 'geotech.rmr76' && !selectedSource.available
  const availableEvidence = evidenceCatalog.filter((item) => item.key === 'lithology' || item.key === 'alteration' || dataset?.variables.some((variable) => variable.key === item.key) || (multivariateEvidence !== null && item.key.startsWith('multivariate.')))
  const rangeInvalid = ranges.some((range) => !Number.isFinite(range.minimum) || !Number.isFinite(range.maximum) || range.minimum > range.maximum || range.code.trim().length === 0)
  const scopeUnavailable = scopeId === 'linked-selection' && selectedIds.length === 0
  const generateDisabled = running || (selectedSource?.kind === 'numeric-ranges' && rangeInvalid) || selectedSource?.available === false || scopeUnavailable

  const advancedResult = useMemo(() => {
    if (dataset === undefined || candidateRun === null || selectedGroup === undefined) return null
    return runDomainAnalysis(buildDomainAnalysisRequest(
      dataset, candidateRun.domainType, candidateRun.evidenceKeys,
      { id: `membership:${selectedGroup.id}`, kind: 'membership', label: `${selectedGroup.code} · ${selectedGroup.label}`, observationIds: selectedGroup.candidateObservationIds },
      candidateRun.runNumber, new Date(candidateRun.completedAt),
    ))
  }, [candidateRun, dataset, selectedGroup])

  if (datasetsQuery.isPending) return <div className="page domain-page domain-simple-page"><div className="eda-state panel">Loading domain candidate sources from the Database…</div></div>
  if (datasetsQuery.isError || dataset === undefined || selectedSource === undefined) return <div className="page domain-page domain-simple-page"><div className="eda-state panel">Domain candidate sources are unavailable.</div></div>

  const changeDomainType = (nextType: DomainType) => {
    setDomainType(nextType)
    const nextSource = preferredSource(primarySourceOptions(dataset, multivariateEvidence, nextType), nextType)
    if (nextSource !== undefined) {
      setPrimarySourceId(nextSource.id)
      if (nextSource.kind === 'numeric-ranges' && nextSource.variableKey !== undefined) setRanges(defaultNumericRanges(nextSource.variableKey, domainPrefix(nextType)))
      setDomainSetId(defaultDomainSetId(nextType, nextSource))
    }
    setCandidateRun(null); setSelectedGroupId(null); setSavedDomainSetId(null)
  }
  const changeSource = (nextId: string) => {
    const next = sourceOptions.find((option) => option.id === nextId)
    if (next === undefined) return
    setPrimarySourceId(next.id)
    if (next.kind === 'numeric-ranges' && next.variableKey !== undefined) setRanges(defaultNumericRanges(next.variableKey, domainPrefix(domainType)))
    if (next.variableKey !== undefined) setEvidenceKeys((current) => current.filter((key) => key !== next.variableKey))
    setDomainSetId(defaultDomainSetId(domainType, next))
    setCandidateRun(null); setSelectedGroupId(null); setSavedDomainSetId(null)
  }
  const changeDataset = (nextId: string) => {
    const nextDataset = datasets.find((item) => item.id === nextId)
    const nextSource = nextDataset === undefined ? undefined : preferredSource(primarySourceOptions(nextDataset, multivariateEvidence, domainType), domainType)
    setDatasetId(nextId)
    if (nextSource !== undefined) {
      setPrimarySourceId(nextSource.id)
      if (nextSource.kind === 'numeric-ranges' && nextSource.variableKey !== undefined) setRanges(defaultNumericRanges(nextSource.variableKey, domainPrefix(domainType)))
      setDomainSetId(defaultDomainSetId(domainType, nextSource))
    }
    setCandidateRun(null); setSelectedGroupId(null); setSavedDomainSetId(null); clearSelection()
  }
  const changeScope = (nextScope: 'dataset' | 'linked-selection') => {
    setScopeId(nextScope); setCandidateRun(null); setSelectedGroupId(null); setSavedDomainSetId(null)
  }
  const toggleEvidence = (key: string) => {
    setEvidenceKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
    setCandidateRun(null); setSelectedGroupId(null); setSavedDomainSetId(null)
  }
  const updateRange = (id: string, change: Partial<DomainCandidateRange>) => {
    setRanges((current) => current.map((range) => range.id === id ? { ...range, ...change } : range))
    setCandidateRun(null); setSelectedGroupId(null); setSavedDomainSetId(null)
  }
  const addRange = () => {
    setRanges((current) => [...current, { code: `${domainPrefix(domainType)}-${String(current.length + 1).padStart(2, '0')}`, id: `custom-${Date.now()}`, label: 'Custom range', maximum: 100, minimum: 0 }])
    setCandidateRun(null); setSelectedGroupId(null); setSavedDomainSetId(null)
  }
  const removeRange = (id: string) => {
    setRanges((current) => current.filter((item) => item.id !== id))
    setCandidateRun(null); setSelectedGroupId(null); setSavedDomainSetId(null)
  }
  const generateCandidates = () => {
    if (generateDisabled) return
    setRunning(true)
    window.setTimeout(() => {
      const runNumber = nextRunNumber(window.localStorage)
      const source: DomainPrimarySource = selectedSource.kind === 'threshold' ? { ...selectedSource, threshold } : selectedSource
      const supportingEvidenceKeys = evidenceKeys.filter((key) => key !== source.variableKey)
      const scope = scopeId === 'dataset'
        ? { id: 'dataset' as const, label: `Entire snapshot · ${dataset.observations.length.toLocaleString()} intervals` }
        : { id: 'linked-selection' as const, label: `Linked selection · ${selectedIds.length.toLocaleString()} source observations`, sourceObservationIds: [...selectedIds] }
      const next = generateDomainCandidates(buildGenerateDomainCandidatesRequest(
        dataset,
        domainType,
        source,
        supportingEvidenceKeys,
        ranges,
        runNumber,
        scope,
        source.kind === 'multivariate' ? multivariateEvidence ?? undefined : undefined,
      ))
      const first = next.groups.find((group) => group.rowCount > 0) ?? next.groups[0]
      setCandidateRun(next); setSelectedGroupId(first?.id ?? null); setDomainSetId(defaultDomainSetId(domainType, source)); setSavedDomainSetId(null); setRunning(false)
    }, 180)
  }
  const chooseGroup = (group: DomainCandidateGroup) => {
    setSelectedGroupId(group.id); setSavedDomainSetId(null); clearSelection()
  }
  const openCentralView = (mode: 'plan' | 'isometric') => {
    if (candidateRun === null || selectedGroup === undefined || selectedGroup.rowCount === 0) return
    replaceSelection(selectedGroup.sourceObservationIds)
    saveSpatialViewRequest(window.localStorage, { colorBy: 'candidate', datasetId: candidateRun.datasetId, label: `${selectedGroup.code} · ${selectedGroup.label}`, sourceModule: 'domain', sourceObservationIds: selectedGroup.sourceObservationIds })
    const url = new URL(window.location.href)
    url.searchParams.set('section', 'view-3d')
    url.searchParams.set('sceneView', mode)
    window.history.replaceState({}, '', url)
    onNavigate('view-3d')
  }
  const saveDomainSet = (createVersion: boolean) => {
    if (candidateRun === null || !candidateRun.groups.some((group) => group.rowCount > 0) || domainSetId.trim().length === 0) return
    const templateId = candidateRun.datasetId
    const templateVersion = resolveAnalysisTemplateVersion(window.localStorage, {
      fallbackVersion: 1,
      mode: createVersion ? 'new-version' : 'overwrite',
      templateId,
    })
    const savedAt = new Date().toISOString()
    const analysisFileId = `domain/${domainSetId.trim()}/v${templateVersion}.json`
    const next = saveDomainCandidateSet(window.localStorage, candidateRun, domainSetId.trim(), savedAt, { templateId, templateVersion })
    recordAnalysisTemplateSave(window.localStorage, {
      analysisFileId,
      derivedFieldKeys: [`domain.${candidateRun.domainType}_membership`],
      feature: 'domain',
      runId: candidateRun.runId,
      savedAt,
      templateId,
      templateVersion,
    })
    const candidateObservationIds = new Set(candidateRun.groups.flatMap((group) => group.candidateObservationIds))
    saveAnalysisResultPackage(window.localStorage, {
      analysisFileId,
      analysisPayload: { domainSetId: domainSetId.trim(), run: candidateRun },
      boreholeIds: dataset.observations.filter((observation) => candidateObservationIds.has(observation.id)).map((observation) => observation.holeId),
      createdAt: savedAt,
      derivedFieldKeys: [`domain.${candidateRun.domainType}_membership`],
      feature: 'domain',
      graphs: [
        barGraphImage('domain-membership-counts', `${domainLabels[candidateRun.domainType]} domain memberships`, candidateRun.groups.map((group) => ({ label: `${group.code} · ${group.label}`, value: group.rowCount }))),
        barGraphImage('domain-primary-means', `${candidateRun.primarySource.label} · class means`, candidateRun.groups.flatMap((group) => group.primaryStatistics?.mean == null ? [] : [{ label: group.code, value: group.primaryStatistics.mean }])),
      ],
      inputName: `${candidateRun.domainType}-${candidateRun.primarySource.label}`,
      projectId: dataset.project,
      runId: candidateRun.runId,
      sourceFileName: `${candidateRun.datasetName}.json`,
      sourceObservationIds: candidateRun.groups.flatMap((group) => group.sourceObservationIds),
      templateId,
      templateVersion,
      tenantId: 'GeoEye Demo',
    })
    setHistory(next); setSavedDomainSetId(domainSetId.trim()); setSavedTemplateVersion(templateVersion)
  }

  const activePopulationKeys = advancedResult?.population.map((item) => item.variableKey) ?? []
  const effectivePopulationVariable = activePopulationKeys.includes(populationVariable) ? populationVariable : activePopulationKeys[0] ?? ''
  const activePopulation = advancedResult?.population.find((item) => item.variableKey === effectivePopulationVariable)
  const currentTemplateVersion = typeof window === 'undefined'
    ? 1
    : currentAnalysisTemplateVersion(window.localStorage, dataset.id, 1)
  const tabs: Array<{ icon: React.ReactNode; id: DomainView; label: string }> = [
    { icon: <Layers3 size={15} />, id: 'candidates', label: 'Candidates' },
    { icon: <TableProperties size={15} />, id: 'review', label: 'Review' },
    { icon: <History size={15} />, id: 'history', label: 'History' },
  ]

  return <div className="page domain-page domain-simple-page">
    <h1 className="sr-only">Domain candidate workflow</h1>
    <header className="domain-simple-header">
      <div><span><Layers3 size={18} /></span><div><p className="eyebrow">Evidence-driven interpretation</p><h2>Domain candidates</h2><small>Generate memberships, inspect selected classes centrally, then save the complete domain set.</small></div></div>
      <div className="domain-workflow-steps"><span className={candidateRun === null ? 'is-active' : 'is-complete'}><b>1</b> Configure</span><i /><span className={candidateRun !== null && savedDomainSetId === null ? 'is-active' : candidateRun === null ? '' : 'is-complete'}><b>2</b> Inspect</span><i /><span className={savedDomainSetId !== null ? 'is-complete' : ''}><b>3</b> Save set</span></div>
    </header>

    <section className="analysis-toolbar eda-toolbar domain-candidate-toolbar">
      <label className="tool-select tool-select-field"><span>Domain type</span><select aria-label="Domain type" onChange={(event) => changeDomainType(event.target.value as DomainType)} value={domainType}>{domainTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field domain-dataset-select"><span>Dataset snapshot</span><select aria-label="Domain dataset" onChange={(event) => changeDataset(event.target.value)} value={dataset.id}>{datasets.map((item) => <option key={item.id} value={item.id}>{item.name} · {new Date(item.snapshotAt).toLocaleDateString()}</option>)}</select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field domain-primary-source"><span>Primary variable / candidate source</span><select aria-label="Primary variable or candidate source" onChange={(event) => changeSource(event.target.value)} value={selectedSource.id}>{groupedOptions(sourceOptions).map(({ group, options }) => <optgroup key={group} label={group}>{options.map((option) => <option disabled={!option.available && option.id !== selectedSource.id} key={option.id} value={option.id}>{option.label}</option>)}</optgroup>)}</select><ChevronDown size={14} /></label>
      <details className="eda-variable-picker domain-evidence-picker"><summary><span>Supporting evidence</span><strong>{evidenceKeys.length} selected</strong><ChevronDown size={14} /></summary><div>{evidenceCatalog.map((item) => { const available = availableEvidence.some((candidate) => candidate.key === item.key); return <label className={available ? '' : 'is-unavailable'} key={item.key}><input checked={evidenceKeys.includes(item.key)} disabled={!available} onChange={() => toggleEvidence(item.key)} type="checkbox" /><span><strong>{item.label}</strong><small>{available ? item.category : `${item.category} · not linked`}</small></span></label> })}</div></details>
      <label className="tool-select tool-select-field domain-scope-select"><span>Scope</span><select aria-label="Candidate scope" onChange={(event) => changeScope(event.target.value as 'dataset' | 'linked-selection')} value={scopeId}><option value="dataset">Entire snapshot · {dataset.observations.length}</option><option disabled={selectedIds.length === 0} value="linked-selection">Linked selection · {selectedIds.length}</option></select><ChevronDown size={14} /></label>
      <div className="eda-run-control"><span>{candidateRun === null ? 'Candidates not generated' : `Run #${String(candidateRun.runNumber).padStart(2, '0')} · ${candidateRun.groups.length} groups`}</span><button className="primary-button" disabled={generateDisabled} onClick={generateCandidates} type="button">{running ? <RefreshCw className="is-spinning" size={13} /> : <Play size={13} />}{running ? 'Generating…' : 'Generate Candidates'}</button></div>
    </section>

    {rmrUnavailable ? <section className="domain-rmr-callout"><Activity size={16} /><span><strong>RMR76 unavailable</strong><small>This snapshot has no saved RMR76 result. Choose how to continue; Domain will not substitute another primary basis automatically.</small></span><div><button className="button button-secondary" onClick={() => onNavigate('geotechnical')} type="button">Open Geotechnical</button><button className="button button-secondary" disabled={rqdSource === undefined} onClick={() => rqdSource !== undefined && changeSource(rqdSource.id)} type="button">Use RQD instead</button></div></section> : null}

    <nav className="eda-view-tabs domain-simple-tabs" role="tablist" aria-label="Domain workflow">
      {tabs.map((tab) => <button aria-selected={view === tab.id} className={view === tab.id ? 'is-active' : ''} key={tab.id} onClick={() => setView(tab.id)} role="tab" type="button">{tab.icon}<strong>{tab.label}</strong>{tab.id === 'candidates' && candidateRun !== null ? <em>{candidateRun.groups.length}</em> : tab.id === 'history' && history.domain_sets.length > 0 ? <em>{history.domain_sets.length}</em> : null}</button>)}
      <span className="domain-tab-context">{domainLabels[domainType]} · {selectedSource.label}</span>
      <span className="mv-selection-status"><strong>{selectedIds.length}</strong> linked{selectedIds.length > 0 ? <button aria-label="Clear linked selection" onClick={clearSelection} type="button"><X size={12} /></button> : null}</span>
    </nav>

    {view === 'candidates' ? <div className="domain-candidates-view">
      {selectedSource.kind === 'numeric-ranges' ? <section className="panel domain-range-editor">
        <header><div><p className="eyebrow">Candidate rules</p><h2>{selectedSource.variableKey === 'geotech.rmr76' ? 'RMR class ranges' : `${selectedSource.label} ranges`}</h2><small>Ranges create candidate memberships only. They do not modify the source variable.</small></div><button className="button button-secondary" onClick={addRange} type="button"><Plus size={13} /> Add range</button></header>
        <div className="domain-range-row is-header"><span>Code</span><span>Candidate label</span><span>Minimum</span><span>Maximum</span><span /></div>
        {ranges.map((range) => <div className="domain-range-row" key={range.id}><input aria-label={`${range.label} code`} onChange={(event) => updateRange(range.id, { code: event.target.value })} value={range.code} /><input aria-label={`${range.code} label`} onChange={(event) => updateRange(range.id, { label: event.target.value })} value={range.label} /><input aria-label={`${range.code} minimum`} onChange={(event) => updateRange(range.id, { minimum: Number(event.target.value) })} type="number" value={range.minimum} /><input aria-label={`${range.code} maximum`} onChange={(event) => updateRange(range.id, { maximum: Number(event.target.value) })} type="number" value={range.maximum} /><button aria-label={`Remove ${range.code}`} disabled={ranges.length === 1} onClick={() => removeRange(range.id)} type="button"><Trash2 size={13} /></button></div>)}
        {rangeInvalid ? <p className="domain-range-error">Each range needs a code and a valid minimum ≤ maximum.</p> : null}
      </section> : null}
      {selectedSource.kind === 'threshold' ? <section className="panel domain-threshold-editor"><div><p className="eyebrow">Candidate rule</p><h2>Grade threshold</h2><small>Create one candidate population from intervals meeting this threshold.</small></div><label><span>{dataset.variables.find((variable) => variable.key === selectedSource.variableKey)?.shortLabel ?? 'Value'} ≥</span><input onChange={(event) => { setThreshold(Number(event.target.value)); setCandidateRun(null); setSelectedGroupId(null); setSavedDomainSetId(null) }} step="0.1" type="number" value={threshold} /><small>{dataset.variables.find((variable) => variable.key === selectedSource.variableKey)?.unit}</small></label></section> : null}
      {candidateRun === null ? <section className="panel domain-candidate-empty"><SlidersHorizontal size={24} /><div><h2>Generate candidate memberships</h2><p>Choose a primary source, supporting evidence, and scope. Domain will group matching intervals without changing RMR, lithology, assays, or other source fields.</p></div><button className="primary-button" disabled={generateDisabled} onClick={generateCandidates} type="button"><Play size={13} /> Generate Candidates</button></section> : <section className="domain-candidate-results">
        <header><div><p className="eyebrow">Run #{String(candidateRun.runNumber).padStart(2, '0')}</p><h2>Candidate groups</h2><small>Select a class to review or inspect. Save persists the complete set.</small></div><span>{candidateRun.groups.reduce((sum, group) => sum + group.rowCount, 0).toLocaleString()} grouped · {candidateRun.scopeRowCount.toLocaleString()} in scope</span></header>
        <div className="domain-candidate-list">{candidateRun.groups.map((group) => <button aria-pressed={selectedGroup?.id === group.id} className={`${selectedGroup?.id === group.id ? 'is-selected' : ''} ${group.rowCount === 0 ? 'is-empty' : ''}`} key={group.id} onClick={() => chooseGroup(group)} type="button"><i /><strong>{group.code}</strong><span><b>{group.label}</b><small>{group.rowCount === 0 ? 'No matching intervals' : `${group.rowCount.toLocaleString()} intervals · ${(group.shareOfScope * 100).toFixed(0)}% of scope`}</small></span><dl><div><dt>Mean</dt><dd>{formatNumber(group.primaryStatistics?.mean)}</dd></div><div><dt>Median</dt><dd>{formatNumber(group.primaryStatistics?.median)}</dd></div><div><dt>Lithology</dt><dd>{group.dominantLithology.label}</dd></div><div><dt>Alteration</dt><dd>{group.dominantAlteration.label}</dd></div></dl><Check size={15} /></button>)}</div>
      </section>}
    </div> : null}

    {view === 'review' ? candidateRun === null || selectedGroup === undefined ? <section className="panel domain-candidate-empty"><TableProperties size={24} /><div><h2>No candidate run to review</h2><p>Generate candidates first, then select a group.</p></div><button className="button button-secondary" onClick={() => setView('candidates')} type="button">Go to Candidates</button></section> : <div className="domain-review-view">
      <section className="panel domain-review-hero"><div><span>{selectedGroup.code}</span><div><p className="eyebrow">Candidate population</p><h2>{selectedGroup.label}</h2><small>Not yet a saved domain · generated from {candidateRun.primarySource.label}</small></div></div><button className="button button-secondary" onClick={() => setView('candidates')} type="button">Change candidate</button></section>
      <section className="domain-review-kpis"><article><span>Intervals</span><strong>{selectedGroup.rowCount.toLocaleString()}</strong><small>{(selectedGroup.shareOfScope * 100).toFixed(0)}% of {candidateRun.scopeRowCount.toLocaleString()} in scope</small></article><article><span>Primary mean</span><strong>{formatNumber(selectedGroup.primaryStatistics?.mean)}</strong><small>{candidateRun.primarySource.label}</small></article><article><span>Primary median</span><strong>{formatNumber(selectedGroup.primaryStatistics?.median)}</strong><small>{selectedGroup.primaryStatistics?.count ?? 0} valid values</small></article><article><span>Dominant lithology</span><strong>{selectedGroup.dominantLithology.label}</strong><small>{(selectedGroup.dominantLithology.share * 100).toFixed(0)}% of candidate</small></article><article><span>Dominant alteration</span><strong>{selectedGroup.dominantAlteration.label}</strong><small>{(selectedGroup.dominantAlteration.share * 100).toFixed(0)}% of candidate</small></article></section>
      <div className="domain-review-grid">
        <section className="panel domain-supporting-summary"><header><div><p className="eyebrow">Supporting evidence</p><h2>Candidate summaries</h2></div><Database size={16} /></header><div className="domain-supporting-table"><div className="is-header"><span>Variable</span><span>n</span><span>Mean</span><span>Median</span><span>CV</span></div>{selectedGroup.supportingSummaries.map((summary) => <div key={summary.variableKey}><strong>{summary.label}<small>{summary.unit}</small></strong><span>{summary.statistics.count}</span><span>{formatNumber(summary.statistics.mean)}</span><span>{formatNumber(summary.statistics.median)}</span><span>{formatNumber(summary.statistics.coefficientOfVariation, 2)}</span></div>)}</div></section>
        <aside className="panel domain-lineage-card"><header><div><p className="eyebrow">Source and run lineage</p><h2>Reproducible candidate</h2></div><GitBranch size={16} /></header><dl><div><dt>Candidate run</dt><dd>#{String(candidateRun.runNumber).padStart(2, '0')}</dd></div><div><dt>Analysis run ID</dt><dd title={candidateRun.runId}>{candidateRun.runId}</dd></div><div><dt>Dataset</dt><dd>{candidateRun.datasetName}</dd></div><div><dt>Snapshot</dt><dd>{new Date(candidateRun.provenance.datasetSnapshotAt).toLocaleString()}</dd></div><div><dt>Scope</dt><dd>{candidateRun.scope.label}</dd></div><div><dt>Primary source</dt><dd>{candidateRun.primarySource.label}</dd></div>{candidateRun.provenance.sourceRunId === undefined ? null : <div><dt>Multivariate run</dt><dd>{candidateRun.provenance.sourceRunId}</dd></div>}<div><dt>Supporting evidence</dt><dd>{candidateRun.evidenceKeys.join(', ')}</dd></div></dl></aside>
      </div>
      <button className="domain-advanced-trigger" onClick={() => setAdvancedOpen((open) => !open)} type="button"><Settings2 size={15} /><span><strong>Advanced validation</strong><small>Contacts, population comparison, stationarity, and boundary diagnostics</small></span><ChevronDown className={advancedOpen ? 'is-open' : ''} size={15} /></button>
      {advancedOpen && advancedResult !== null ? <section className="domain-advanced-panel"><nav><button className={advancedView === 'contacts' ? 'is-active' : ''} onClick={() => setAdvancedView('contacts')} type="button"><TestTube2 size={13} /> Contacts & boundaries</button><button className={advancedView === 'population' ? 'is-active' : ''} onClick={() => setAdvancedView('population')} type="button"><Activity size={13} /> Population</button><button className={advancedView === 'stationarity' ? 'is-active' : ''} onClick={() => setAdvancedView('stationarity')} type="button"><SlidersHorizontal size={13} /> Stationarity</button></nav>
        {advancedView === 'contacts' ? <div className="domain-advanced-contacts"><section className="panel domain-contact-chart"><div className="mv-result-notice"><span><strong>Distance-to-contact profile</strong><small>Negative distance = candidate side · positive distance = surrounding population</small></span><em>{advancedResult.contacts[0]?.boundaryCount ?? 0} transitions</em></div><GeoEyeChart ariaLabel="Distance to candidate contact profiles" clickSelection="replace" option={buildContactProfileOption(advancedResult)} /></section><section className="panel domain-contact-table"><header><div><h2>Boundary diagnostics</h2><p>Immediate values on both sides of candidate membership changes.</p></div></header><div className="domain-contact-row is-header"><span>Variable</span><span>Candidate</span><span>Outside</span><span>Δ mean</span><span>Boundary</span><span>n</span></div>{advancedResult.contacts.map((contact) => { const definition = dataset.variables.find((variable) => variable.key === contact.variableKey); return <div className="domain-contact-row" key={contact.variableKey}><strong>{definition?.shortLabel ?? contact.variableKey}<small>{definition?.unit}</small></strong><span>{formatNumber(contact.candidateMean)}</span><span>{formatNumber(contact.backgroundMean)}</span><span>{formatNumber(contact.difference)}</span><b className={`is-${contact.style}`}>{contact.style}</b><span>{contact.boundaryCount}</span></div> })}</section></div> : null}
        {advancedView === 'population' && effectivePopulationVariable !== '' ? <div className="domain-advanced-population"><div className="domain-result-controls"><label><span>Variable</span><select onChange={(event) => setPopulationVariable(event.target.value)} value={effectivePopulationVariable}>{advancedResult.population.map((item) => <option key={item.variableKey} value={item.variableKey}>{item.label} · {item.unit}</option>)}</select><ChevronDown size={13} /></label><span>Candidate n={activePopulation?.candidate.count ?? 0} · background n={activePopulation?.background.count ?? 0}</span></div><section className="panel domain-population-grid"><ChartCard detail="Candidate and surrounding frequency" title="Histogram"><GeoEyeChart ariaLabel="Candidate and background histogram" clickSelection="replace" option={buildPopulationHistogramOption(dataset, advancedResult, effectivePopulationVariable)} /></ChartCard><ChartCard detail="Cumulative distribution comparison" title="CDF"><GeoEyeChart ariaLabel="Candidate and background cumulative distribution" clickSelection="replace" option={buildPopulationCdfOption(dataset, advancedResult, effectivePopulationVariable)} /></ChartCard><ChartCard detail="Median, quartiles, and range" title="Box plot"><GeoEyeChart ariaLabel="Candidate and background box plot" clickSelection="replace" option={buildPopulationBoxOption(dataset, advancedResult, effectivePopulationVariable)} /></ChartCard></section></div> : null}
        {advancedView === 'stationarity' ? <div className="domain-stationarity"><SlidersHorizontal size={22} /><div><h3>Stationarity review belongs with spatial statistics</h3><p>This candidate spans {advancedResult.spatial.candidateHoleCount} of {advancedResult.spatial.totalHoleCount} drillholes in {advancedResult.spatial.contiguousRuns} contiguous downhole runs. Continue in Variography for directional continuity and stationarity diagnostics.</p></div><button className="button button-secondary" onClick={() => onNavigate('variography')} type="button">Open Variography</button></div> : null}
      </section> : null}
    </div> : null}

    {view === 'history' ? <section className="panel domain-history-view"><header><div><p className="eyebrow">Interpreted data</p><h2>Saved domain sets</h2><small>Each template version retains every class, membership, source snapshot, run lineage, analysis file, and graph image.</small></div><Clock3 size={17} /></header>{history.domain_sets.length === 0 ? <div className="domain-history-empty"><History size={22} /><strong>No domain sets saved yet</strong><span>Generate and review candidates, then save the complete scheme as interpreted membership.</span></div> : <div className="domain-history-list">{history.domain_sets.map((item) => <article key={`${item.domain_set_id}:${item.template_version}:${item.created_at}`}><CheckCircle2 size={16} /><span><strong>{item.domain_set_id} · v{item.template_version}</strong><small>{domainLabels[item.domain_type]} · {item.classes.length} classes · {item.classes.reduce((sum, domainClass) => sum + domainClass.observation_ids.length, 0).toLocaleString()} memberships</small></span><dl><div><dt>Analysis run</dt><dd>{item.analysis_run_id}</dd></div><div><dt>Primary source</dt><dd>{item.provenance.primary_source_label}</dd></div><div><dt>Saved</dt><dd>{new Date(item.created_at).toLocaleString()}</dd></div></dl></article>)}</div>}</section> : null}

    {candidateRun !== null && selectedGroup !== undefined && view !== 'history' ? <footer className={`domain-candidate-actions ${savedDomainSetId !== null ? 'is-saved' : ''}`}>
      <div><span className="domain-action-selection"><i /><strong>{selectedGroup.code}</strong><small>{selectedGroup.label} · {selectedGroup.rowCount} intervals</small></span></div>
      <button className="button button-secondary" disabled={selectedGroup.rowCount === 0} onClick={() => openCentralView('plan')} type="button"><MapIcon size={14} /> Open in 2D</button>
      <button className="button button-secondary" disabled={selectedGroup.rowCount === 0} onClick={() => openCentralView('isometric')} type="button"><Box size={14} /> Open in 3D</button>
      <button className="button button-secondary" onClick={() => { setView('review'); setAdvancedOpen(true) }} type="button"><Settings2 size={14} /> Advanced validation</button>
      <label><span>Domain Set ID</span><input aria-label="Domain Set ID" onChange={(event) => { setDomainSetId(event.target.value); setSavedDomainSetId(null) }} value={domainSetId} /></label>
      <button className="button button-secondary" disabled={!candidateRun.groups.some((group) => group.rowCount > 0) || domainSetId.trim().length === 0} onClick={() => saveDomainSet(true)} title={`Create template v${currentTemplateVersion + 1}`} type="button"><CopyPlus size={14} /> Save As…</button>
      <button className="button button-accent" disabled={!candidateRun.groups.some((group) => group.rowCount > 0) || domainSetId.trim().length === 0} onClick={() => saveDomainSet(false)} title={`Overwrite template v${currentTemplateVersion}`} type="button">{savedDomainSetId === domainSetId.trim() ? <Check size={14} /> : <Save size={14} />}{savedDomainSetId === domainSetId.trim() ? `Saved v${savedTemplateVersion}` : 'Save'}</button>
    </footer> : null}
  </div>
}
