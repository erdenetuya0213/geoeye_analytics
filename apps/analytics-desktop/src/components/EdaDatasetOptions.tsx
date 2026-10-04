import type { EdaDataset } from '../data/edaTypes.js'
import { EDA_DATASET_CATALOG, edaDatasetKind } from '../data/liveEda.js'

export function EdaDatasetOptions({ datasets }: { datasets: readonly EdaDataset[] }) {
  if (!datasets.some((dataset) => dataset.source === 'live')) {
    return <>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</>
  }
  return <>{EDA_DATASET_CATALOG.map((group) => {
    const matches = datasets.filter((dataset) => edaDatasetKind(dataset) === group.id)
    return <optgroup key={group.id} label={group.label}>
      {matches.length === 0
        ? <option disabled value={`missing:${group.id}`}>No local data available</option>
        : matches.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
    </optgroup>
  })}</>
}
