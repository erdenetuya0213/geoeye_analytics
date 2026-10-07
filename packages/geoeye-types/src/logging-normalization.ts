import type { FieldLoggingDataset } from './logging.js'

/** Prefer current derived outputs to persisted calculation snapshots without
 * mutating the source or collapsing independent primary fields by label. */
export function normalizeFieldLoggingDataset(dataset: FieldLoggingDataset): FieldLoggingDataset {
  const derivedLabels = new Set(dataset.columns.filter(column => column.key.startsWith('derived:')).map(column => column.label))
  const replaced = new Set(dataset.columns.filter(column => column.key.startsWith('calculation_') && derivedLabels.has(column.label)).map(column => column.key))
  if (replaced.size === 0) return dataset
  return {
    ...dataset,
    columns: dataset.columns.filter(column => !replaced.has(column.key)),
    records: dataset.records.flatMap(record => {
      if (!Object.keys(record.values).some(key => replaced.has(key))) return [record]
      const values = Object.fromEntries(Object.entries(record.values).filter(([key]) => !replaced.has(key)))
      // Superseded calculation-only rows disappear; primary values stay.
      if (!Object.values(values).some(value => value !== null && value !== undefined && value !== '')) return []
      return [{ ...record, values }]
    }),
  }
}
