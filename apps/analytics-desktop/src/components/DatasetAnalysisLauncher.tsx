import { BarChart3, ChartScatter, Database, GitBranch } from 'lucide-react'
import { useProjectEdaDatasets } from '../data/liveEda.js'
import { prepareDatasetAnalysis } from '../data/datasetAnalysisNavigation.js'
import { usePersistentState } from '../state/persistentState.js'
import { writePersistedState } from '../state/persistentState.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'
import { useGeoEyeSelection } from '../state/SelectionContext.js'
import type { SectionId } from '../types.js'

export function DatasetAnalysisLauncher({ onNavigate }: { onNavigate: (section: SectionId) => void }) {
  const query = useProjectEdaDatasets()
  const storage = useProjectStorage()
  const { clearSelection } = useGeoEyeSelection()
  const [selectedId, setSelectedId] = usePersistentState('data.analysisDatasetId', '')
  const datasets = query.data ?? []
  const selected = datasets.find((dataset) => dataset.id === selectedId) ?? datasets[0]
  const open = (target: 'explore' | 'multivariate') => {
    if (selected === undefined) return
    prepareDatasetAnalysis(storage, selected, target)
    clearSelection()
    onNavigate(target)
  }
  return <section className="panel dataset-analysis-launcher">
    <header><div><h2>Analyze a dataset</h2><p>Select a local dataset, then open its numeric fields in an analysis.</p></div>
      <div className="dataset-analysis-actions">
        <button className="button button-secondary" disabled={selected === undefined} onClick={() => open('explore')} type="button"><BarChart3 size={16} /> Statistics</button>
        <button className="button button-secondary" disabled={selected === undefined} onClick={() => open('multivariate')} type="button"><ChartScatter size={16} /> Multivariate</button>
        <button className="button button-secondary" disabled={selected === undefined} onClick={() => {
          if (selected === undefined) return
          writePersistedState(storage, 'multivariate.analysisMode', 'mineral')
          writePersistedState(storage, 'mineralAssessment.baseId', selected.id)
          clearSelection()
          onNavigate('multivariate')
        }} type="button"><GitBranch size={16} /> Mineral evidence</button>
      </div>
    </header>
    {query.isLoading ? <p role="status">Loading local datasets…</p> : null}
    {query.isError ? <p role="alert">Unable to load local datasets: {query.error.message}</p> : null}
    {!query.isLoading && !query.isError && datasets.length === 0 ? <p>No local datasets are available yet. Refresh or import data first.</p> : null}
    <div className="dataset-analysis-list">{datasets.map((dataset) => <button aria-pressed={selected?.id === dataset.id} className={`dataset-analysis-choice ${selected?.id === dataset.id ? 'is-selected' : ''}`} key={dataset.id} onClick={() => setSelectedId(dataset.id)} type="button">
      <Database size={18} /><span><strong>{dataset.name}</strong><small>{dataset.observations.length.toLocaleString()} records · {dataset.variables.filter((variable) => variable.dataType !== 'category').length} numeric fields</small></span>
    </button>)}</div>
  </section>
}
