import type { FieldLoggingDataset } from '@geoeye/datapool-client'
import { normalizeFieldLoggingDataset } from '@geoeye/datapool-client'

/** Importers store unknown dropdown codes as `<slug>:<code>`, e.g. `relog-unassigned:40`. */
const CODED_NUMBER = /^([a-z][a-z0-9_-]*:)(-?\d+(?:\.\d+)?)$/i

/**
 * A dropdown-type field that only ever holds `<prefix>:<number>` codes is a
 * measurement that was entered through a dropdown (e.g. Schmidt rebound). Turn
 * it into a numeric column so analyses can use it. Mixed or lettered codes
 * (`relog-unassigned:S3`) and real dictionary IDs stay categories.
 */
export function numericFromCodedColumns(dataset: FieldLoggingDataset): FieldLoggingDataset {
  const converted = new Set<string>()
  for (const column of dataset.columns) {
    if (column.dataType === 'numeric' || column.dataType === 'boolean' || column.dataType === 'datetime') continue
    const prefixes = new Set<string>()
    let count = 0
    let coded = true
    for (const record of dataset.records) {
      const value = record.values[column.key]
      if (value === null || value === undefined || value === '') continue
      const match = typeof value === 'string' ? CODED_NUMBER.exec(value) : null
      if (match === null) { coded = false; break }
      prefixes.add(match[1]!.toLowerCase())
      count += 1
    }
    if (coded && count > 0 && prefixes.size === 1) converted.add(column.key)
  }
  if (converted.size === 0) return dataset
  return {
    ...dataset,
    columns: dataset.columns.map(column => converted.has(column.key) ? { ...column, dataType: 'numeric' as const } : column),
    records: dataset.records.map(record => {
      const values = { ...record.values }
      for (const key of converted) {
        const value = values[key]
        const match = typeof value === 'string' ? CODED_NUMBER.exec(value) : null
        values[key] = match === null ? null : Number(match[2])
      }
      return { ...record, values }
    }),
  }
}

/** Shared read-time normalisation for Field logging datasets used by analyses. */
export function prepareFieldLoggingDataset(dataset: FieldLoggingDataset): FieldLoggingDataset {
  return numericFromCodedColumns(normalizeFieldLoggingDataset(dataset))
}

/** Live records cover the project; completed exports are historical partial copies. */
export function liveFieldLoggingDatasets(datasets: readonly FieldLoggingDataset[]): FieldLoggingDataset[] {
  return datasets.filter(dataset => !/:generated(?::v\d+)?$/.test(dataset.id)).map(prepareFieldLoggingDataset)
}
