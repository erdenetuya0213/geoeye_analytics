import { describe, expect, it } from 'vitest'
import {
  generatedLoggingDataset,
  generatedLoggingDatasetId,
  generatedLoggingTemplateVersion,
} from '../src/generated-logging.js'

describe('Field generated CSV headers', () => {
  it('retains blank calculated headers, quoted text and exact interval depths', () => {
    const dataset = generatedLoggingDataset({
      csv: '\uFEFFBorehole,From,To,Joint spacing,RMR76 apparent spacing (m),Joint shape\r\nDH,3,6,0.25,,"rough, undulating"\r\n',
      holeId: 'hole-1', id: 'template:generated', name: 'Structure auto', version: 35,
      updatedAt: '2026-10-04T00:00:00.000Z',
    })
    expect(dataset.columns).toHaveLength(6)
    expect(dataset.columns[4]).toMatchObject({ label: 'RMR76 apparent spacing (m)', dataType: 'numeric' })
    expect(dataset.records[0]).toMatchObject({ depthFrom: 3, depthTo: 6,
      values: { 'csv:Joint spacing': 0.25, 'csv:Joint shape': 'rough, undulating' } })
    expect(dataset.records[0]?.values).not.toHaveProperty('csv:RMR76 apparent spacing (m)')
  })
  it('rejects incomplete quoted exports', () => {
    expect(() => generatedLoggingDataset({ csv: 'From,To\n"3,6', holeId: 'hole', id: 'id',
      name: 'bad', version: 1, updatedAt: '2026-10-04T00:00:00.000Z' })).toThrow('Malformed')
  })
  it('keeps mapping keys stable when another export inserts a header', () => {
    const base = { holeId: 'hole', id: 'id', name: 'Structure', version: 1, updatedAt: '2026-10-04T00:00:00.000Z' }
    const first = generatedLoggingDataset({ ...base, csv: 'From,To,Joint spacing\n0,3,0.5' })
    const second = generatedLoggingDataset({ ...base, csv: 'From,To,Origin,Joint spacing\n0,3,manual,0.7' })
    expect(first.columns.find(column => column.label === 'Joint spacing')?.key)
      .toBe(second.columns.find(column => column.label === 'Joint spacing')?.key)
  })
  it('uses the version saved with an export instead of the live template version', () => {
    expect(generatedLoggingTemplateVersion({ templateVersion: 35 }, 98)).toBe(35)
    expect(generatedLoggingTemplateVersion({ templateVersion: '72' }, 98)).toBe(72)
    expect(generatedLoggingTemplateVersion({}, 98)).toBe(98)
    expect(generatedLoggingDatasetId('template-id', 35)).toBe('template-id:generated:v35')
  })
})

