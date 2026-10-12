import type { Dataset, FieldLoggingDataset } from '@geoeye/datapool-client'

/** Revisions remain in the data contract; only saved artifacts expose versions. */
export function datasetStateLabel(dataset: Pick<Dataset, 'sourceSystem' | 'currentVersion'>): string {
  return dataset.sourceSystem?.startsWith('field.') ? 'Live' : `v${dataset.currentVersion}`
}

export function datasetDisplayLabel(dataset: Pick<Dataset, 'name' | 'sourceSystem' | 'currentVersion'>): string {
  return `${dataset.name} · ${datasetStateLabel(dataset)}`
}

export function fieldLoggingDisplayLabel(dataset: Pick<FieldLoggingDataset, 'id' | 'name' | 'version'>): string {
  const state = /:generated(?::v\d+)?$/.test(dataset.id) ? `CSV v${dataset.version}` : 'Live'
  return `${dataset.name} · ${state}`
}
