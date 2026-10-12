import type { EdaObservation } from './eda.js'
import type { EdaDataset } from '../data/edaTypes.js'
import { parseTabularCsv } from '../data/tabularCsvImport.js'

export interface ComparisonImport { id: string; name: string; csv: string; capturedAt: string }
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
const number = (value: string | undefined) => value === undefined || value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value)

/** A separate local comparison import: never writes or merges a logging template. */
export function comparisonImportDataset(input: ComparisonImport): EdaDataset {
  const parsed = parseTabularCsv(input.csv, input.name, 'laboratory')
  const column = (aliases: string[]) => parsed.columns.findIndex(c => aliases.includes(normalize(c)))
  const hole = column(['holeid', 'borehole', 'boreholeid', 'case', 'reference'])
  const from = column(['from', 'fromm', 'depthfrom'])
  const to = column(['to', 'tom', 'depthto'])
  if ([hole, from, to].some(i => i < 0)) throw new Error('CSV needs Hole ID (or Case), From and To columns.')
  const fields = parsed.columns.flatMap((label, i) => {
    if ([hole, from, to].includes(i)) return []
    const populated = parsed.rows.map(row => row[i] ?? '').filter(v => v.trim() !== '')
    if (populated.length === 0) return []
    return [{ key: `column_${i}`, label, i, numeric: populated.every(v => number(v) !== null) }]
  })
  const observations = parsed.rows.map((row, i): EdaObservation => {
    const a = number(row[from]), b = number(row[to]), h = row[hole]?.trim()
    if (a === null || b === null || b <= a || !h) throw new Error(`CSV row ${i + 2} needs a reference and a positive finite depth interval.`)
    const id = `${input.id}:${i}`
    return {
      id, sourceObservationId: id, sourceObservationIds: [id], joinKey: `${h}:${a}:${b}`, sampleId: `${i + 2}`, holeId: h,
      depthFrom: a, depthTo: b, locationValid: false, easting: 0, northing: 0, lithology: 'Unassigned',
      dimensions: Object.fromEntries([['drillhole', h], ...fields.filter(f => !f.numeric).map(f => [f.key, row[f.i]?.trim() || 'Unassigned'])]),
      values: Object.fromEntries(fields.filter(f => f.numeric).map(f => [f.key, number(row[f.i])])),
    }
  })
  return {
    id: input.id, name: input.name.replace(/\.csv$/i, ''), source: 'live', producer: 'Local comparison import', project: '',
    snapshotAt: input.capturedAt, support: 'Saved interval observations; import time is not source capture time', observations,
    dimensions: fields.filter(f => !f.numeric).map(f => ({ key: f.key, label: f.label })),
    variables: fields.filter(f => f.numeric).map(f => ({ key: f.key, label: f.label, shortLabel: f.label, decimals: 3, dataType: 'numeric', unit: /%|\bpct\b|percent/i.test(f.label) ? '%' : /per m|\/m/.test(f.label) ? '/m' : '' })),
  }
}

export function completeComparisonRows(observations: readonly EdaObservation[], hole: string, keys: readonly string[]) {
  if (keys.length === 0) return []
  const candidates = observations.filter(r => r.holeId === hole && Number.isFinite(r.depthFrom) && Number.isFinite(r.depthTo) && r.depthTo > r.depthFrom)
    .filter(r => keys.every(key => typeof r.values[key] === 'number' && Number.isFinite(r.values[key])))
    .sort((a, b) => a.depthFrom - b.depthFrom || a.depthTo - b.depthTo)
  for (let i = 1; i < candidates.length; i++) if (candidates[i]!.depthFrom < candidates[i - 1]!.depthTo - 1e-7) {
    throw new Error('Overlapping complete intervals. Select a single coherent cohort or import a depth-matched comparison CSV; intervals are not silently combined.')
  }
  return candidates
}

export function depthStepPoints(rows: readonly EdaObservation[], key: string): Array<[number, number] | null> {
  const points: Array<[number, number] | null> = []
  let end: number | undefined
  for (const row of rows) {
    const value = row.values[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) { points.push(null); end = undefined; continue }
    if (end !== undefined && row.depthFrom > end + 1e-7) points.push(null)
    points.push([value, row.depthFrom], [value, row.depthTo])
    end = row.depthTo
  }
  return points
}

export function comparisonGroupMeans(rows: readonly EdaObservation[], keys: readonly string[], dimension: string) {
  const groups = new Map<string, { label: string; length: number; count: number; sums: number[] }>()
  for (const row of rows) {
    const label = row.dimensions[dimension] || 'Unassigned', length = row.depthTo - row.depthFrom
    const group = groups.get(label) ?? { label, length: 0, count: 0, sums: keys.map(() => 0) }
    group.length += length; group.count++
    keys.forEach((key, i) => { group.sums[i] = group.sums[i]! + row.values[key]! * length })
    groups.set(label, group)
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)).map(g => ({ ...g, means: g.sums.map(sum => sum / g.length) }))
}

export function comparisonCorrelation(rows: readonly EdaObservation[], xKey: string, yKey: string) {
  const length = rows.reduce((sum, r) => sum + r.depthTo - r.depthFrom, 0)
  if (length <= 0 || rows.length < 2) return { r: null, slope: null, intercept: null }
  const mx = rows.reduce((sum, r) => sum + r.values[xKey]! * (r.depthTo - r.depthFrom), 0) / length
  const my = rows.reduce((sum, r) => sum + r.values[yKey]! * (r.depthTo - r.depthFrom), 0) / length
  let xx = 0, yy = 0, xy = 0
  rows.forEach(r => { const w = r.depthTo - r.depthFrom, x = r.values[xKey]! - mx, y = r.values[yKey]! - my; xx += w * x * x; yy += w * y * y; xy += w * x * y })
  if (xx <= 0 || yy <= 0) return { r: null, slope: null, intercept: null }
  const slope = xy / xx
  return { r: Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))), slope, intercept: my - slope * mx }
}
