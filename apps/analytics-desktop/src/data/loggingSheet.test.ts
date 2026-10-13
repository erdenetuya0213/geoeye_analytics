import { expect, it } from 'vitest'
import type { FieldLoggingDataset } from '@geoeye/datapool-client'
import { loggingDatasetFor, loggingSheetCsv } from './loggingSheet.js'

const dataset = {
  category: null, id: 'template-1', name: 'Geotechnical', updatedAt: '2026-10-12T00:00:00.000Z', version: 2,
  columns: [
    { dataType: 'numeric', key: 'rqd', label: 'RQD', unit: '%' },
    { dataType: 'category', key: 'weathering', label: 'Weathering', unit: null },
    { dataType: 'text', key: 'note', label: 'Weathering', unit: null },
  ],
  records: [
    { depthFrom: 3, depthTo: 6, holeId: 'h2', id: 'r3', values: { rqd: 71, weathering: 'W2', note: 'wet, "blocky"' } },
    { depthFrom: 3, depthTo: 6, holeId: 'h1', id: 'r2', values: { rqd: 0, weathering: null } },
    { depthFrom: 0, depthTo: 3, holeId: 'h1', id: 'r1', values: { rqd: 84.5, weathering: 'W1', note: 'dry' } },
    { depthFrom: 0, depthTo: 1, holeId: null, id: 'r4', values: {} },
  ],
} as unknown as FieldLoggingDataset

it('exports every borehole of one template, hole and interval first, labels kept apart', () => {
  expect(loggingSheetCsv(dataset, new Map([['h1', 'TT_2026_001GT'], ['h2', 'TT_2026_002GT']]))).toBe([
    'Hole ID,From,To,RQD,Weathering,Weathering [note]',
    ',0,1,,,',
    'TT_2026_001GT,0,3,84.5,W1,dry',
    'TT_2026_001GT,3,6,0,,',
    'TT_2026_002GT,3,6,71,W2,"wet, ""blocky"""',
    '',
  ].join('\n'))
})

it('keeps the hole id when the project has no name for it, and matches a template to its dataset', () => {
  expect(loggingSheetCsv(dataset, new Map())).toContain('h1,0,3,84.5')
  expect(loggingDatasetFor([dataset], { id: 'template-1', name: 'Renamed' })).toBe(dataset)
  expect(loggingDatasetFor([dataset], { id: 'other', name: 'Geotechnical' })).toBe(dataset)
  expect(loggingDatasetFor([dataset], { id: 'other', name: 'Structure' })).toBeUndefined()
  expect(loggingDatasetFor([dataset], null)).toBeUndefined()
})
