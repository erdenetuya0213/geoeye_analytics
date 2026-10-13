import { normalizeStructureHoleId, type CollarRecord, type SurveyStation } from '../analysis/structureAnalysis.js'
import { surveyGeometry } from '../visualization/sceneDrillholes.js'
import { headerKey, requiredAliases } from './classTables.js'

/** A project table an operation can read. Cells stay text; the hole and depth columns are found by header name. */
export interface OperationTable {
  columns: readonly string[]
  /** Column of From, or of the single depth in a point table. */
  from: number
  group: string
  hole: number
  id: string
  name: string
  rows: readonly (readonly string[])[]
  /** Column of To; the same column as `from` in a point table. */
  to: number
}

export type PointPosition = 'mid' | 'above' | 'below'

const depthAliases = ['depth', 'depthm', 'depthat', 'at', 'md', 'measureddepth']
const depth = (cell: string | undefined) => cell === undefined || cell.trim() === '' ? NaN : Number(cell)
/** Contacts closer than 0.1 mm are the same contact. */
const contact = (value: number) => Math.round(value * 1e4) / 1e4

/** Null when the headers hold no Hole ID with From and To, or with a single Depth. */
export function operationTable(id: string, name: string, group: string, columns: readonly string[], rows: OperationTable['rows']): OperationTable | null {
  const keys = columns.map(headerKey)
  const find = (aliases: readonly string[]) => keys.findIndex(key => aliases.includes(key))
  const hole = find(requiredAliases[0]!), from = find(requiredAliases[2]!), to = find(requiredAliases[3]!), point = find(depthAliases)
  const interval = from >= 0 && to >= 0
  if (hole < 0 || (!interval && point < 0)) return null
  return { columns, from: interval ? from : point, group, hole, id, name, rows, to: interval ? to : point }
}

export const isIntervalTable = (table: OperationTable) => table.from !== table.to

/** Everything except the hole and depth columns. */
export const fieldColumns = (table: OperationTable) => table.columns.flatMap((_, index) => index === table.hole || index === table.from || index === table.to ? [] : [index])

function uniqueLabel(taken: Set<string>, label: string): string {
  let unique = label
  for (let copy = 2; taken.has(headerKey(unique)); copy++) unique = `${label} ${copy}`
  taken.add(headerKey(unique))
  return unique
}

function intervalsByHole(table: OperationTable) {
  const holes = new Map<string, { intervals: { from: number; row: readonly string[]; to: number }[]; name: string }>()
  for (const row of table.rows) {
    const name = (row[table.hole] ?? '').trim(), from = contact(depth(row[table.from])), to = contact(depth(row[table.to]))
    if (name === '' || !(to > from)) continue
    const key = normalizeStructureHoleId(name)
    const hole = holes.get(key) ?? { intervals: [], name }
    hole.intervals.push({ from, row, to })
    holes.set(key, hole)
  }
  return holes
}

/**
 * Interval merge, as Leapfrog builds a merged table: every From and To of both tables becomes a contact, each piece
 * between two contacts takes a field from the one interval covering it, and a piece with no value at all is dropped.
 * Where a table's own intervals overlap, that table gives the piece no value. `onlyHoles` holds normalized hole names.
 */
export function mergeTables(first: OperationTable, firstFields: readonly number[], second: OperationTable, secondFields: readonly number[], onlyHoles?: ReadonlySet<string>) {
  const sides = [{ fields: firstFields, holes: intervalsByHole(first), table: first }, { fields: secondFields, holes: intervalsByHole(second), table: second }]
  const taken = new Set(['holeid', 'from', 'to'])
  const columns = ['Hole ID', 'From', 'To', ...sides.flatMap(side => side.fields.map(field => uniqueLabel(taken, side.table.columns[field] ?? '')))]
  // The first table's spelling of a hole name wins.
  const names = new Map([...sides].reverse().flatMap(side => [...side.holes].map(([key, hole]) => [key, hole.name] as const)))
  const rows: string[][] = []
  let holes = 0, overlaps = 0, skippedHoles = 0
  for (const [key, name] of [...names].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))) {
    if (onlyHoles !== undefined && !onlyHoles.has(key)) { skippedHoles++; continue }
    const intervals = sides.map(side => side.holes.get(key)?.intervals ?? [])
    const contacts = [...new Set(intervals.flat().flatMap(interval => [interval.from, interval.to]))].sort((a, b) => a - b)
    const before = rows.length
    for (let index = 0; index < contacts.length - 1; index++) {
      const from = contacts[index]!, to = contacts[index + 1]!
      const values = sides.flatMap((side, sideIndex) => {
        const covering = intervals[sideIndex]!.filter(interval => interval.from <= from && interval.to >= to)
        if (covering.length > 1) overlaps++
        return side.fields.map(field => covering.length === 1 ? (covering[0]!.row[field] ?? '').trim() : '')
      })
      if (values.some(value => value !== '')) rows.push([name, String(from), String(to), ...values])
    }
    if (rows.length > before) holes++
  }
  return { columns, holes, overlaps, rows, skippedHoles }
}

/**
 * Copies the table and appends X, Y, Z of one depth per row: the interval mid-point, its upper contact (From) or its
 * lower contact (To). A point table, or `depthColumn`, has one depth, so every position gives the same coordinate.
 * Holes are traced as the 3D view traces them; a hole with a collar and no survey is taken as vertical.
 */
export function calculatePoints(table: OperationTable, position: PointPosition, collars: readonly CollarRecord[], surveys: readonly SurveyStation[], depthColumn?: number) {
  const from = depthColumn ?? table.from, to = depthColumn ?? table.to
  const collarByHole = new Map(collars.filter(collar => [collar.easting, collar.northing, collar.elevation].every(Number.isFinite)).map(collar => [normalizeStructureHoleId(collar.holeId), collar]))
  const stations = new Map<string, SurveyStation[]>()
  for (const station of surveys) {
    const key = normalizeStructureHoleId(station.holeId)
    const list = stations.get(key)
    if (list === undefined) stations.set(key, [station]); else list.push(station)
  }
  const traces = new Map<string, (depth: number) => { x: number; y: number; z: number }>()
  const noCollar = new Set<string>(), vertical = new Set<string>()
  let located = 0
  const rows = table.rows.map(row => {
    const cells = table.columns.map((_, index) => row[index] ?? '')
    const key = normalizeStructureHoleId(row[table.hole] ?? ''), top = depth(row[from]), bottom = depth(row[to])
    const at = position === 'above' ? top : position === 'below' ? bottom : (top + bottom) / 2
    const collar = collarByHole.get(key)
    if (collar === undefined && key !== '') noCollar.add(key)
    if (collar === undefined || !(at >= 0)) return [...cells, '', '', '']
    let pointAt = traces.get(key)
    if (pointAt === undefined) {
      if (!stations.has(key)) vertical.add(key)
      pointAt = surveyGeometry(collar, stations.get(key) ?? []).pointAt
      traces.set(key, pointAt)
    }
    const point = pointAt(at)
    located++
    return [...cells, point.x.toFixed(3), point.y.toFixed(3), point.z.toFixed(3)]
  })
  const taken = new Set(table.columns.map(headerKey))
  return { columns: [...table.columns, ...['X', 'Y', 'Z'].map(label => uniqueLabel(taken, label))], located, noCollar: noCollar.size, rows, vertical: vertical.size }
}
