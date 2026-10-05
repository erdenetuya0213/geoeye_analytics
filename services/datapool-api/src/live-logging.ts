import type { FieldLoggingColumn } from '@geoeye/types'

/** Include persisted public calculation outputs without exposing private metadata. */
export function liveLoggingColumn(key: string, value: unknown): FieldLoggingColumn | undefined {
  if (key.startsWith('_') || key.trim() === '' || value === undefined
    || (typeof value === 'object' && value !== null)) return undefined
  const label = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''
    && Number.isFinite(Number(value)))
  return {
    key, label: label.charAt(0).toUpperCase() + label.slice(1),
    dataType: numeric ? 'numeric' : typeof value === 'boolean' ? 'boolean' : 'text',
    unit: /(?:\bmm\b|\(mm\))$/i.test(label) ? 'mm'
      : /(?:\bm\b|\(m\))$/i.test(label) ? 'm' : null,
  }
}

/** A blank in one borehole must not downgrade a numeric field in another. */
export function mergeLiveLoggingColumn(previous: FieldLoggingColumn | undefined, next: FieldLoggingColumn): FieldLoggingColumn {
  return previous?.dataType === 'numeric' ? previous : next
}
