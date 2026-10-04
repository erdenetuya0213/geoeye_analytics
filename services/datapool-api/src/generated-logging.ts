import type { FieldLoggingDataset } from '@geoeye/types'

/**
 * Completed logs retain the template version that produced the CSV. The live
 * template may have advanced since a borehole was completed, so using its
 * current version would silently combine unrelated historical schemas.
 */
export function generatedLoggingTemplateVersion(payload: unknown, fallback: number): number {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return fallback
  const raw = (payload as Record<string, unknown>).templateVersion
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function generatedLoggingDatasetId(templateId: string, version: number): string {
  return `${templateId}:generated:v${version}`
}

/** Reads Field's saved export, preserving every header and blank cells as missing values. */
export function generatedLoggingDataset(input: {
  csv: string; holeId: string; id: string; name: string; updatedAt: string; version: number
}): FieldLoggingDataset {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const csv = input.csv.replace(/^\uFEFF/, '')
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index]
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { cell += '"'; index++ }
      else quoted = !quoted
    } else if (char === ',' && !quoted) { row.push(cell); cell = '' }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && csv[index + 1] === '\n') index++
      row.push(cell); if (row.some(value => value !== '')) rows.push(row)
      row = []; cell = ''
    } else cell += char
  }
  if (quoted) throw new Error(`Malformed generated CSV: ${input.name}`)
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  const headers = rows.shift() ?? []
  const number = (value: string | undefined): number | null => {
    if (value === undefined || value.trim() === '') return null
    const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null
  }
  const columns = headers.map((label, index): FieldLoggingDataset['columns'][number] => {
    const populated = rows.map(values => values[index] ?? '').filter(value => value.trim() !== '')
    const numeric = populated.length > 0 ? populated.every(value => number(value) !== null)
      : /spacing|frequency|count|median|score|JCR|RMR90 (macro|micro|wall|filling|water|weight sum)|joint condition|^(From|To|Alpha|Beta|Feature depth)$/i.test(label)
    return { key: `csv:${label}`, label, dataType: numeric ? 'numeric' : 'text',
      unit: (/spacing|Feature depth|^(From|To)$/.test(label) && !/score/i.test(label)) ? 'm' : /^(Alpha|Beta)$/.test(label) ? '°' : null }
  })
  const from = headers.indexOf('From'), to = headers.indexOf('To')
  return { category: 'geotechnical', columns, id: input.id, name: input.name,
    updatedAt: input.updatedAt, version: input.version,
    records: rows.map((values, index) => ({ id: `${input.id}:${input.holeId}:${index}`, holeId: input.holeId,
      depthFrom: number(values[from]), depthTo: number(values[to]),
      values: Object.fromEntries(columns.flatMap((column, offset) => {
        const value = values[offset] ?? ''
        return value.trim() === '' ? [] : [[column.key, column.dataType === 'numeric' ? number(value) : value]]
      })) })) }
}

