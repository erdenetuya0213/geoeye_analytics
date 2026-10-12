import { expect, it } from 'vitest'
import type { FieldLoggingDataset } from '@geoeye/types'
import { appendLatestRqd } from '../src/live-rqd.js'

it('selects the latest run per hole, rejoins image fragments, and retains omitted intervals', () => {
  const dataset: FieldLoggingDataset = { id: 'rqd', name: 'RQD', category: null, version: 1, updatedAt: '2026-10-05T00:00:00.000Z', columns: [], records: [] }
  const template = { rqdComposite: { intervalLengthM: 3 }, classes: [{ fields: ['old', 'new'].map((id, number) => ({ id, label: id, calculation: { sourceFieldId: 'rqd_pct', number, createdAt: `2026-10-0${number + 1}`, rules: { intervalLengthM: 3, omitted: [{ from: 0, to: 2 }] } } })) }] }
  const row = (hole_id: string, field: string, from: number, to: number, value: string, run: string) => ({ id: `${hole_id}:${field}:${from}`, hole_id, template_id: 'rqd', depth_from: from, depth_to: to,
    selections_json: { [field]: value, _calculation_run: run, _calculation_from: '0', _calculation_to: '3' } })
  appendLatestRqd(dataset, template, [row('A', 'old', 0, 3, '99', 'old:A'), row('A', 'new', 0, 1, '0', 'new:A'), row('A', 'new', 1, 3, '0', 'new:A'), row('B', 'old', 0, 3, '45', 'old:B')])
  expect(dataset.records.map(row => [row.holeId, row.depthFrom, row.depthTo, row.values['derived:Latest RQD']])).toEqual([['A', 0, 3, 0], ['B', 0, 3, 45]])
  expect(dataset.composite?.intervals).toHaveLength(2)
  expect(dataset.composite?.intervals[0]?.exclusionReason).toBe('Field RQD omission rule')
})

it('withholds stale values and geometry when the current boundary or omission rules change', () => {
  for (const changed of [{ secondaryBoundaryRule: 'weathering' }, { omissionRules: [{ field: 'strength', values: ['R1'] }] }, { startDepthM: 1 }]) {
    const dataset: FieldLoggingDataset = { id: 'rqd', name: 'RQD', category: null, version: 1, updatedAt: '2026-10-05T00:00:00.000Z', columns: [], records: [] }
    appendLatestRqd(dataset, { rqdComposite: { intervalLengthM: 3, ...changed }, classes: [{ fields: [{ id: 'old', label: 'RQD 1', calculation: { sourceFieldId: 'rqd_pct', rules: { intervalLengthM: 3 } } }] }] },
      [{ id: 'a', hole_id: 'A', template_id: 'rqd', depth_from: 0, depth_to: 3, selections_json: { old: '90' } }])
    expect(dataset.records[0]?.values['derived:Latest RQD']).toBeNull()
    expect(dataset.records[0]?.values['derived:RQD run status']).toBe('Recalculate: Field rules changed')
    expect(dataset.composite?.intervals).toEqual([])
  }
})
