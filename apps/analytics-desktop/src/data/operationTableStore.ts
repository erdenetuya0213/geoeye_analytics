import type { TabularImportSection } from '@geoeye/datapool-client'
import type { PersistentStorage } from '../state/persistentState.js'
import { readClassTables } from './classTableStore.js'
import { databaseRows } from './databaseRows.js'
import { liveFieldLoggingDatasets } from './fieldLoggingSources.js'
import { effectiveDrillholes, type LocalDrillholeDraft, type LocalProjectSnapshot, type LocalTabularDraft } from './localProjectDb.js'
import { operationTable, type OperationTable } from './tableOperations.js'

/** A table made by a Data operation, or a CSV brought in for one. Kept with the project, one document per table. */
export interface StoredOperationTable {
  columns: string[]
  createdAt: string
  id: string
  name: string
  note: string
  rows: string[][]
}

const indexKey = 'geoeye.analytics.operation-tables.v1'
const tableKey = (id: string) => `${indexKey}.${id}`

function readIds(storage: PersistentStorage): string[] {
  try {
    const ids = JSON.parse(storage.getItem(indexKey) ?? '[]') as unknown
    return Array.isArray(ids) ? ids.map(String) : []
  } catch {
    return []
  }
}

export function readOperationTables(storage: PersistentStorage): StoredOperationTable[] {
  return readIds(storage).flatMap(id => {
    try {
      const table = JSON.parse(storage.getItem(tableKey(id)) ?? 'null') as StoredOperationTable | null
      return table !== null && Array.isArray(table.columns) && Array.isArray(table.rows) ? [table] : []
    } catch {
      return []
    }
  })
}

export function writeOperationTable(storage: PersistentStorage, table: StoredOperationTable): void {
  storage.setItem(tableKey(table.id), JSON.stringify(table))
  const ids = readIds(storage)
  if (!ids.includes(table.id)) storage.setItem(indexKey, JSON.stringify([...ids, table.id]))
}

export function removeOperationTable(storage: PersistentStorage, id: string): void {
  storage.removeItem(tableKey(id))
  storage.setItem(indexKey, JSON.stringify(readIds(storage).filter(item => item !== id)))
}

const cell = (value: unknown) => value === null || value === undefined ? '' : String(value)

/** Every table of the open project that has a hole and a depth: logging templates, lab classes, strength tests, XRF, spectral and operation tables. */
export function projectOperationTables(input: {
  drillholeDraft: LocalDrillholeDraft | null
  snapshot: LocalProjectSnapshot | null
  storage: PersistentStorage
  tabularDrafts: Partial<Record<TabularImportSection, LocalTabularDraft>>
}): OperationTable[] {
  const { drillholeDraft, snapshot, storage, tabularDrafts } = input
  const holeNames = new Map(effectiveDrillholes(snapshot, drillholeDraft).map(hole => [hole.id, hole.name]))
  return [
    ...liveFieldLoggingDatasets(snapshot?.fieldLogging.datasets ?? []).map(dataset => operationTable(`logging:${dataset.id}`, dataset.name, 'Logging',
      ['Hole ID', 'From', 'To', ...dataset.columns.map(column => column.label)],
      dataset.records.map(record => [holeNames.get(record.holeId ?? '') ?? cell(record.holeId), cell(record.depthFrom), cell(record.depthTo ?? record.depthFrom), ...dataset.columns.map(column => cell(record.values[column.key]))]))),
    ...(['laboratory', 'strength'] as const).flatMap(section => readClassTables(storage, section)
      .map(table => operationTable(`${section}:${table.id}`, table.name, section === 'laboratory' ? 'Lab' : 'Strength', table.columns, table.rows))),
    ...(['xrf', 'spectral'] as const).map(section => {
      const table = tabularDrafts[section] ?? databaseRows(section, snapshot, drillholeDraft)
      return operationTable(section, section === 'xrf' ? 'XRF' : 'Spectral', 'Scans', table.columns, table.rows)
    }),
    ...readOperationTables(storage).map(table => operationTable(`operation:${table.id}`, table.name, 'Operations', table.columns, table.rows)),
  ].filter((table): table is OperationTable => table !== null && table.rows.length > 0)
}
