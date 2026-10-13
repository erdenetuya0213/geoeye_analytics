import type { EdaDataset, EdaDatasetKind } from './edaTypes.js'
import { EDA_DATASET_CATALOG, edaDatasetKind } from './liveEda.js'

/** Id of the "All" dataset of a class: every table of that source analysed as one population. */
export const ALL_SCOPE_PREFIX = 'class-all:'

export interface DatasetClass { datasets: EdaDataset[]; id: EdaDatasetKind; label: string }

const byKey = <T extends { key: string }>(items: readonly T[]): T[] => [...new Map(items.map(item => [item.key, item])).values()]

export function mergeDatasets(id: string, name: string, datasets: readonly EdaDataset[]): EdaDataset | undefined {
  const first = datasets[0]
  if (first === undefined) return undefined
  if (datasets.length === 1) return { ...first, id, name }
  const observations = datasets.flatMap(dataset => dataset.observations)
  return {
    dimensions: byKey(datasets.flatMap(dataset => [...dataset.dimensions])),
    id,
    kind: first.kind ?? edaDatasetKind(first),
    name,
    observations,
    producer: first.producer,
    project: first.project,
    snapshotAt: datasets.map(dataset => dataset.snapshotAt).sort().at(-1) ?? first.snapshotAt,
    source: first.source,
    support: `${datasets.length} tables · ${observations.length.toLocaleString()} records`,
    variables: byKey(datasets.flatMap(dataset => [...dataset.variables])),
  }
}

/** Adds the "All" dataset of every class, so a class can be chosen without picking one of its tables. */
export function withClassScopes(datasets: readonly EdaDataset[]): EdaDataset[] {
  const scopes = EDA_DATASET_CATALOG.flatMap(({ id, label }) => {
    if (id === 'integrated') return []
    const members = datasets.filter(dataset => edaDatasetKind(dataset) === id)
    const merged = mergeDatasets(`${ALL_SCOPE_PREFIX}${id}`, `All ${label}`, members)
    return merged === undefined ? [] : [merged]
  })
  return [...datasets, ...scopes]
}

/** The classes a person picks from, in catalog order, each with its "All" table first. */
export function datasetClasses(datasets: readonly EdaDataset[]): DatasetClass[] {
  return EDA_DATASET_CATALOG.flatMap(({ id, label }) => {
    const members = datasets.filter(dataset => edaDatasetKind(dataset) === id)
    if (members.length === 0) return []
    const all = members.filter(dataset => dataset.id.startsWith(ALL_SCOPE_PREFIX))
    return [{ datasets: [...all, ...members.filter(dataset => !dataset.id.startsWith(ALL_SCOPE_PREFIX))], id, label }]
  })
}

export const isAllScope = (dataset: Pick<EdaDataset, 'id'> | undefined) => dataset?.id.startsWith(ALL_SCOPE_PREFIX) === true

/**
 * What to show for a saved selection. The table wins when it is still there; otherwise the class is
 * kept and falls back to its All, so a re-import or a renamed table does not move the analysis
 * to another source.
 */
export function resolveScope(classes: readonly DatasetClass[], datasetId: string, classId: string): { dataset: EdaDataset | undefined; group: DatasetClass | undefined } {
  const group = classes.find(item => item.datasets.some(dataset => dataset.id === datasetId))
    ?? classes.find(item => item.id === classId)
    ?? classes[0]
  const dataset = group?.datasets.find(item => item.id === datasetId) ?? group?.datasets[0]
  return { dataset, group }
}
