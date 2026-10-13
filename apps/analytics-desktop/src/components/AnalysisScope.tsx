import { useMemo } from 'react'
import { ChevronDown, Layers3 } from 'lucide-react'
import { compositeDataset, filterDatasetByIds, type CompositeStats } from '../analysis/compositing.js'
import type { EdaDataset } from '../data/edaTypes.js'
import { useProjectEdaDatasets } from '../data/liveEda.js'
import { readDomainMembershipDocument, type SavedDomainSet } from '../data/domainMembershipStore.js'
import { usePersistentState } from '../state/persistentState.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'

export interface ScopeState { datasetId: string; domainSetId: string; classId: string; compositeLength: number }
export interface AnalysisScope {
  base: EdaDataset | undefined
  dataset: EdaDataset | undefined
  datasets: EdaDataset[]
  domainSets: SavedDomainSet[]
  pending: boolean
  signature: string
  state: ScopeState
  summary: string
  compositeStats: CompositeStats | null
  setState: (next: Partial<ScopeState>) => void
}

/** One shared definition of "the data" for Statistics, Grade and Variography: dataset → domain class → composites. */
export function useAnalysisScope(): AnalysisScope {
  const query = useProjectEdaDatasets()
  const storage = useProjectStorage()
  const [state, set] = usePersistentState<ScopeState>('analysis.scope', { datasetId: '', domainSetId: '', classId: '', compositeLength: 0 })
  const datasets = query.data ?? []
  const base = datasets.find((d) => d.id === state.datasetId) ?? datasets[0]
  const domainSets = useMemo(() => readDomainMembershipDocument(storage).domain_sets.filter((s) => base === undefined || s.provenance.dataset_id === base.id || s.provenance.dataset_id === base.id.split(':')[0]), [storage, base?.id])
  const domainSet = domainSets.find((s) => s.domain_set_id === state.domainSetId)
  const domainClass = domainSet?.classes.find((c) => c.class_id === state.classId)

  const derived = useMemo(() => {
    if (base === undefined) return { dataset: undefined, stats: null }
    let dataset = base
    if (domainClass !== undefined) dataset = filterDatasetByIds(base, new Set([...domainClass.observation_ids, ...domainClass.source_observation_ids]), domainClass.class_label)
    if (state.compositeLength > 0) { const result = compositeDataset(dataset, { length: state.compositeLength }); return { dataset: result.dataset, stats: result.stats } }
    return { dataset, stats: null }
  }, [base, domainClass, state.compositeLength])

  const summary = base === undefined ? 'No dataset' : [base.name, domainClass?.class_label, state.compositeLength > 0 ? `${state.compositeLength} m composites` : null].filter(Boolean).join(' · ')
  return {
    base, dataset: derived.dataset, datasets, domainSets, pending: query.isPending,
    signature: `${base?.id ?? ''}|${domainClass?.class_id ?? ''}|${state.compositeLength}`,
    state, summary, compositeStats: derived.stats,
    setState: (next) => set((current) => ({ ...current, ...next })),
  }
}

export function AnalysisScopePicker({ scope }: { scope: AnalysisScope }) {
  const { state, setState } = scope
  const classes = scope.domainSets.find((s) => s.domain_set_id === state.domainSetId)?.classes ?? []
  return <>
    <label className="tool-select tool-select-field eda-dataset-select"><span>Dataset</span><select onChange={(e) => setState({ datasetId: e.target.value, domainSetId: '', classId: '' })} value={scope.base?.id ?? ''}>{scope.datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select><ChevronDown size={14} /></label>
    <label className="tool-select tool-select-field" title={scope.domainSets.length === 0 ? 'Save a domain set on the Domain page to filter by domain' : undefined}><span><Layers3 size={11} /> Domain</span>
      <select disabled={scope.domainSets.length === 0} onChange={(e) => setState({ domainSetId: e.target.value, classId: '' })} value={state.domainSetId}><option value="">All data</option>{scope.domainSets.map((s) => <option key={s.domain_set_id} value={s.domain_set_id}>{s.domain_set_id} v{s.template_version}</option>)}</select><ChevronDown size={14} /></label>
    {state.domainSetId !== '' ? <label className="tool-select tool-select-field"><span>Class</span><select onChange={(e) => setState({ classId: e.target.value })} value={state.classId}><option value="">All classes</option>{classes.map((c) => <option key={c.class_id} value={c.class_id}>{c.class_label} · {c.observation_ids.length}</option>)}</select><ChevronDown size={14} /></label> : null}
    <label className="tool-select tool-select-field tool-number-field" title="0 = raw samples"><span>Composite (m)</span><input inputMode="decimal" onChange={(e) => setState({ compositeLength: Math.max(0, Number(e.target.value) || 0) })} value={state.compositeLength} /></label>
  </>
}
