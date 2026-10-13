import type { FieldLoggingDataset } from '@geoeye/datapool-client'
import { csv } from './resultExport.js'

/** The tabular view of one template, if the local snapshot holds it. */
export function loggingDatasetFor(datasets: readonly FieldLoggingDataset[], template: { id: string; name: string } | null): FieldLoggingDataset | undefined {
  if (template === null) return undefined
  return datasets.find(dataset => dataset.id === template.id) ?? datasets.find(dataset => dataset.name === template.name)
}

/** One template as a sheet: every logged row of every borehole, hole and interval first, then the template's own fields. */
export function loggingSheet(dataset: FieldLoggingDataset, holeNames: ReadonlyMap<string, string>): { header: string[]; rows: (string | number | null)[][] } {
  const labels = new Set(['Hole ID', 'From', 'To'])
  const header = ['Hole ID', 'From', 'To', ...dataset.columns.map(column => {
    // Two fields of one template may share a label; the field key keeps them apart.
    const label = labels.has(column.label) ? `${column.label} [${column.key}]` : column.label
    labels.add(label)
    return label
  })]
  const rows = dataset.records
    .map(record => ({ hole: record.holeId === null ? '' : holeNames.get(record.holeId) ?? record.holeId, record }))
    .sort((left, right) => left.hole.localeCompare(right.hole) || (left.record.depthFrom ?? 0) - (right.record.depthFrom ?? 0))
    .map(({ hole, record }) => [hole, record.depthFrom, record.depthTo, ...dataset.columns.map(column => {
      const value = record.values[column.key]
      return value === undefined || value === null ? '' : typeof value === 'boolean' ? String(value) : value
    })])
  return { header, rows }
}

export function loggingSheetCsv(dataset: FieldLoggingDataset, holeNames: ReadonlyMap<string, string>): string {
  const sheet = loggingSheet(dataset, holeNames)
  return csv(sheet.header, sheet.rows)
}
