import { describe, expect, it } from 'vitest'
import { normalizeFieldLoggingDataset, type FieldLoggingDataset } from '@geoeye/types'

function source(): FieldLoggingDataset {
  return { id: 'structure', name: 'Structure', version: 1, updatedAt: '2026-10-06T00:00:00Z', category: 'structure',
    columns: [
      { key: 'calculation_saved_result_1', label: 'Joint spacing', dataType: 'numeric', unit: null },
      { key: 'derived:Joint spacing', label: 'Joint spacing', dataType: 'numeric', unit: 'm' },
      { key: 'primary_spacing', label: 'Joint spacing', dataType: 'numeric', unit: 'm' },
    ], records: [
      { id: 'saved', holeId: 'hole', depthFrom: 0, depthTo: 3, values: { calculation_saved_result_1: 99 } },
      { id: 'mixed', holeId: 'hole', depthFrom: 3, depthTo: 6, values: { calculation_saved_result_1: 88, primary_spacing: 0 } },
      { id: 'live', holeId: 'hole', depthFrom: 0, depthTo: 3, values: { 'derived:Joint spacing': 0.4 } },
    ] }
}

describe('authoritative logging calculations', () => {
  it('removes saved calculation columns and rows but preserves primary values and the source', () => {
    const dataset = source(), original = structuredClone(dataset)
    const result = normalizeFieldLoggingDataset(dataset)
    expect(result.columns.map(c => c.key)).toEqual(['derived:Joint spacing', 'primary_spacing'])
    expect(result.records.map(r => r.id)).toEqual(['mixed', 'live'])
    expect(result.records[0]?.values).toEqual({ primary_spacing: 0 })
    expect(dataset).toEqual(original)
    expect(normalizeFieldLoggingDataset(result)).toEqual(result)
  })
  it('retains saved calculations when no replacement exists', () => {
    const dataset = source()
    dataset.columns = dataset.columns.filter(c => !c.key.startsWith('derived:'))
    dataset.records = dataset.records.filter(r => r.id !== 'live')
    expect(normalizeFieldLoggingDataset(dataset)).toBe(dataset)
  })
})
