import type { TabularImportSection } from '@geoeye/datapool-client'
import { headerKey, isRequiredHeader, parseClassRows, requiredColumns, type ClassTable } from './classTables.js'

/** Sections whose data is kept as user-named class tables. */
export type ClassSection = Extract<TabularImportSection, 'laboratory' | 'strength'>

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const storageKey = (section: ClassSection) => `geoeye.analytics.${section}-tests.v1`

function parseTable(candidate: unknown): ClassTable[] {
  const value = candidate as Partial<ClassTable> | null
  if (typeof value !== 'object' || value === null || typeof value.id !== 'string' || typeof value.name !== 'string'
    || !Array.isArray(value.columns) || !Array.isArray(value.rows) || requiredColumns.some((column, index) => value.columns![index] !== column)) return []
  const columns = value.columns.map(String)
  return [{ columns, id: value.id, name: value.name, rows: value.rows.filter(Array.isArray).map(row => columns.map((_, index) => String(row[index] ?? ''))) }]
}

/** Carries over records saved by the former fixed point-load and Schmidt tables as ordinary, renameable tables. */
function legacyTable(storage: StorageLike, key: string, name: string, fixed: readonly (readonly [header: string, property: string])[]): ClassTable[] {
  try {
    const records = JSON.parse(storage.getItem(key) ?? '[]') as Record<string, unknown>[]
    const taken = new Set(fixed.map(([header]) => headerKey(header)))
    const lab = (record: Record<string, unknown>) => (record.sourceValues ?? {}) as Record<string, unknown>
    const extras = records.flatMap(record => Object.keys(lab(record))).filter(header => {
      const fresh = !isRequiredHeader(header) && !taken.has(headerKey(header))
      taken.add(headerKey(header))
      return fresh
    })
    const { columns, rows } = parseClassRows([
      [...fixed.map(([header]) => header), ...extras],
      ...records.map(record => [...fixed.map(([, property]) => String(record[property] ?? '')), ...extras.map(header => String(lab(record)[header] ?? ''))]),
    ])
    return [{ columns, id: `legacy:${key}`, name, rows }]
  } catch {
    return []
  }
}

const legacyLocation = [['Hole ID', 'holeId'], ['Sample ID', 'sampleId'], ['From', 'depthFromM'], ['To', 'depthToM']] as const

function legacyTables(storage: StorageLike, section: ClassSection): ClassTable[] {
  if (section !== 'strength') return []
  return [
    ...legacyTable(storage, 'geoeye.analytics.point-load.v1', 'Point load', [...legacyLocation, ['Test Type', 'testType'], ['P (kN)', 'peakLoadKn'],
      ['De (mm)', 'equivalentDiameterMm'], ['Is (MPa)', 'isMpa'], ['F', 'correctionFactor'], ['Is(50) (MPa)', 'is50Mpa'], ['Valid', 'validBreak'],
      ['Laboratory', 'labName'], ['Test date', 'testedAt']]),
    ...legacyTable(storage, 'geoeye.analytics.schmidt.v1', 'Schmidt rebound', [...legacyLocation, ['Schmidt rebound', 'reboundValue']]),
  ]
}

/** A single-table import saved by an earlier build becomes the first class, so no imported data disappears. */
export function tableFromImport(name: string, columns: readonly string[], rows: readonly (readonly string[])[]): ClassTable[] {
  try {
    const parsed = parseClassRows([[...columns], ...rows.map(row => [...row])])
    return [{ columns: parsed.columns, id: `import:${name}`, name: name.replace(/\.[^.]+$/, ''), rows: parsed.rows }]
  } catch {
    return []
  }
}

export function readClassTables(storage: StorageLike, section: ClassSection): ClassTable[] {
  try {
    const raw = storage.getItem(storageKey(section))
    if (raw === null) return legacyTables(storage, section)
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.flatMap(parseTable) : []
  } catch {
    return []
  }
}

export function writeClassTables(storage: StorageLike, section: ClassSection, tables: readonly ClassTable[]): boolean {
  try {
    storage.setItem(storageKey(section), JSON.stringify(tables))
    return true
  } catch {
    return false
  }
}
