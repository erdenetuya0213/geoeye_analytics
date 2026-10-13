import { ChevronDown } from 'lucide-react'
import { useEffect } from 'react'
import { datasetClasses, isAllScope, resolveScope } from '../data/datasetScope.js'
import type { EdaDataset } from '../data/edaTypes.js'
import { edaDatasetKind } from '../data/liveEda.js'
import { usePersistentState } from '../state/persistentState.js'

/** Class first (Logging, Strength, Lab…), then the table inside it: a template, a test, a lab class — or All. */
export function DatasetScopePicker({ ariaPrefix, datasets, onChange, storageKey, value }: {
  ariaPrefix: string
  datasets: readonly EdaDataset[]
  onChange: (datasetId: string) => void
  /** Page the selection belongs to; the class is remembered under it. */
  storageKey: string
  value: string
}) {
  const classes = datasetClasses(datasets)
  const [savedClass, setSavedClass] = usePersistentState(`${storageKey}.datasetClass`, '')
  const { dataset, group } = resolveScope(classes, value, savedClass)

  // Keep the page and the saved class on whatever is actually shown.
  useEffect(() => {
    if (dataset === undefined || group === undefined) return
    if (group.id !== savedClass) setSavedClass(group.id)
    if (dataset.id !== value) onChange(dataset.id)
  }, [dataset?.id, group?.id, savedClass, value])

  const selectClass = (classId: string) => {
    const next = classes.find(item => item.id === classId)
    if (next?.datasets[0] === undefined) return
    setSavedClass(next.id)
    onChange(next.datasets[0].id)
  }

  return <>
    <label className="tool-select tool-select-field eda-dataset-select">
      <span>Class</span>
      <select aria-label={`${ariaPrefix} class`} onChange={event => selectClass(event.target.value)} value={group?.id ?? ''}>
        {classes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <ChevronDown size={14} />
    </label>
    <label className="tool-select tool-select-field eda-dataset-select">
      <span>Table</span>
      <select aria-label={`${ariaPrefix} table`} onChange={event => onChange(event.target.value)} value={dataset?.id ?? ''}>
        {(group?.datasets ?? []).map(item => <option key={item.id} value={item.id}>{isAllScope(item) ? 'All' : item.name}</option>)}
      </select>
      <ChevronDown size={14} />
    </label>
  </>
}

/** The class a dataset belongs to, for summaries and saved runs. */
export const datasetClassLabel = (dataset: EdaDataset | undefined) =>
  dataset === undefined ? '' : datasetClasses([dataset])[0]?.label ?? edaDatasetKind(dataset)
