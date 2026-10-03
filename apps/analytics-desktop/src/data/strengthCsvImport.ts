import type { SchmidtRecord } from './schmidtStore.js'

export interface SchmidtCsvImport {
  blankRows: number
  invalidRows: number
  issues: readonly string[]
  kind: 'schmidt'
  records: SchmidtRecord[]
  sourceRows: number
}

function parseCsvRows(text: string): string[][] {
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
      if (row.some((cell) => cell.length > 0)) rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value)
    if (row.some((cell) => cell.length > 0)) rows.push(row)
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted value.')
  return rows
}

function normalizedHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function headerIndex(headers: readonly string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(normalizedHeader(header)))
}

function numeric(value: string): number | null {
  if (value.trim().length === 0) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stableId(sourceFile: string, sourceRow: number): string {
  return `schmidt:${sourceFile.trim().toLowerCase()}:${sourceRow}`
}

export function parseStrengthCsv(text: string, sourceFile: string, importedAt = new Date().toISOString()): SchmidtCsvImport {
  const rows = parseCsvRows(text)
  const headers = rows[0]
  if (headers === undefined) throw new Error('CSV is empty.')

  const boreholeIndex = headerIndex(headers, ['borehole', 'holeid', 'hole'])
  const fromIndex = headerIndex(headers, ['from', 'fromm', 'depthfrom', 'depthfromm'])
  const toIndex = headerIndex(headers, ['to', 'tom', 'depthto', 'depthtom'])
  const schmidtIndex = headerIndex(headers, ['smidth', 'schmidt', 'schmidtrebound', 'rebound', 'reboundvalue'])
  const missing = [
    boreholeIndex < 0 ? 'Borehole' : null,
    fromIndex < 0 ? 'From' : null,
    toIndex < 0 ? 'To' : null,
    schmidtIndex < 0 ? 'Schmidt/Smidth' : null,
  ].filter((value): value is string => value !== null)
  if (missing.length > 0) throw new Error(`CSV is not a supported Schmidt strength file. Missing: ${missing.join(', ')}.`)

  const records: SchmidtRecord[] = []
  const issues: string[] = []
  let blankRows = 0
  let invalidRows = 0

  rows.slice(1).forEach((row, rowOffset) => {
    const sourceRow = rowOffset + 2
    const holeId = (row[boreholeIndex] ?? '').trim()
    const depthFromM = numeric(row[fromIndex] ?? '')
    const depthToM = numeric(row[toIndex] ?? '')
    const reboundValue = numeric(row[schmidtIndex] ?? '')

    if ((row[schmidtIndex] ?? '').trim().length === 0) {
      blankRows += 1
      return
    }
    if (
      holeId.length === 0
      || depthFromM === null
      || depthFromM < 0
      || depthToM === null
      || depthToM < depthFromM
      || reboundValue === null
      || reboundValue <= 0
    ) {
      invalidRows += 1
      if (issues.length < 5) issues.push(`Row ${sourceRow}: invalid borehole, interval, or Schmidt rebound value.`)
      return
    }

    const interval = `${depthFromM.toFixed(3).replace(/\.?0+$/, '')}-${depthToM.toFixed(3).replace(/\.?0+$/, '')}`
    records.push({
      createdAt: importedAt,
      depthFromM,
      depthToM,
      holeId,
      id: stableId(sourceFile, sourceRow),
      reboundValue,
      sampleId: `${holeId}-${interval}-SCH`,
      sourceFile,
      sourceRow,
    })
  })

  if (records.length === 0) {
    throw new Error('No populated Schmidt rebound values were found in the CSV.')
  }

  return {
    blankRows,
    invalidRows,
    issues,
    kind: 'schmidt',
    records,
    sourceRows: Math.max(rows.length - 1, 0),
  }
}
