import { describe, expect, it } from 'vitest'
import { comparisonCorrelation, comparisonGroupMeans, comparisonImportDataset, completeComparisonRows, depthStepPoints } from './intervalComparison.js'
import { intervalComparisonOption } from '../visualization/intervalComparisonCharts.js'
const csv = 'Hole ID,From,To,RQD pct,Other RQD pct,Frequency per m,Mechanical state\nRef,0,1,0,20,0,Broken\nRef,1,4,100,80,4,Massive\nRef,5,6,50,,2,Massive\nOther,0,1,20,40,3,Broken'
const load = (text = csv) => comparisonImportDataset({ id: 'test', name: 'test.csv', csv: text, capturedAt: '2026-10-07' })
describe('native interval comparisons', () => {
  it('imports a distinct local dataset with categories, numeric zero and missing values', () => {
    const data = load()
    expect(data.observations).toHaveLength(4)
    expect(data.observations[0]?.values.column_3).toBe(0)
    expect(data.observations[2]?.values.column_4).toBeNull()
    expect(data.observations[0]?.locationValid).toBe(false)
    expect(data.variables[0]?.unit).toBe('%')
    expect(data.dimensions[0]?.label).toBe('Mechanical state')
  })
  it('rejects invalid support or missing depth headers', () => {
    expect(() => load('Hole ID,From,To,RQD pct\nRef,2,1,0')).toThrow('positive finite')
    expect(() => load('Foo,RQD pct\nRef,10')).toThrow('CSV needs')
  })
  it('uses a single hole and complete-case cohort, retains zero and rejects overlap', () => {
    const rows = completeComparisonRows(load().observations, 'Ref', ['column_3', 'column_4'])
    expect(rows).toHaveLength(2)
    expect(rows[0]?.values.column_3).toBe(0)
    expect(() => completeComparisonRows([...rows, rows[0]!], 'Ref', ['column_3'])).toThrow('Overlapping')
  })
  it('draws literal step boundaries and gaps without interpolation', () => {
    const rows = completeComparisonRows(load().observations, 'Ref', ['column_3'])
    expect(depthStepPoints(rows, 'column_3')).toEqual([[0, 0], [0, 1], [100, 1], [100, 4], null, [50, 5], [50, 6]])
  })
  it('weights means by support length rather than interval count', () => {
    const rows = completeComparisonRows(load().observations, 'Ref', ['column_3'])
    const group = comparisonGroupMeans(rows, ['column_3'], 'column_6').find(g => g.label === 'Massive')!
    expect(group.length).toBe(4); expect(group.count).toBe(2); expect(group.means[0]).toBe(87.5)
  })
  it('weights correlation, is invariant to subdividing an interval, and handles constant values', () => {
    const rows = completeComparisonRows(load().observations, 'Ref', ['column_3'])
    expect(comparisonCorrelation(rows, 'column_5', 'column_3').r).toBeCloseTo(1)
    const split = [rows[0]!, { ...rows[1]!, depthTo: 2 }, { ...rows[1]!, depthFrom: 2 }, rows[2]!]
    expect(comparisonCorrelation(split, 'column_5', 'column_3')).toEqual(comparisonCorrelation(rows, 'column_5', 'column_3'))
    expect(comparisonCorrelation([rows[0]!, rows[0]!], 'column_3', 'column_4').r).toBeNull()
  })
  it('keeps publication axes, zero observations and non-interpolating gaps in the chart definition', () => {
    const rows = completeComparisonRows(load().observations, 'Ref', ['column_3'])
    const option = intervalComparisonOption({ rows, curves: [{ key: 'column_3', label: 'Method' }], view: 'downhole', reference: 'Anonymous', note: 'Caveat', unit: '%', percent: true, dimension: 'column_6', xKey: 'column_5', xLabel: 'Frequency (/m)' })
    expect(option.backgroundColor).toBe('#fff')
    expect(option.yAxis).toEqual(expect.arrayContaining([expect.objectContaining({ inverse: true, min: 0, max: 6 })]))
    expect(option.xAxis).toEqual(expect.arrayContaining([expect.objectContaining({ min: 0, max: 100 })]))
    expect(option.series).toEqual(expect.arrayContaining([expect.objectContaining({ connectNulls: false, smooth: false })]))
  })
})
