/** A user-named lab table (a strength test, a lab class). Columns always start with `requiredColumns`; the rest keep their lab header names. */
export interface ClassTable {
  columns: string[]
  id: string
  name: string
  rows: string[][]
}

export interface ClassImport {
  columns: string[]
  issues: string[]
  rows: string[][]
  skipped: number
}

export const requiredColumns = ['Hole ID', 'Sample ID', 'From', 'To'] as const

const requiredAliases: readonly (readonly string[])[] = [
  ['holeid', 'hole', 'holeno', 'holenumber', 'borehole', 'boreholeid', 'boreholeno', 'drillhole', 'drillholeid', 'bhid'],
  ['sampleid', 'sample', 'sampleno', 'samplenumber'],
  ['from', 'fromm', 'depthfrom', 'depthfromm', 'fromdepth', 'fromdepthm', 'startdepth', 'startdepthm'],
  ['to', 'tom', 'depthto', 'depthtom', 'todepth', 'todepthm', 'enddepth', 'enddepthm'],
]

/** Header identity: case, spacing and punctuation are ignored, so "Is(50) (MPa)" matches "is50 mpa". */
export function headerKey(header: string): string {
  return header.replace(/²/g, '2').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

export function isRequiredHeader(header: string): boolean {
  return requiredAliases.some(aliases => aliases.includes(headerKey(header)))
}

export function emptyClassTable(id: string, name: string): ClassTable {
  return { columns: [...requiredColumns], id, name, rows: [] }
}

export function classRowIssue(row: readonly string[]): string | null {
  const [hole = '', sample = '', from = '', to = ''] = row.map(cell => cell.trim())
  if (hole === '') return 'Hole ID is required.'
  if (sample === '') return 'Sample ID is required.'
  const start = Number(from), end = Number(to)
  return from === '' || to === '' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start
    ? 'From and To must be depths with To ≥ From ≥ 0.' : null
}

/** Reads a header row plus data rows: the four required columns are matched by alias, every other column by its own name. */
export function parseClassRows(table: readonly (readonly string[])[]): ClassImport {
  const headers = (table[0] ?? []).map(header => header.replace(/^﻿/, '').trim())
  if (headers.length === 0) throw new Error('CSV is empty.')
  const keys = headers.map(headerKey)
  const required = requiredAliases.map(aliases => keys.findIndex(key => aliases.includes(key)))
  const missing = requiredColumns.filter((_, index) => required[index]! < 0)
  if (missing.length > 0) throw new Error(`CSV is missing required columns: ${missing.join(', ')}.`)
  const fields = keys.flatMap((key, index) => key === '' || required.includes(index) ? [] : [index])
  if (new Set(fields.map(index => keys[index])).size !== fields.length) throw new Error('CSV column names must be unique.')

  const rows: string[][] = [], issues: string[] = []
  let skipped = 0
  table.slice(1).forEach((source, offset) => {
    const row = [...required, ...fields].map(index => (source[index] ?? '').trim())
    const issue = fields.length > 0 && row.slice(4).every(value => value === '') ? 'no measured values.' : classRowIssue(row)
    if (issue === null) { rows.push(row); return }
    skipped++
    if (issues.length < 5) issues.push(`Row ${offset + 2}: ${issue}`)
  })
  if (rows.length === 0) throw new Error(`No valid rows were found. ${issues.join(' ')}`.trim())
  return { columns: [...requiredColumns, ...fields.map(index => headers[index]!)], issues, rows, skipped }
}

function rowKey(row: readonly string[]): string {
  return JSON.stringify([headerKey(row[0] ?? ''), (row[1] ?? '').toLowerCase(), Number(row[2]), Number(row[3])])
}

/**
 * Adds an import to a table. Imported headers are matched to the table's columns by name and new headers
 * become new columns. Rows replace earlier rows of the same hole, sample and interval, so re-importing
 * a corrected lab file does not duplicate it.
 */
export function mergeClassImport(table: ClassTable, imported: Pick<ClassImport, 'columns' | 'rows'>): { added: number; table: ClassTable } {
  const columns = [...table.columns]
  const target = imported.columns.map(column => {
    const index = columns.findIndex(existing => headerKey(existing) === headerKey(column))
    return index >= 0 ? index : columns.push(column) - 1
  })
  const incoming = imported.rows.map(row => {
    const next = columns.map(() => '')
    row.forEach((value, index) => { next[target[index]!] = value })
    return next
  })
  const existing = new Set(table.rows.map(rowKey)), replaced = new Set(incoming.map(rowKey))
  const kept = table.rows.filter(row => !replaced.has(rowKey(row))).map(row => columns.map((_, index) => row[index] ?? ''))
  return { added: incoming.filter(row => !existing.has(rowKey(row))).length, table: { ...table, columns, rows: [...incoming, ...kept] } }
}
