import type { TabularImportInput, TabularImportSection } from '@geoeye/datapool-client'

function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell.trim().length > 0)) rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted value.')
  if (value.length > 0 || row.length > 0) {
    row.push(value)
    if (row.some((cell) => cell.trim().length > 0)) rows.push(row)
  }
  return rows
}

export function parseTabularCsv(text: string, fileName: string, section: TabularImportSection): TabularImportInput {
  const parsed = csvRows(text)
  const rawColumns = parsed[0]
  if (rawColumns === undefined) throw new Error('CSV is empty.')
  const columns = rawColumns.map((column, index) => {
    const cleaned = index === 0 ? column.replace(/^\uFEFF/, '').trim() : column.trim()
    if (cleaned.length === 0) throw new Error(`CSV column ${index + 1} has no name.`)
    return cleaned
  })
  const normalized = columns.map((column) => column.toLocaleLowerCase())
  if (new Set(normalized).size !== normalized.length) throw new Error('CSV column names must be unique.')
  const rows = parsed.slice(1).map((row, index) => {
    if (row.length > columns.length) throw new Error(`CSV row ${index + 2} has more values than the header.`)
    return columns.map((_, columnIndex) => (row[columnIndex] ?? '').trim())
  }).filter((row) => row.some((cell) => cell.length > 0))
  if (rows.length === 0) throw new Error('CSV has no populated data rows.')
  if (rows.length > 20_000) throw new Error('CSV imports are limited to 20,000 rows at a time.')
  return { columns, fileName, rows, section }
}
