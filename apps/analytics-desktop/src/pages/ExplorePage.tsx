import { AlertTriangle, BarChart3, ChartSpline, ChevronDown, Grid3X3, LayoutDashboard, Play, RefreshCw, ScatterChart, Settings2, TableProperties, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { analyzeCorrelationMatrix, analyzeRelationship, analyzeSwath, type ScatterAnalysisResult } from '../analysis/chartResults.js'
import { summarizeVariable, type EdaObservation, type JoinedPair, type SwathAxis } from '../analysis/eda.js'
import { buildEdaRunRequest, edaConfigurationSignature, type EdaPopulationResult, type EdaRunConfiguration, type EdaRunRequest, type EdaRunResult } from '../analysis/edaRun.js'
import type { DistributionResult, WeightingMethod } from '../analysis/distributionEngine.js'
import { useEdaRunEngine } from '../analysis/useEdaRunEngine.js'
import { GeoEyeChart } from '../components/GeoEyeChart.js'
import { EdaDatasetOptions } from '../components/EdaDatasetOptions.js'
import { GeoEyeFacetChart } from '../components/GeoEyeFacetChart.js'
import { DownholeCorrelationIcon } from '../components/GeoEyeIcons.js'
import { type EdaDataset, type EdaVariableDefinition, type EdaVariableKey } from '../data/edaTypes.js'
import { nextEdaRunNumber, readEdaRunCache, writeEdaRunCache } from '../data/edaRunCache.js'
import { useProjectEdaDatasets } from '../data/liveEda.js'
import { useGeoEyeSelection } from '../state/SelectionContext.js'
import { buildCdfOption, buildCorrelationOption, buildDistributionBoxPlotOption, buildHistogramOption, buildProbabilityPlotOption, buildScatterOption, buildSwathOption } from '../visualization/chartOptions.js'
import { DownholeCorrelationWorkspace } from './DownholeCorrelationPage.js'
import { usePersistentState } from '../state/persistentState.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'

type ExploreView = 'statistics' | 'distribution' | 'relationships' | 'swath' | 'downhole'
type ResultMode = 'facets' | 'detail'
type RelationshipView = 'facets' | 'detail' | 'matrix'
type CorrelationMethod = 'pearson' | 'spearman'
type DistributionChart = 'all' | 'histogram' | 'cdf' | 'probability' | 'box'
type FacetChart = 'histogram' | 'cdf' | 'probability' | 'box'

const weightingLabels: Record<WeightingMethod, string> = { 'cell-declustering': 'Cell declustering', 'equal-hole': 'Equal per hole', 'interval-support': 'Interval support' }

function initialExploreView(): ExploreView {
  if (typeof window === 'undefined') return 'statistics'
  return new URLSearchParams(window.location.search).get('statisticsView') === 'downhole' ? 'downhole' : 'statistics'
}

function formatNumber(value: number | null, variable: EdaVariableDefinition, includeUnit = false) {
  if (value === null || !Number.isFinite(value)) return '—'
  const formatted = value.toLocaleString(undefined, { maximumFractionDigits: variable.decimals, minimumFractionDigits: variable.decimals })
  return includeUnit ? `${formatted} ${variable.unit}` : formatted
}

function ChartFrame({ children, detail, title }: { children: React.ReactNode; detail: string; title: string }) {
  return <section className="eda-chart-card"><header><div><h3>{title}</h3><p>{detail}</p></div></header><div className="eda-plot">{children}</div></section>
}

function filterObservations(observations: readonly EdaObservation[], activeFilterKeys: readonly string[], filterValues: Readonly<Record<string, string>>) {
  return observations.filter((observation) => activeFilterKeys.every((key) => {
    const selected = filterValues[key]
    return selected === undefined || selected === 'all' || observation.dimensions[key] === selected
  }))
}

function observationsForPopulation(dataset: EdaDataset | undefined, configuration: EdaRunConfiguration | undefined, population: EdaPopulationResult | undefined) {
  if (dataset === undefined || configuration === undefined || population === undefined) return []
  return filterObservations(dataset.observations, configuration.activeFilterKeys, configuration.filterValues).filter((observation) => (
    (configuration.compareBy === null || (observation.dimensions[configuration.compareBy] ?? 'Unassigned') === population.compareValue)
    && (configuration.secondGroup === null || (observation.dimensions[configuration.secondGroup] ?? 'Unassigned') === population.secondGroupValue)
  ))
}

interface RelationshipFacetResult {
  relationship: ScatterAnalysisResult
}

function relationshipPopulationFacets(
  xObservations: readonly EdaObservation[],
  yObservations: readonly EdaObservation[],
  xVariableKey: string,
  yVariableKey: string,
  configuration: EdaRunConfiguration | undefined,
  dimensions: EdaDataset['dimensions'],
) {
  const groupKeys = [configuration?.compareBy, configuration?.secondGroup].filter((key): key is string => key !== null && key !== undefined)
  if (groupKeys.length === 0) {
    return [{ id: 'all', result: { relationship: analyzeRelationship(xObservations, yObservations, xVariableKey, yVariableKey) }, title: 'All observations' }]
  }

  const groups = new Map<string, { id: string; title: string; values: string[] }>()
  xObservations.forEach((observation) => {
    const values = groupKeys.map((key) => observation.dimensions[key] ?? 'Unassigned')
    const id = values.map(encodeURIComponent).join('::')
    if (groups.has(id)) return
    groups.set(id, {
      id,
      title: values.map((value, index) => `${dimensions.find((dimension) => dimension.key === groupKeys[index])?.label ?? groupKeys[index]}: ${value}`).join(' · '),
      values,
    })
  })

  return Array.from(groups.values()).map((group) => {
    const inGroup = (observation: EdaObservation) => groupKeys.every((key, index) => (observation.dimensions[key] ?? 'Unassigned') === group.values[index])
    return {
      id: group.id,
      result: { relationship: analyzeRelationship(xObservations.filter(inGroup), yObservations.filter(inGroup), xVariableKey, yVariableKey) },
      title: group.title,
    }
  })
}

function distributionSeries(result: DistributionResult | undefined, variable: EdaVariableDefinition | undefined, showDeclustered: boolean) {
  if (result === undefined || variable === undefined) return null
  const config = { decimals: variable.decimals, showDeclustered, unit: variable.unit, variableLabel: variable.label, x: '', y: '' }
  return {
    box: buildDistributionBoxPlotOption(result, config),
    cdf: buildCdfOption(result, config),
    histogram: buildHistogramOption(result, config),
    probability: buildProbabilityPlotOption(result, config),
  }
}

export function ExplorePage() {
  const storage = useProjectStorage()
  const datasetsQuery = useProjectEdaDatasets()
  const [view, setView] = usePersistentState<ExploreView>('explore.view', initialExploreView)
  const [resultMode, setResultMode] = usePersistentState<ResultMode>('explore.resultMode', 'facets')
  const [datasetId, setDatasetId] = usePersistentState('explore.datasetId', '')
  const [variableKeys, setVariableKeys] = usePersistentState<EdaVariableKey[]>('explore.variableKeys', ['assay.au', 'assay.cu', 'assay.as'])
  const [activeFilterKeys, setActiveFilterKeys] = usePersistentState<string[]>('explore.activeFilterKeys', [])
  const [filterValues, setFilterValues] = usePersistentState<Record<string, string>>('explore.filterValues', {})
  const [compareBy, setCompareBy] = usePersistentState<string | null>('explore.compareBy', null)
  const [secondGroup, setSecondGroup] = usePersistentState<string | null>('explore.secondGroup', null)
  const [declusteringEnabled, setDeclusteringEnabled] = usePersistentState('explore.declusteringEnabled', false)
  const [declusteringSettingsOpen, setDeclusteringSettingsOpen] = useState(false)
  const [weightingMethod, setWeightingMethod] = usePersistentState<WeightingMethod>('explore.weightingMethod', 'cell-declustering')
  const [declusteringCellSize, setDeclusteringCellSize] = usePersistentState('explore.declusteringCellSize', 25)
  const [submittedRequest, setSubmittedRequest] = useState<EdaRunRequest | null>(null)
  const [activeRun, setActiveRun] = useState<EdaRunResult | null>(null)
  const [activeRunId, setActiveRunId] = usePersistentState<string | null>('explore.activeRunId', null)
  const [activePopulationId, setActivePopulationId] = usePersistentState<string | null>('explore.activePopulationId', null)
  const [distributionChart, setDistributionChart] = usePersistentState<DistributionChart>('explore.distributionChart', 'all')
  const [facetChart, setFacetChart] = usePersistentState<FacetChart>('explore.facetChart', 'histogram')
  const [relationshipDatasetIds, setRelationshipDatasetIds] = usePersistentState<string[]>('explore.relationshipDatasetIds', [])
  const [xDatasetId, setXDatasetId] = usePersistentState('explore.xDatasetId', '')
  const [xVariableKey, setXVariableKey] = usePersistentState<EdaVariableKey>('explore.xVariableKey', 'assay.au')
  const [yDatasetId, setYDatasetId] = usePersistentState('explore.yDatasetId', '')
  const [yVariableKey, setYVariableKey] = usePersistentState<EdaVariableKey>('explore.yVariableKey', 'geotech.rqd')
  const [relationshipView, setRelationshipView] = usePersistentState<RelationshipView>('explore.relationshipView', 'facets')
  const [relationshipPopulationId, setRelationshipPopulationId] = usePersistentState<string | null>('explore.relationshipPopulationId', null)
  const [correlationMethod, setCorrelationMethod] = usePersistentState<CorrelationMethod>('explore.correlationMethod', 'pearson')
  const [swathAxis, setSwathAxis] = usePersistentState<SwathAxis>('explore.swathAxis', 'easting')
  const { clearSelection, selectedIds } = useGeoEyeSelection()
  const declusteringSettingsRef = useRef<HTMLDivElement>(null)
  const cacheHydratedRef = useRef(false)
  const autoRunRequestedRef = useRef(false)
  const runEngine = useEdaRunEngine(submittedRequest)

  const datasets = datasetsQuery.data ?? []
  const dataset = datasets.find((candidate) => candidate.id === datasetId) ?? datasets[0]
  const effectiveVariableKeys = dataset === undefined ? [] : variableKeys.filter((key) => dataset.variables.some((variable) => variable.key === key && variable.dataType !== 'category'))
  const draftConfiguration = useMemo((): EdaRunConfiguration | null => dataset === undefined ? null : ({ activeFilterKeys, compareBy, datasetId: dataset.id, datasetName: dataset.name, filterValues, minimumPopulationSize: 20, secondGroup: compareBy === null ? null : secondGroup, snapshotAt: dataset.snapshotAt, supportLabel: dataset.support, variableKeys: effectiveVariableKeys, weighting: { cellSize: declusteringCellSize, method: weightingMethod } }), [activeFilterKeys, compareBy, dataset, declusteringCellSize, effectiveVariableKeys, filterValues, secondGroup, weightingMethod])
  const draftSignature = draftConfiguration === null ? null : edaConfigurationSignature(draftConfiguration)
  const configurationChanged = activeRun !== null && activeRun.configurationSignature !== draftSignature

  useEffect(() => {
    if (dataset === undefined || dataset.source !== 'live') return
    const numericKeys = dataset.variables.filter((variable) => variable.dataType !== 'category').map((variable) => variable.key)
    const validKeys = variableKeys.filter((key) => numericKeys.includes(key))
    const datasetChanged = datasetId !== dataset.id
    if (datasetChanged) setDatasetId(dataset.id)
    if (validKeys.length === 0 && numericKeys.length > 0) setVariableKeys(numericKeys.slice(0, 3))
    else if (validKeys.length !== variableKeys.length) setVariableKeys(validKeys)
    const availableRelationshipIds = relationshipDatasetIds.filter((id) => datasets.some((candidate) => candidate.id === id))
    if (availableRelationshipIds.length === 0) setRelationshipDatasetIds(datasets.slice(0, 2).map((candidate) => candidate.id))
    const firstVariable = dataset.variables.find((variable) => variable.dataType !== 'category')
    if (firstVariable !== undefined && !datasets.some((candidate) => candidate.id === xDatasetId)) { setXDatasetId(dataset.id); setXVariableKey(firstVariable.key) }
    if (firstVariable !== undefined && !datasets.some((candidate) => candidate.id === yDatasetId)) { setYDatasetId(dataset.id); setYVariableKey(firstVariable.key) }
    if (datasetChanged) { autoRunRequestedRef.current = false; setSubmittedRequest(null); setActiveRun(null) }
  }, [dataset, datasets, datasetId, relationshipDatasetIds, variableKeys, xDatasetId, yDatasetId])

  useEffect(() => {
    if (!declusteringSettingsOpen) return undefined
    const close = (event: PointerEvent) => { if (!declusteringSettingsRef.current?.contains(event.target as Node)) setDeclusteringSettingsOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDeclusteringSettingsOpen(false) }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [declusteringSettingsOpen])

  useEffect(() => {
    if (cacheHydratedRef.current || datasets.length === 0 || typeof window === 'undefined') return
    cacheHydratedRef.current = true
    const current = (run: EdaRunResult) => datasets.find((candidate) => candidate.id === run.configuration.datasetId)?.snapshotAt === run.configuration.snapshotAt
    const cachedRuns = readEdaRunCache(storage)
    const restored = cachedRuns.find((run) => run.runId === activeRunId && current(run))
    if (restored !== undefined) {
      // The saved workspace state already holds the configuration and view that go with this run.
      autoRunRequestedRef.current = true
      setActiveRun(restored)
      return
    }
    const cached = cachedRuns.find(current)
    if (cached === undefined) return
    autoRunRequestedRef.current = true
    setActiveRunId(cached.runId)
    setActiveRun(cached); setActivePopulationId(cached.populations[0]?.populationId ?? null); setDatasetId(cached.configuration.datasetId); setVariableKeys(cached.configuration.variableKeys); setActiveFilterKeys(cached.configuration.activeFilterKeys); setFilterValues(cached.configuration.filterValues); setCompareBy(cached.configuration.compareBy); setSecondGroup(cached.configuration.secondGroup); setWeightingMethod(cached.configuration.weighting.method); setDeclusteringCellSize(cached.configuration.weighting.cellSize); setResultMode('facets')
  }, [datasets, storage])

  useEffect(() => {
    if (runEngine.result === null) return
    setActiveRun(runEngine.result); setActiveRunId(runEngine.result.runId); setActivePopulationId(runEngine.result.populations[0]?.populationId ?? null); setResultMode('facets'); setRelationshipView('facets'); setRelationshipPopulationId(null); clearSelection()
    if (typeof window !== 'undefined') writeEdaRunCache(storage, runEngine.result)
  }, [clearSelection, runEngine.result, storage])

  useEffect(() => {
    if (autoRunRequestedRef.current || draftConfiguration === null || draftConfiguration.variableKeys.length === 0 || dataset === undefined || activeRun !== null || submittedRequest !== null) return
    autoRunRequestedRef.current = true
    const runNumber = typeof window === 'undefined' ? 1 : nextEdaRunNumber(storage)
    setSubmittedRequest(buildEdaRunRequest(draftConfiguration, dataset, runNumber))
  }, [activeRun, dataset, draftConfiguration, storage, submittedRequest])

  if (datasetsQuery.isPending) return <div className="page explore-page"><div className="eda-state panel">Opening the local analytical database…</div></div>
  if (datasetsQuery.isError) return <div className="page explore-page"><div className="eda-state panel">The local analytical database could not be opened.</div></div>
  if (dataset === undefined) return <div className="page explore-page"><div className="eda-state panel">The local database is ready. Import a CSV or drillhole collar/survey to start an analysis.</div></div>

  const activeDataset = datasets.find((candidate) => candidate.id === activeRun?.configuration.datasetId)
  const activePopulation = activeRun?.populations.find((population) => population.populationId === activePopulationId) ?? activeRun?.populations[0]
  const activeVariable = activeDataset?.variables.find((candidate) => candidate.key === activePopulation?.variableKey)
  const activeResult = activePopulation?.result
  const populationObservations = observationsForPopulation(activeDataset, activeRun?.configuration, activePopulation)
  const selectedSet = new Set(selectedIds)
  const showDeclustered = declusteringEnabled
  const chartData = distributionSeries(activeResult, activeVariable, showDeclustered)
  const swathResult = activeVariable === undefined ? null : analyzeSwath(populationObservations, activeVariable.key, swathAxis)
  const swath = swathResult?.bins ?? []
  const swathOption = activeVariable === undefined || swathResult === null ? null : buildSwathOption(swathResult, {
    x: swathAxis === 'depth' ? 'Downhole depth (m)' : `${swathAxis} (m)`,
    y: `${activeVariable.label} (${activeVariable.unit})`,
  })

  const relationshipDatasets = relationshipDatasetIds.flatMap((id) => { const candidate = datasets.find((item) => item.id === id); return candidate === undefined ? [] : [candidate] })
  const xDataset = datasets.find((candidate) => candidate.id === xDatasetId) ?? relationshipDatasets[0]
  const yDataset = datasets.find((candidate) => candidate.id === yDatasetId) ?? relationshipDatasets[0]
  const xVariable = xDataset?.variables.find((candidate) => candidate.key === xVariableKey) ?? xDataset?.variables[0]
  const yVariable = yDataset?.variables.find((candidate) => candidate.key === yVariableKey) ?? yDataset?.variables[0]
  const appliedFilters = activeRun?.configuration ?? draftConfiguration
  const xObservations = filterObservations(xDataset?.observations ?? [], appliedFilters?.activeFilterKeys ?? [], appliedFilters?.filterValues ?? {})
  const yObservations = filterObservations(yDataset?.observations ?? [], appliedFilters?.activeFilterKeys ?? [], appliedFilters?.filterValues ?? {})
  const relationshipResult = xVariable === undefined || yVariable === undefined
    ? analyzeRelationship([], [], '', '')
    : analyzeRelationship(xObservations, yObservations, xVariable.key, yVariable.key)
  const availableRelationshipDatasets = datasets.filter((candidate) => !relationshipDatasetIds.includes(candidate.id))
  const relationshipFacets = xVariable === undefined || yVariable === undefined
    ? []
    : relationshipPopulationFacets(xObservations, yObservations, xVariable.key, yVariable.key, activeRun?.configuration, xDataset?.dimensions ?? [])
  const selectedRelationshipFacet = relationshipFacets.find((facet) => facet.id === relationshipPopulationId)
  const detailRelationship = selectedRelationshipFacet?.result.relationship ?? relationshipResult
  const scatterOption = buildScatterOption(detailRelationship, {
    x: `${xVariable?.label ?? 'X'} (${xVariable?.unit ?? ''})`,
    y: `${yVariable?.label ?? 'Y'} (${yVariable?.unit ?? ''})`,
  })
  const matrixVariables = relationshipDatasets.flatMap((relationshipDataset) => relationshipDataset.variables
    .filter((variable) => variable.dataType !== 'category')
    .map((variable) => ({
      datasetId: relationshipDataset.id,
      id: `${relationshipDataset.id}::${variable.key}`,
      label: variable.shortLabel,
      observations: filterObservations(relationshipDataset.observations, appliedFilters?.activeFilterKeys ?? [], appliedFilters?.filterValues ?? {}),
      variable,
      variableKey: variable.key,
    })))
  const duplicateMatrixLabels = new Set(matrixVariables.filter((variable, index, items) => items.findIndex((candidate) => candidate.label === variable.label) !== index).map((variable) => variable.label))
  const labeledMatrixVariables = matrixVariables.map((variable) => ({
    ...variable,
    label: duplicateMatrixLabels.has(variable.label) ? `${variable.label} · ${relationshipDatasets.find((candidate) => candidate.id === variable.datasetId)?.name.split(' · ')[0] ?? 'Dataset'}` : variable.label,
  }))
  const matrixResult = analyzeCorrelationMatrix(labeledMatrixVariables, correlationMethod)
  const matrixOption = buildCorrelationOption(matrixResult)
  const detailVariables = (activeDataset?.variables ?? []).filter((variable) => activeRun?.populations.some((population) => population.variableKey === variable.key))

  const dimensionValues = (key: string) => Array.from(new Set(dataset.observations.flatMap((observation) => observation.dimensions[key] === undefined ? [] : [observation.dimensions[key]]))).sort()
  const selectDataset = (nextDatasetId: string) => {
    const nextDataset = datasets.find((candidate) => candidate.id === nextDatasetId)
    if (nextDataset === undefined) return
    setDatasetId(nextDatasetId); setVariableKeys(nextDataset.variables.slice(0, 3).map((variable) => variable.key)); setActiveFilterKeys([]); setFilterValues({}); setCompareBy(null); setSecondGroup(null); clearSelection()
  }
  const toggleVariable = (key: EdaVariableKey) => { setVariableKeys((current) => current.includes(key) ? current.length === 1 ? current : current.filter((candidate) => candidate !== key) : [...current, key]); clearSelection() }
  const addFilter = (key: string) => { if (key === '' || activeFilterKeys.includes(key)) return; setActiveFilterKeys((current) => [...current, key]); setFilterValues((current) => ({ ...current, [key]: 'all' })) }
  const removeFilter = (key: string) => { setActiveFilterKeys((current) => current.filter((candidate) => candidate !== key)); setFilterValues((current) => Object.fromEntries(Object.entries(current).filter(([candidate]) => candidate !== key))); clearSelection() }
  const startRun = () => {
    if (draftConfiguration === null || draftConfiguration.variableKeys.length === 0 || runEngine.pending) return
    const runNumber = typeof window === 'undefined' ? (activeRun?.runNumber ?? 0) + 1 : nextEdaRunNumber(storage)
    setSubmittedRequest(buildEdaRunRequest(draftConfiguration, dataset, runNumber))
  }
  const openView = (nextView: ExploreView) => {
    setView(nextView)
    setResultMode(nextView === 'distribution' || nextView === 'swath' ? 'facets' : 'detail')
    if (nextView === 'relationships') setRelationshipView('facets')
  }
  const openPopulation = (populationId: string) => { setActivePopulationId(populationId); setResultMode('detail'); clearSelection() }
  const selectDetailVariable = (variableKey: EdaVariableKey) => {
    if (activeRun === null) return
    const matchingPopulation = activeRun.populations.find((population) => (
      population.variableKey === variableKey
      && population.compareValue === activePopulation?.compareValue
      && population.secondGroupValue === activePopulation?.secondGroupValue
    )) ?? activeRun.populations.find((population) => population.variableKey === variableKey)
    if (matchingPopulation === undefined) return
    setActivePopulationId(matchingPopulation.populationId)
    clearSelection()
  }
  const addRelationshipDataset = (id: string) => { if (id === '' || relationshipDatasetIds.includes(id)) return; setRelationshipDatasetIds((current) => [...current, id]) }
  const removeRelationshipDataset = (id: string) => {
    if (relationshipDatasetIds.length <= 1) return
    const remainingIds = relationshipDatasetIds.filter((candidate) => candidate !== id)
    const fallbackDataset = datasets.find((candidate) => candidate.id === remainingIds[0]); const fallbackVariable = fallbackDataset?.variables[0]
    setRelationshipDatasetIds(remainingIds)
    if (fallbackDataset === undefined || fallbackVariable === undefined) return
    if (xDatasetId === id) { setXDatasetId(fallbackDataset.id); setXVariableKey(fallbackVariable.key) }
    if (yDatasetId === id) { setYDatasetId(fallbackDataset.id); setYVariableKey(fallbackVariable.key) }
    clearSelection()
  }
  const selectRelationshipAxis = (axis: 'x' | 'y', nextDatasetId: string, nextVariableKey: EdaVariableKey) => {
    if (axis === 'x') { setXDatasetId(nextDatasetId); setXVariableKey(nextVariableKey) }
    else { setYDatasetId(nextDatasetId); setYVariableKey(nextVariableKey) }
    setRelationshipPopulationId(null)
    clearSelection()
  }
  const openRelationshipFacet = (populationId: string) => {
    setRelationshipPopulationId(populationId)
    setRelationshipView('detail')
    clearSelection()
  }
  const openMatrixCell = (datum: unknown) => {
    if (typeof datum !== 'object' || datum === null || !('value' in datum) || !Array.isArray(datum.value)) return
    const column = Number(datum.value[0])
    const row = Number(datum.value[1])
    const xMatrixVariable = labeledMatrixVariables[column]
    const yMatrixVariable = labeledMatrixVariables[row]
    if (xMatrixVariable === undefined || yMatrixVariable === undefined) return
    setXDatasetId(xMatrixVariable.datasetId); setXVariableKey(xMatrixVariable.variable.key)
    setYDatasetId(yMatrixVariable.datasetId); setYVariableKey(yMatrixVariable.variable.key)
    setRelationshipPopulationId(null)
    setRelationshipView('detail')
  }

  const summaryObservations = filterObservations(
    activeDataset?.observations ?? [],
    activeRun?.configuration.activeFilterKeys ?? [],
    activeRun?.configuration.filterValues ?? {},
  )
  const summaryRows = (activeRun?.configuration.variableKeys ?? []).flatMap((variableKey) => {
    const variable = activeDataset?.variables.find((candidate) => candidate.key === variableKey)
    return variable === undefined ? [] : [{ summary: summarizeVariable(summaryObservations, variableKey), variable }]
  })
  const chartFacets = (activeRun?.populations ?? []).flatMap((population) => {
    const variable = activeDataset?.variables.find((candidate) => candidate.key === population.variableKey)
    return variable === undefined ? [] : [{
      id: population.populationId,
      result: { distribution: population.result, variable },
      subtitle: `${variable.unit} · n = ${population.result.sample.summary.count}${population.insufficient ? ' · insufficient' : ''}`,
      title: population.label,
    }]
  })
  const swathFacets = (activeRun?.populations ?? []).flatMap((population) => {
    const variable = activeDataset?.variables.find((candidate) => candidate.key === population.variableKey)
    if (variable === undefined) return []
    const result = analyzeSwath(observationsForPopulation(activeDataset, activeRun?.configuration, population), variable.key, swathAxis)
    return [{
      id: population.populationId,
      result: { swath: result, variable },
      subtitle: `${variable.unit} · n = ${population.result.sample.summary.count}${population.insufficient ? ' · insufficient' : ''}`,
      title: population.label,
    }]
  })
  const declusteringSettingsText = weightingMethod === 'cell-declustering' ? `${weightingLabels[weightingMethod]} · ${declusteringCellSize.toLocaleString()} m cells` : weightingLabels[weightingMethod]
  const histogramDetail = showDeclustered ? 'Relative frequency (%) · Raw and Declustered · click a bin to link source observations' : 'Relative frequency (%) · Raw reference · click a bin to link source observations'
  const cdfDetail = showDeclustered ? 'Raw ECDF + weighted CDF' : 'Raw empirical cumulative distribution'
  const probabilityDetail = showDeclustered ? `Raw + Declustered normal-reference points · weighted diagnostic R² ${activeResult?.diagnostics.normalProbabilityRSquared?.toFixed(3) ?? '—'}` : 'Raw normal-reference points · diagnostic only, not probability or confidence'
  const supportsPopulationModes = view === 'distribution' || view === 'swath'
  const facetOption = (chart: FacetChart, facet: { distribution: EdaPopulationResult['result']; variable: EdaVariableDefinition }) => {
    const config = { decimals: facet.variable.decimals, showDeclustered: declusteringEnabled, unit: facet.variable.unit, variableLabel: facet.variable.label, x: '', y: '' }
    if (chart === 'histogram') return buildHistogramOption(facet.distribution, config)
    if (chart === 'cdf') return buildCdfOption(facet.distribution, config)
    if (chart === 'probability') return buildProbabilityPlotOption(facet.distribution, config)
    return buildDistributionBoxPlotOption(facet.distribution, config)
  }
  const resultModeControl = activeRun === null || !supportsPopulationModes ? null : <div className="segmented-control eda-result-mode-control" role="group" aria-label={`${view === 'swath' ? 'Spatial' : 'Distribution'} view`}><button className={resultMode === 'facets' ? 'is-active' : ''} onClick={() => setResultMode('facets')} type="button"><Grid3X3 size={12} /> Facets</button><button className={resultMode === 'detail' ? 'is-active' : ''} onClick={() => setResultMode('detail')} type="button"><BarChart3 size={12} /> Detail</button></div>
  const detailVariableControl = activeRun === null || !supportsPopulationModes || resultMode !== 'detail' || detailVariables.length === 0 ? null : <label className="eda-inline-plot-tools eda-detail-variable-control"><span>Variable</span><select aria-label="Detail variable" onChange={(event) => selectDetailVariable(event.target.value as EdaVariableKey)} value={activeVariable?.key ?? detailVariables[0]?.key}>{detailVariables.map((variable) => <option key={variable.key} value={variable.key}>{variable.shortLabel} · {variable.label} ({variable.unit})</option>)}</select><ChevronDown aria-hidden="true" size={13} /></label>
  const relationshipViewControl = activeRun === null || view !== 'relationships' ? null : <div className="segmented-control eda-result-mode-control eda-relationship-view-control" role="group" aria-label="Relationship view"><button className={relationshipView === 'facets' ? 'is-active' : ''} onClick={() => setRelationshipView('facets')} type="button"><Grid3X3 size={12} /> Facets</button><button className={relationshipView === 'detail' ? 'is-active' : ''} onClick={() => setRelationshipView('detail')} type="button"><ScatterChart size={12} /> Detail</button><button className={relationshipView === 'matrix' ? 'is-active' : ''} onClick={() => setRelationshipView('matrix')} type="button"><TableProperties size={12} /> Matrix</button></div>
  const relationshipMatrixControl = activeRun === null || view !== 'relationships' || relationshipView !== 'matrix' ? null : <div className="eda-inline-plot-tools eda-correlation-method-control"><span>Correlation</span><div className="segmented-control" role="group" aria-label="Correlation coefficient">{(['pearson', 'spearman'] as const).map((method) => <button aria-pressed={correlationMethod === method} className={correlationMethod === method ? 'is-active' : ''} key={method} onClick={() => setCorrelationMethod(method)} type="button">{method === 'pearson' ? 'Pearson' : 'Spearman'}</button>)}</div></div>
  const distributionPlotControl = activeRun === null || view !== 'distribution' ? null : <div className="eda-inline-plot-tools">{resultMode === 'facets'
    ? <div className="segmented-control eda-facet-chart-picker" role="group" aria-label="Facet chart">{(['histogram', 'cdf', 'probability', 'box'] as const).map((chart) => <button aria-pressed={facetChart === chart} className={facetChart === chart ? 'is-active' : ''} key={chart} onClick={() => setFacetChart(chart)} type="button">{chart === 'histogram' ? 'Histogram' : chart === 'cdf' ? 'CDF' : chart === 'probability' ? 'Probability' : 'Box plot'}</button>)}</div>
    : <div className="segmented-control eda-detail-chart-picker" role="group" aria-label="Distribution chart"><button className={distributionChart === 'all' ? 'is-active' : ''} onClick={() => setDistributionChart('all')} type="button">All</button><button className={distributionChart === 'histogram' ? 'is-active' : ''} onClick={() => setDistributionChart('histogram')} type="button">Histogram</button><button className={distributionChart === 'cdf' ? 'is-active' : ''} onClick={() => setDistributionChart('cdf')} type="button">CDF</button><button className={distributionChart === 'probability' ? 'is-active' : ''} onClick={() => setDistributionChart('probability')} type="button">Probability</button><button className={distributionChart === 'box' ? 'is-active' : ''} onClick={() => setDistributionChart('box')} type="button">Box plot</button></div>}</div>
  const spatialAxisControl = activeRun === null || view !== 'swath' ? null : <div className="eda-inline-plot-tools eda-spatial-tool-control"><span>Spatial axis</span><div className="segmented-control" role="group" aria-label="Spatial axis">{(['easting', 'northing', 'depth'] as const).map((axis) => <button aria-pressed={swathAxis === axis} className={swathAxis === axis ? 'is-active' : ''} key={axis} onClick={() => setSwathAxis(axis)} type="button">{axis}</button>)}</div></div>
  const contextualTools = activeRun === null || view === 'statistics' || view === 'downhole' ? null : <div className="eda-context-toolbar" role="region" aria-label={`${view === 'distribution' ? 'Distribution' : view === 'relationships' ? 'Relationships' : 'Spatial'} tools`}>
    <div className="eda-context-toolbar-title"><strong>{view === 'distribution' ? 'Distribution' : view === 'relationships' ? 'Relationships' : 'Spatial'}</strong><span>View tools</span></div>
    {supportsPopulationModes ? <div className="eda-context-tool-group"><span>Layout</span>{resultModeControl}</div> : null}
    {detailVariableControl}
    {relationshipViewControl === null ? null : <div className="eda-context-tool-group"><span>Layout</span>{relationshipViewControl}</div>}
    {relationshipMatrixControl}
    {distributionPlotControl === null ? null : <div className="eda-context-tool-group"><span>Chart</span>{distributionPlotControl}</div>}
    {spatialAxisControl}
    {view === 'distribution' ? <div className="eda-context-tool-group eda-context-series-group"><span>Series</span><div aria-label="Distribution overlays" className="eda-inline-overlay-tools" role="group">
      <label className="eda-overlay-toggle is-locked"><input checked disabled readOnly type="checkbox" /><span>Raw</span></label>
      <label className="eda-overlay-toggle"><input checked={declusteringEnabled} onChange={(event) => { setDeclusteringEnabled(event.target.checked); if (!event.target.checked) setDeclusteringSettingsOpen(false) }} type="checkbox" /><span>Declustered</span></label>
      {declusteringEnabled ? <div className="eda-settings-popover-wrap" ref={declusteringSettingsRef}><button aria-expanded={declusteringSettingsOpen} aria-haspopup="dialog" className="eda-declustering-settings" onClick={() => setDeclusteringSettingsOpen((open) => !open)} type="button"><Settings2 size={13} /><span>Declustering</span><small>{declusteringSettingsText}</small></button>{declusteringSettingsOpen ? <div aria-label="Declustering settings" className="eda-settings-popover" role="dialog"><label><span>Method</span><select aria-label="Declustering method" onChange={(event) => setWeightingMethod(event.target.value as WeightingMethod)} value={weightingMethod}>{Object.entries(weightingLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><ChevronDown size={13} /></label>{weightingMethod === 'cell-declustering' ? <label><span>Cell size</span><div className="eda-parameter-input"><input aria-label="Declustering cell size in metres" min="0.1" onChange={(event) => setDeclusteringCellSize(Math.max(0.1, Number(event.target.value) || 0.1))} step="1" type="number" value={declusteringCellSize} /><small>m</small></div></label> : <p>{weightingMethod === 'equal-hole' ? 'Each drillhole contributes equal total weight.' : 'Weights follow the recorded interval length.'}</p>}</div> : null}</div> : null}
    </div></div> : null}
  </div>

  return <div className="page explore-page">
    <h1 className="sr-only">Exploratory data analysis</h1>

    <div className="analysis-toolbar eda-toolbar eda-run-toolbar">
      <label className="tool-select tool-select-field eda-dataset-select"><span>Dataset</span><select aria-label="EDA dataset" onChange={(event) => selectDataset(event.target.value)} value={dataset.id}><EdaDatasetOptions datasets={datasets} /></select><ChevronDown size={14} /></label>
      <details className="eda-variable-picker"><summary aria-label="Select EDA variables"><span>Variables</span><strong>{dataset.variables.filter((item) => variableKeys.includes(item.key)).map((item) => item.shortLabel).join(', ')}</strong><ChevronDown size={14} /></summary><div>{dataset.variables.map((item) => <label key={item.key}><input checked={variableKeys.includes(item.key)} onChange={() => toggleVariable(item.key)} type="checkbox" /><span>{item.shortLabel}</span><small>{item.label} · {item.unit}</small></label>)}</div></details>
      {activeFilterKeys.map((key) => {
        const dimension = dataset.dimensions.find((candidate) => candidate.key === key)
        if (dimension === undefined) return null
        return <div className="eda-filter-control" key={key}><label className="tool-select tool-select-field"><span>{dimension.label}</span><select aria-label={`Filter by ${dimension.label}`} onChange={(event) => { setFilterValues((current) => ({ ...current, [key]: event.target.value })); clearSelection() }} value={filterValues[key] ?? 'all'}><option value="all">All {dimension.label.toLowerCase()}</option>{dimensionValues(key).map((value) => <option key={value} value={value}>{value}</option>)}</select><ChevronDown size={14} /></label><button aria-label={`Remove ${dimension.label} filter`} onClick={() => removeFilter(key)} type="button"><X size={13} /></button></div>
      })}
      <label className="tool-select tool-select-field eda-add-filter"><span>Filters</span><select aria-label="Add a dataset filter" disabled={activeFilterKeys.length === dataset.dimensions.length} onChange={(event) => addFilter(event.target.value)} value=""><option value="">Add filter…</option>{dataset.dimensions.filter((dimension) => !activeFilterKeys.includes(dimension.key)).map((dimension) => <option key={dimension.key} value={dimension.key}>{dimension.label}</option>)}</select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field"><span>Compare by</span><select aria-label="Compare populations by" onChange={(event) => { const value = event.target.value || null; setCompareBy(value); if (value === null || value === secondGroup) setSecondGroup(null) }} value={compareBy ?? ''}><option value="">None</option>{dataset.dimensions.map((dimension) => <option key={dimension.key} value={dimension.key}>{dimension.label}</option>)}</select><ChevronDown size={14} /></label>
      <label className="tool-select tool-select-field"><span>Second group</span><select aria-label="Second grouping dimension" disabled={compareBy === null} onChange={(event) => setSecondGroup(event.target.value || null)} value={secondGroup ?? ''}><option value="">None</option>{dataset.dimensions.filter((dimension) => dimension.key !== compareBy).map((dimension) => <option key={dimension.key} value={dimension.key}>{dimension.label}</option>)}</select><ChevronDown size={14} /></label>
      <div className="toolbar-spacer" />
      <div className={`eda-run-control ${configurationChanged ? 'is-stale' : ''}`}>{activeRun === null ? null : <span>{configurationChanged ? 'Configuration changed' : `Run #${String(activeRun.runNumber).padStart(2, '0')} · Up to date`}</span>}{activeRun === null || configurationChanged ? <button className="primary-button" disabled={runEngine.pending || variableKeys.length === 0} onClick={startRun} type="button">{runEngine.pending ? <RefreshCw className="is-spinning" size={13} /> : <Play size={13} />}{runEngine.pending ? 'Running…' : activeRun === null ? 'Run analysis' : 'Update analysis'}</button> : null}</div>
    </div>

    <div className="eda-view-tabs eda-tool-tabs" role="tablist" aria-label="EDA views">
      <button aria-selected={view === 'statistics'} className={view === 'statistics' ? 'is-active' : ''} onClick={() => openView('statistics')} role="tab" type="button"><TableProperties aria-hidden="true" size={15} /><strong>Summary</strong></button>
      <button aria-selected={view === 'distribution'} className={view === 'distribution' ? 'is-active' : ''} onClick={() => openView('distribution')} role="tab" type="button"><BarChart3 aria-hidden="true" size={15} /><strong>Distribution</strong></button>
      <button aria-selected={view === 'relationships'} className={view === 'relationships' ? 'is-active' : ''} onClick={() => openView('relationships')} role="tab" type="button"><ScatterChart aria-hidden="true" size={15} /><strong>Relationships</strong></button>
      <button aria-selected={view === 'swath'} className={view === 'swath' ? 'is-active' : ''} onClick={() => openView('swath')} role="tab" type="button"><ChartSpline aria-hidden="true" size={15} /><strong>Spatial</strong></button>
      <button aria-selected={view === 'downhole'} className={view === 'downhole' ? 'is-active' : ''} onClick={() => openView('downhole')} role="tab" type="button"><DownholeCorrelationIcon size={15} /><strong>Downhole correlation</strong></button>
    </div>
    {contextualTools}

    {runEngine.error !== null ? <div className="eda-engine-error" role="alert">{runEngine.error}. The previous cached run remains available.</div> : null}

    {view === 'downhole' ? <DownholeCorrelationWorkspace embedded /> : activeRun === null ? <section className="panel eda-run-empty"><LayoutDashboard size={22} /><div><h2>Configure once, then run the full analysis</h2><p>GeoEye will calculate every requested variable and valid population combination. Results stay interactive until you update the run.</p></div><button className="primary-button" disabled={runEngine.pending} onClick={startRun} type="button"><Play size={13} /> Run analysis</button></section> : <>
      {supportsPopulationModes && resultMode === 'facets' ? <section className="panel eda-facets-panel">
        {view === 'distribution' ? <GeoEyeFacetChart
          ariaLabel={`${facetChart} population facets`}
          buildOption={(result) => facetOption(facetChart, result)}
          chartProps={{ clickSelection: facetChart === 'histogram' ? 'replace' : 'toggle', loading: runEngine.pending }}
          facets={chartFacets}
          onFacetClick={(facet) => openPopulation(facet.id)}
        /> : <GeoEyeFacetChart
          ariaLabel={`${swathAxis} spatial trend facets`}
          buildOption={({ swath: result, variable }) => buildSwathOption(result, {
            x: swathAxis === 'depth' ? 'Downhole depth (m)' : `${swathAxis} (m)`,
            y: `${variable.label} (${variable.unit})`,
          })}
          chartProps={{ clickSelection: 'replace', loading: runEngine.pending }}
          facets={swathFacets}
          onFacetClick={(facet) => openPopulation(facet.id)}
        />}
      </section> : null}

      {(!supportsPopulationModes || resultMode === 'detail') && activePopulation !== undefined && activeVariable !== undefined && activeDataset !== undefined ? <>
        {(view === 'distribution' || view === 'swath') && activePopulation.insufficient ? <div className="eda-population-banner" role="status"><AlertTriangle size={14} /><span><strong>Minimum-population warning</strong>This population has n = {activeResult?.sample.summary.count ?? 0}; results remain visible but may be unstable below n = {activeRun.configuration.minimumPopulationSize}.</span></div> : null}

        {view === 'statistics' ? <section className="panel eda-statistics-panel">
          <div className="eda-summary-table-wrap">
            <table className="eda-summary-table">
              <thead><tr><th>Variable</th><th>Valid</th><th>Missing</th><th>Mean</th><th>Median</th><th>Std dev</th><th>CV</th><th>Minimum</th><th>P25</th><th>P75</th><th>P95</th><th>Maximum</th></tr></thead>
              <tbody>{summaryRows.map(({ summary, variable }) => <tr className={summary.count < activeRun.configuration.minimumPopulationSize ? 'is-insufficient' : ''} key={variable.key}><th scope="row"><strong>{variable.shortLabel}</strong><small>{variable.label} · {variable.unit}</small></th><td>{summary.count.toLocaleString()}</td><td>{summary.missing.toLocaleString()}</td><td>{formatNumber(summary.mean, variable)}</td><td>{formatNumber(summary.median, variable)}</td><td>{formatNumber(summary.standardDeviation, variable)}</td><td>{summary.coefficientOfVariation?.toFixed(3) ?? '—'}</td><td>{formatNumber(summary.minimum, variable)}</td><td>{formatNumber(summary.q1, variable)}</td><td>{formatNumber(summary.q3, variable)}</td><td>{formatNumber(summary.p95, variable)}</td><td>{formatNumber(summary.maximum, variable)}</td></tr>)}</tbody>
            </table>
          </div>
        </section> : null}

        {view === 'distribution' ? <div className="eda-distribution-detail">
          <section className="panel eda-main-panel">
            <div className={`eda-chart-grid eda-distribution-grid ${distributionChart !== 'all' ? 'is-single' : ''}`}>
              {distributionChart === 'all' || distributionChart === 'histogram' ? <ChartFrame detail={histogramDetail} title={`Histogram · ${activeVariable.shortLabel}`}>{chartData === null ? null : <GeoEyeChart ariaLabel={`${activeVariable.label} histogram`} brushSelection="replace" clickSelection="replace" loading={runEngine.pending} option={chartData.histogram} />}</ChartFrame> : null}
              {distributionChart === 'all' || distributionChart === 'cdf' ? <ChartFrame detail={cdfDetail} title="CDF">{chartData === null ? null : <GeoEyeChart ariaLabel={`${activeVariable.label} cumulative distribution`} loading={runEngine.pending} option={chartData.cdf} />}</ChartFrame> : null}
              {distributionChart === 'all' || distributionChart === 'probability' ? <ChartFrame detail={probabilityDetail} title="Probability plot">{chartData === null ? null : <GeoEyeChart ariaLabel={`${activeVariable.label} probability plot`} loading={runEngine.pending} option={chartData.probability} />}</ChartFrame> : null}
              {distributionChart === 'all' || distributionChart === 'box' ? <ChartFrame detail="Raw and declustered five-number summaries" title="Box plot">{chartData === null ? null : <GeoEyeChart ariaLabel={`${activeVariable.label} box plot`} clickSelection="replace" loading={runEngine.pending} option={chartData.box} />}</ChartFrame> : null}
            </div>
          </section>
          <RawSourceTable observations={populationObservations} selectedIds={selectedSet} variable={activeVariable} />
        </div> : null}

        {view === 'relationships' ? <div className="eda-workspace eda-workspace-wide eda-relationship-workspace"><section className="panel eda-main-panel"><div className="eda-relationship-view">
          <div className="eda-relationship-config">
            <div className="eda-relationship-datasets"><span>Datasets</span>{relationshipDatasets.map((item) => <span className="eda-dataset-chip" key={item.id}>{item.name}{relationshipDatasets.length > 1 ? <button aria-label={`Remove ${item.name}`} onClick={() => removeRelationshipDataset(item.id)} type="button"><X size={12} /></button> : null}</span>)}<select aria-label="Add relationship dataset" disabled={availableRelationshipDatasets.length === 0} onChange={(event) => addRelationshipDataset(event.target.value)} value=""><option value="">{availableRelationshipDatasets.length === 0 ? 'All datasets added' : '+ Add dataset'}</option>{availableRelationshipDatasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small className="eda-match-method">interval-overlap matching</small></div>
            <div className="eda-axis-builder"><strong>X axis</strong><label><span>Dataset</span><select aria-label="X axis dataset" onChange={(event) => { const next = datasets.find((item) => item.id === event.target.value); const variable = next?.variables.find((item) => item.dataType !== 'category'); if (variable !== undefined) selectRelationshipAxis('x', event.target.value, variable.key) }} value={xDataset?.id}>{relationshipDatasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Variable</span><select aria-label="X axis variable" onChange={(event) => selectRelationshipAxis('x', xDataset?.id ?? '', event.target.value as EdaVariableKey)} value={xVariable?.key}>{xDataset?.variables.filter((item) => item.dataType !== 'category').map((item) => <option key={item.key} value={item.key}>{item.label} · {item.unit}</option>)}</select></label></div>
            <div className="eda-axis-builder"><strong>Y axis</strong><label><span>Dataset</span><select aria-label="Y axis dataset" onChange={(event) => { const next = datasets.find((item) => item.id === event.target.value); const variable = next?.variables.find((item) => item.dataType !== 'category'); if (variable !== undefined) selectRelationshipAxis('y', event.target.value, variable.key) }} value={yDataset?.id}>{relationshipDatasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Variable</span><select aria-label="Y axis variable" onChange={(event) => selectRelationshipAxis('y', yDataset?.id ?? '', event.target.value as EdaVariableKey)} value={yVariable?.key}>{yDataset?.variables.filter((item) => item.dataType !== 'category').map((item) => <option key={item.key} value={item.key}>{item.label} · {item.unit}</option>)}</select></label></div>
          </div>

          {relationshipView === 'facets' ? <section className="eda-facets-panel eda-relationship-facets"><GeoEyeFacetChart
            ariaLabel="Relationship population facets"
            buildOption={({ relationship }) => buildScatterOption(relationship, { x: `${xVariable?.shortLabel ?? 'X'} (${xVariable?.unit ?? ''})`, y: `${yVariable?.shortLabel ?? 'Y'} (${yVariable?.unit ?? ''})` })}
            chartProps={{ clickSelection: 'replace', loading: runEngine.pending }}
            facets={relationshipFacets.map((facet) => ({ ...facet, subtitle: `n = ${facet.result.relationship.matchMetadata.matchedObservationCount.toLocaleString()} · r = ${facet.result.relationship.correlation?.toFixed(3) ?? '—'}` }))}
            onFacetClick={(facet) => openRelationshipFacet(facet.id)}
          /></section> : null}

          {relationshipView === 'detail' ? <div className="eda-relationship-detail">
            <div className="eda-relationship-metrics" aria-label="Relationship diagnostics">
              <span><small>Matched observations</small><strong>{detailRelationship.matchMetadata.matchedObservationCount.toLocaleString()}</strong></span>
              <span><small>Pearson r</small><strong>{detailRelationship.correlation?.toFixed(3) ?? '—'}</strong></span>
              <span><small>Spearman ρ</small><strong>{detailRelationship.spearman?.toFixed(3) ?? '—'}</strong></span>
              <span><small>Regression R² <em>diagnostic</em></small><strong>{detailRelationship.regression?.rSquared.toFixed(3) ?? '—'}</strong></span>
            </div>
            <div className="eda-chart-grid eda-relationship-detail-grid"><ChartFrame detail={`${detailRelationship.matchMetadata.matchedObservationCount.toLocaleString()} matched observations · ${detailRelationship.matchMetadata.method} match${selectedRelationshipFacet === undefined ? '' : ` · ${selectedRelationshipFacet.title}`}`} title={`${xVariable?.shortLabel ?? 'X'} × ${yVariable?.shortLabel ?? 'Y'} scatter plot`}><GeoEyeChart ariaLabel="Selected X and Y relationship scatter plot" brushSelection="replace" clickSelection="toggle" loading={runEngine.pending} option={scatterOption} /></ChartFrame></div>
          </div> : null}

          {relationshipView === 'matrix' ? <div className="eda-chart-grid eda-relationship-matrix-grid"><ChartFrame detail={`${labeledMatrixVariables.length} numeric variables from selected datasets · each cell shows matched n · click a cell to open Detail`} title={`${correlationMethod === 'pearson' ? 'Pearson' : 'Spearman'} correlation matrix`}><GeoEyeChart ariaLabel={`${correlationMethod} correlation matrix`} clickSelection="replace" loading={runEngine.pending} onDatumClick={openMatrixCell} option={matrixOption} renderer="svg" /></ChartFrame></div> : null}
        </div></section>
        {relationshipView === 'detail' && xVariable !== undefined && yVariable !== undefined ? <RelationshipSourceTable pairs={detailRelationship.points} selectedIds={selectedSet} xVariable={xVariable} yVariable={yVariable} /> : null}
        </div> : null}

        {view === 'swath' ? <div className="eda-workspace eda-workspace-wide"><section className="panel eda-main-panel"><div className="eda-spatial-view"><ChartFrame detail="Equal-width bins · click a point to link source observations" title={`${activeVariable.shortLabel} spatial trend`}>{swathOption === null ? null : <GeoEyeChart ariaLabel={`${activeVariable.label} ${swathAxis} spatial trend`} clickSelection="replace" option={swathOption} />}</ChartFrame><div className="eda-swath-table" role="table" aria-label="Spatial bin values"><div className="eda-swath-row is-header" role="row"><span>Bin range</span><span>Samples</span><span>Mean</span><span>Median</span></div>{swath.map((bin) => <div className="eda-swath-row" key={bin.midpoint} role="row"><span>{bin.from.toFixed(1)}–{bin.to.toFixed(1)} m</span><strong>{bin.count}</strong><span>{formatNumber(bin.mean, activeVariable, true)}</span><span>{formatNumber(bin.median, activeVariable, true)}</span></div>)}</div></div></section></div> : null}

      </> : null}
    </>}
  </div>
}

function RawSourceTable({ observations, selectedIds, variable }: { observations: readonly EdaObservation[]; selectedIds: ReadonlySet<string>; variable: EdaVariableDefinition }) {
  return <section className="panel eda-source-data-panel"><div className="eda-source-data-wrap"><table className="eda-source-data-table"><thead><tr><th>Source ID</th><th>Hole</th><th>From</th><th>To</th><th>Lithology</th><th>Alteration</th><th>Domain</th><th>{variable.shortLabel} ({variable.unit})</th></tr></thead><tbody>{observations.map((observation) => { const value = observation.values[variable.key]; return <tr className={selectedIds.has(observation.sourceObservationId) ? 'is-selected' : ''} key={observation.id}><th scope="row"><strong>{observation.sampleId}</strong><small>{observation.sourceObservationId}</small></th><td>{observation.holeId}</td><td>{observation.depthFrom.toFixed(1)}</td><td>{observation.depthTo.toFixed(1)}</td><td>{observation.lithology}</td><td>{observation.dimensions.alteration ?? '—'}</td><td>{observation.dimensions.domain ?? '—'}</td><td>{formatNumber(typeof value === 'number' ? value : null, variable, true)}</td></tr> })}</tbody></table></div></section>
}

function RelationshipSourceTable({ pairs, selectedIds, xVariable, yVariable }: { pairs: readonly JoinedPair[]; selectedIds: ReadonlySet<string>; xVariable: EdaVariableDefinition; yVariable: EdaVariableDefinition }) {
  return <section className="panel eda-source-data-panel eda-relationship-source-panel"><header><div><h3>Linked source observations</h3><p>{pairs.length.toLocaleString()} matched observations · interval-overlap match</p></div></header><div className="eda-source-data-wrap"><table className="eda-source-data-table eda-relationship-source-table"><thead><tr><th>Matched support</th><th>Source observations</th><th>{xVariable.shortLabel} ({xVariable.unit})</th><th>{yVariable.shortLabel} ({yVariable.unit})</th></tr></thead><tbody>{pairs.map((pair) => <tr className={pair.sourceObservationIds.some((id) => selectedIds.has(id)) ? 'is-selected' : ''} key={pair.id}><th scope="row"><strong>{pair.joinKey}</strong><small>interval-overlap</small></th><td>{pair.sourceObservationIds.map((id) => <small className="eda-source-lineage-id" key={id}>{id}</small>)}</td><td>{formatNumber(pair.x, xVariable, true)}</td><td>{formatNumber(pair.y, yVariable, true)}</td></tr>)}</tbody></table></div></section>
}
