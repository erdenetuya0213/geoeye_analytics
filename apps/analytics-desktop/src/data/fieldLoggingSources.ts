import type { FieldLoggingDataset } from '@geoeye/datapool-client'

/** Live records cover the project; completed exports are historical partial copies. */
export function liveFieldLoggingDatasets(datasets: readonly FieldLoggingDataset[]): FieldLoggingDataset[] {
  return datasets.filter(dataset => !/:generated(?::v\d+)?$/.test(dataset.id))
}
