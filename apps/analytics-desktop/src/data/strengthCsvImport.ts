import { csvRows as parseCsvRows } from './tabularCsvImport.js'
import type { SchmidtRecord } from './schmidtStore.js'
import type { PointLoadRecord } from './pointLoadStore.js'
import { calculatePointLoadIndex, type PointLoadTestType } from '../analysis/pointLoad.js'

export interface PointLoadCsvImport {
  blankRows: number
  invalidRows: number
  issues: readonly string[]
  kind: 'point-load'
  records: PointLoadRecord[]
  sourceRows: number
}

export interface SchmidtCsvImport {
  blankRows: number
  invalidRows: number
  issues: readonly string[]
  kind: 'schmidt'
  records: SchmidtRecord[]
  sourceRows: number
}

function normalizedHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/²/g, '2').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
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

export function parseStrengthCsv(text: string, sourceFile: string, importedAt = new Date().toISOString()): SchmidtCsvImport | PointLoadCsvImport {
  const rows = parseCsvRows(text)
  const headers = rows[0]
  if (headers === undefined) throw new Error('CSV is empty.')

  if (headerIndex(headers, ['is50mpa', 'is50', 'pointloadindex50mpa']) >= 0
    || headerIndex(headers, ['peakloadkn', 'pkn']) >= 0) return parsePointLoadRows(rows, sourceFile, importedAt)

  const boreholeIndex = headerIndex(headers, ['borehole', 'boreholeid', 'holeid', 'hole', 'drillhole', 'drillholeid', 'bhid'])
  const fromIndex = headerIndex(headers, ['from', 'fromm', 'depthfrom', 'depthfromm', 'fromdepth', 'fromdepthm', 'startdepth', 'startdepthm'])
  const toIndex = headerIndex(headers, ['to', 'tom', 'depthto', 'depthtom', 'todepth', 'todepthm', 'enddepth', 'enddepthm'])
  const schmidtIndex = headerIndex(headers, ['smidth', 'smidthvalue', 'schmidt', 'schmidtvalue', 'schmidtrebound', 'schmidtreboundvalue', 'rebound', 'reboundvalue'])
  const missing = [
    boreholeIndex < 0 ? 'Hole ID' : null,
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
      || reboundValue < 0
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

function parsePointLoadRows(rows: string[][], sourceFile: string, importedAt: string): PointLoadCsvImport {
  const headers = rows[0]!
  const index = (aliases: string[]) => headerIndex(headers, aliases)
  const hole = index(['holeid', 'hole', 'borehole', 'drillholeid', 'bhid'])
  const sample = index(['sampleno', 'samplenumber', 'sampleid', 'sample'])
  const depth = index(['depthm', 'depth', 'md'])
  const from = index(['from', 'fromm', 'depthfrom', 'depthfromm'])
  const to = index(['to', 'tom', 'depthto', 'depthtom'])
  const load = index(['pkn', 'peakloadkn', 'loadkn'])
  const diameter = index(['demm', 'equivalentdiametermm'])
  const diameterSquared = index(['demm2', 'de2mm2', 'de²mm²'].map(normalizedHeader))
  const is50 = index(['is50mpa', 'is50', 'pointloadindex50mpa'])
  const is = index(['ismpa', 'is'])
  const factor = index(['f', 'correctionfactor', 'sizecorrectionfactor'])
  const type = index(['testtype', 'method'])
  const valid = index(['valid', 'validbreak'])
  const lab = index(['laboratory', 'lab', 'labname'])
  const date = index(['testedat', 'testdate', 'date'])
  const missing = [hole < 0 ? 'Hole ID' : null, sample < 0 ? 'Sample no' : null,
    depth < 0 && from < 0 ? 'Depth (m) or From' : null, load < 0 ? 'P (kN)' : null,
    diameter < 0 && diameterSquared < 0 ? 'De (mm) or De² (mm²)' : null, type < 0 ? 'Test Type' : null].filter(Boolean)
  if (missing.length) throw new Error(`Point-load CSV is missing: ${missing.join(', ')}.`)
  const records: PointLoadRecord[] = [], issues: string[] = []
  let blankRows = 0, invalidRows = 0
  rows.slice(1).forEach((row, offset) => {
    const sourceRow = offset + 2
    const cell = (column: number) => column < 0 ? '' : (row[column] ?? '').trim()
    if (row.every(value => value.trim() === '')) { blankRows++; return }
    const depthFromM = numeric(cell(from)) ?? numeric(cell(depth))
    const depthToM = to < 0 ? depthFromM : numeric(cell(to))
    const peakLoadKn = numeric(cell(load))
    const squared = numeric(cell(diameterSquared))
    const equivalentDiameterMm = numeric(cell(diameter)) ?? (squared !== null && squared > 0 ? Math.sqrt(squared) : null)
    const types: Record<string, PointLoadTestType> = { diag: 'diametral', diam: 'diametral', diametral: 'diametral', axis: 'axial', axial: 'axial', block: 'block-irregular', irregular: 'block-irregular', blockirregular: 'block-irregular' }
    const testType = types[normalizedHeader(cell(type))]
    if (!cell(hole) || !cell(sample) || depthFromM === null || depthFromM < 0 || depthToM === null || depthToM < depthFromM
      || peakLoadKn === null || peakLoadKn <= 0 || equivalentDiameterMm === null || equivalentDiameterMm <= 0 || testType === undefined) {
      invalidRows++; if (issues.length < 5) issues.push(`Row ${sourceRow}: check hole, sample, depth, test type, load and equivalent diameter.`); return
    }
    const calculated = calculatePointLoadIndex(peakLoadKn, equivalentDiameterMm)
    const provided = [is, factor, is50].map(column => column < 0 || cell(column) === '' ? null : numeric(cell(column)))
    if ([is, factor, is50].some((column, i) => column >= 0 && cell(column) !== '' && (provided[i] === null || provided[i]! <= 0))) {
      invalidRows++; if (issues.length < 5) issues.push(`Row ${sourceRow}: strength indices and correction factor must be positive numbers.`); return
    }
    const validText = cell(valid).toLowerCase()
    if (validText !== '' && !['true', 'false', 'yes', 'no', '1', '0', 'valid', 'invalid'].includes(validText)) {
      invalidRows++; if (issues.length < 5) issues.push(`Row ${sourceRow}: Valid must be true or false.`); return
    }
    records.push({ createdAt: importedAt, id: `point-load:${sourceFile.trim().toLowerCase()}:${sourceRow}`,
      sampleId: cell(sample), holeId: cell(hole), depthFromM, depthToM, peakLoadKn, equivalentDiameterMm,
      testType, labName: cell(lab), testedAt: cell(date), validBreak: !['false', 'no', '0', 'invalid'].includes(validText),
      isMpa: provided[0] ?? calculated.isMpa, correctionFactor: provided[1] ?? calculated.correctionFactor,
      is50Mpa: provided[2] ?? (provided[0] ?? calculated.isMpa) * (provided[1] ?? calculated.correctionFactor),
      sourceFile, sourceRow, sourceValues: Object.fromEntries(headers.map((header, i) => [header.trim(), row[i] ?? ''])),
    })
  })
  if (!records.length) throw new Error(`No valid point-load tests were found. ${issues.join(' ')}`)
  return { kind: 'point-load', records, blankRows, invalidRows, issues, sourceRows: rows.length - 1 }
}
