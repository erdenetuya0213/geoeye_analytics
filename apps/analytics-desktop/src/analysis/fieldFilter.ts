/** A filter on one field: the dictionary of a category field, or a range on a numeric one. */
export interface CategoryFilter { kind: 'category'; values: string[] }
export type NumberRange = 'between' | 'max' | 'min'
/** `range` is what the person chose, so typing a minimum never hides the maximum box. */
export interface NumberFilter { kind: 'number'; max: number | null; min: number | null; range?: NumberRange }
export type FieldFilter = CategoryFilter | NumberFilter
/** Saved filters. A plain string is a single category value written by an earlier build. */
export type FieldFilters = Readonly<Record<string, FieldFilter | string>>

/** A field a filter can be put on: a numeric field takes a range, a text field its own dictionary. */
export interface FilterField { key: string; kind: 'category' | 'number'; label: string; unit?: string; values?: readonly string[] }

export interface FilterRow {
  dimensions: Readonly<Record<string, string>>
  values?: Readonly<Record<string, number | null>>
}

export const UNASSIGNED = 'Unassigned'

/** Null when the field is not narrowed at all. */
export function normalizeFilter(filter: FieldFilter | string | undefined): FieldFilter | null {
  if (filter === undefined) return null
  if (typeof filter === 'string') return filter === '' || filter === 'all' ? null : { kind: 'category', values: [filter] }
  if (filter.kind === 'category') return filter.values.length === 0 ? null : filter
  return filter.max === null && filter.min === null ? null : filter
}

export function matchesFieldFilters(row: FilterRow, keys: readonly string[], filters: FieldFilters): boolean {
  return keys.every((key) => {
    const filter = normalizeFilter(filters[key])
    if (filter === null) return true
    if (filter.kind === 'category') return filter.values.includes(row.dimensions[key] ?? UNASSIGNED)
    const value = row.values?.[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return false
    return (filter.min === null || value >= filter.min) && (filter.max === null || value <= filter.max)
  })
}

/** Saved filters as this build writes them, dropping anything that no longer narrows a field. */
export function toFieldFilters(saved: FieldFilters): Record<string, FieldFilter> {
  return Object.fromEntries(Object.entries(saved).flatMap(([key, value]) => {
    const filter = normalizeFilter(value)
    return filter === null ? [] : [[key, filter] as const]
  }))
}

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 4 })

/** How the filter reads in a run summary: "RQD 50–80", "Lithology: LST, DOL". */
export function filterSummary(label: string, filter: FieldFilter | string | undefined): string {
  const normalized = normalizeFilter(filter)
  if (normalized === null) return `${label}: all`
  if (normalized.kind === 'category') return `${label}: ${normalized.values.join(', ')}`
  if (normalized.min !== null && normalized.max !== null) return `${label} ${number(normalized.min)}–${number(normalized.max)}`
  return normalized.min !== null ? `${label} ≥ ${number(normalized.min)}` : `${label} ≤ ${number(normalized.max!)}`
}
