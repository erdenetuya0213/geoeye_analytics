import { describe, expect, it } from 'vitest'
import { calculatePoints, fieldColumns, isIntervalTable, mergeTables, operationTable } from './tableOperations.js'

const table = (name: string, columns: string[], rows: string[][]) => operationTable(name, name, 'Test', columns, rows)!
const lith = table('lith', ['hole_id', 'depth_from', 'depth_to', 'lith'], [
  ['DH1', '0', '9', ''], ['DH1', '9', '20.4', 'GOS'], ['DH1', '20.4', '21.65', 'GOS'], ['DH1', '21.65', '22.7', 'TSU'], ['DH2', '0', '5', 'COL'],
])
const assays = table('assays', ['hole_id', 'm_from', 'm_to', 'sample_id', 'Au_ppm'], [
  ['dh-1', '9', '20.4', 'S1', '0.77'], ['dh-1', '20.4', '21.7', 'S2', '10.3'], ['dh-1', '21.7', '22.7', 'S3', '3.06'], ['DH3', '0', '1', 'S4', '0.5'],
])

describe('operationTable', () => {
  it('finds the hole and depth columns by header name', () => {
    expect([assays.hole, assays.from, assays.to]).toEqual([0, 1, 2])
    expect(fieldColumns(assays)).toEqual([3, 4])
    expect(isIntervalTable(table('xrf', ['Hole ID', 'Depth', 'Cu'], []))).toBe(false)
    expect(operationTable('x', 'x', 'Test', ['Sample', 'Au'], [])).toBeNull()
  })
})

describe('mergeTables', () => {
  it('splits both tables at every contact and matches each field to its interval', () => {
    const merged = mergeTables(lith, [3], assays, [4])
    expect(merged.columns).toEqual(['Hole ID', 'From', 'To', 'lith', 'Au_ppm'])
    expect(merged.rows).toEqual([
      ['DH1', '9', '20.4', 'GOS', '0.77'],
      ['DH1', '20.4', '21.65', 'GOS', '10.3'],
      ['DH1', '21.65', '21.7', 'TSU', '10.3'],
      ['DH1', '21.7', '22.7', 'TSU', '3.06'],
      ['DH2', '0', '5', 'COL', ''],
      ['DH3', '0', '1', '', '0.5'],
    ])
    expect(merged).toMatchObject({ holes: 3, overlaps: 0, skippedHoles: 0 })
  })

  it('leaves a table blank where its own intervals overlap', () => {
    const resampled = table('resampled', ['Hole', 'From', 'To', 'Au'], [['DH1', '9', '13', '0.4'], ['DH1', '9', '10', '0.1'], ['DH1', '13', '14', '0.2']])
    const merged = mergeTables(lith, [3], resampled, [3])
    expect(merged.rows.slice(0, 3)).toEqual([['DH1', '9', '10', 'GOS', ''], ['DH1', '10', '13', 'GOS', '0.4'], ['DH1', '13', '14', 'GOS', '0.2']])
    expect(merged.overlaps).toBe(1)
  })

  it('keeps only the listed holes and numbers a repeated field name', () => {
    const merged = mergeTables(lith, [3], lith, [3], new Set(['dh2']))
    expect(merged.columns.slice(3)).toEqual(['lith', 'lith 2'])
    expect(merged.rows).toEqual([['DH2', '0', '5', 'COL', 'COL']])
    expect(merged.skippedHoles).toBe(1)
  })
})

describe('calculatePoints', () => {
  const collars = [{ easting: 1000, elevation: 500, holeId: 'DH-1', northing: 2000 }, { easting: 10, elevation: 100, holeId: 'DH2', northing: 20 }]
  const surveys = [{ azimuth: 90, depth: 0, dip: -60, holeId: 'DH1' }, { azimuth: 90, depth: 200, dip: -60, holeId: 'DH1' }]
  const intervals = table('lith', ['Hole ID', 'From', 'To', 'lith'], [['DH1', '90', '110', 'GOS'], ['DH2', '10', '20', 'COL'], ['DH9', '0', '1', 'COL'], ['DH1', '', '', 'TSU']])

  it('appends the coordinate of the mid-point or of either contact', () => {
    const mid = calculatePoints(intervals, 'mid', collars, surveys)
    expect(mid.columns).toEqual(['Hole ID', 'From', 'To', 'lith', 'X', 'Y', 'Z'])
    expect(mid.rows).toEqual([
      ['DH1', '90', '110', 'GOS', '1050.000', '2000.000', '413.397'],
      ['DH2', '10', '20', 'COL', '10.000', '20.000', '85.000'],
      ['DH9', '0', '1', 'COL', '', '', ''],
      ['DH1', '', '', 'TSU', '', '', ''],
    ])
    expect(mid).toMatchObject({ located: 2, noCollar: 1, vertical: 1 })
    expect(calculatePoints(intervals, 'above', collars, surveys).rows[1]!.slice(4)).toEqual(['10.000', '20.000', '90.000'])
    expect(calculatePoints(intervals, 'below', collars, surveys).rows[1]!.slice(4)).toEqual(['10.000', '20.000', '80.000'])
  })

  it('gives a point table the same coordinate for every position', () => {
    const points = table('xrf', ['Hole ID', 'Depth', 'X'], [['DH2', '30', 'a']])
    const results = (['mid', 'above', 'below'] as const).map(position => calculatePoints(points, position, collars, surveys))
    expect(results.map(result => result.rows[0])).toEqual(Array(3).fill(['DH2', '30', 'a', '10.000', '20.000', '70.000']))
    expect(results[0]!.columns).toEqual(['Hole ID', 'Depth', 'X', 'X 2', 'Y', 'Z'])
    expect(calculatePoints(intervals, 'mid', collars, surveys, 2).rows[1]!.slice(4)).toEqual(['10.000', '20.000', '80.000'])
  })
})
