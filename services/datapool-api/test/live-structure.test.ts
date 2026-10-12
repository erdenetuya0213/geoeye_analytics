import { describe, expect, it } from 'vitest'
import type { FieldLoggingDataset } from '@geoeye/types'
import { appendLiveStructureCalculations, type LiveLoggingInput } from '../src/live-structure.js'

const template = { classes: [{ id: 'structure', fields: [{ id: 'structure_depth_m' }, { id: 'discontinuity_type' }], structureRatingSystems: ['rmr76'] }],
  structureComposite: { rule: 'fixed', intervalLengthM: 3, startDepthM: 0, boundaryRule: 'none' } }
function source(): FieldLoggingDataset {
  return { id: 'auto', name: 'Structure auto', version: 35, updatedAt: '2026-10-05T00:00:00.000Z', category: 'geotechnical', columns: [], records: [] }
}
function structure(id: string, hole: string, depth: number, values: Record<string, string> = {}): LiveLoggingInput {
  return { id, hole_id: hole, template_id: 'auto', class_id: 'structure', depth_from: depth, depth_to: depth,
    selections_json: { discontinuity_type: 'joint-id', roughness: 'VR', infill_type: 'N', aperture_band: 'TG',
      wall_rock_hardness: 'H', joint_continuity: 'D', ...values } }
}
const codes = new Map([['joint-id', 'JN']])
const core = (hole: string) => ({ hole_id: hole, depth_from: 0, depth_to: 6 })

describe('live structure calculated columns', () => {
  it('calculates named export columns from current records in every hole without any CSV', () => {
    const dataset = source()
    appendLiveStructureCalculations({ dataset, template, dictionaryCodes: codes, intervals: [],
      coreRanges: [core('hole-1'), core('hole-2')], structures: [
        structure('1', 'hole-1', 0.2), structure('2', 'hole-1', 0.6),
        structure('3', 'hole-2', 0.3), structure('4', 'hole-2', 1.3),
      ] })
    expect(dataset.columns).toContainEqual({ key: 'derived:Joint spacing', label: 'Joint spacing', dataType: 'numeric', unit: 'm' })
    expect(dataset.records).toHaveLength(4)
    expect(dataset.records.find(row => row.holeId === 'hole-1')?.values).toMatchObject({ 'derived:Joint spacing': 0.4, 'derived:RMR76 JCR': 25 })
    expect(dataset.records.find(row => row.holeId === 'hole-2')?.values['derived:Joint spacing']).toBe(1)
    expect(dataset.records[0]?.values).not.toHaveProperty('derived:RMR76 apparent spacing (m)')
    expect(dataset.records.find(row => row.depthFrom === 3)?.values['derived:Joint spacing']).toBe(0)
  })
  it('requires complete conditions and reviewed sets, and assigns boundary features to one interval', () => {
    const dataset = source()
    appendLiveStructureCalculations({ dataset, template, dictionaryCodes: codes, intervals: [], coreRanges: [core('hole')],
      structures: [structure('1', 'hole', 0.2, { joint_set_id: 'A' }), structure('2', 'hole', 0.7, { joint_set_id: 'A' }),
        structure('3', 'hole', 3, { roughness: '' }), structure('4', 'hole', 4), structure('vein', 'hole', 0.4, { discontinuity_type: 'VN' })] })
    expect(dataset.records[0]?.values).toMatchObject({ 'derived:RMR76 apparent spacing (m)': 0.5, 'derived:RMR76 spacing score': 20 })
    expect(dataset.records[1]?.values['derived:Joint spacing']).toBe(1)
    expect(dataset.records[1]?.values).not.toHaveProperty('derived:RMR76 JCR')
  })
  it('merges overlapping omissions and withholds results only when more than half is omitted', () => {
    const dataset = source()
    const omission = { ...template, structureComposite: { ...template.structureComposite,
      omissionRules: [{ field: 'geotech::weathering::grade', values: ['soil'] }] } }
    const interval = (from: number, to: number): LiveLoggingInput => ({ id: `${from}`, template_id: 'geotech', class_id: 'weathering', hole_id: 'hole',
      depth_from: from, depth_to: to, selections_json: { grade: 'soil' } })
    appendLiveStructureCalculations({ dataset, template: omission, dictionaryCodes: codes,
      intervals: [interval(0, 2), interval(1, 2.5)], coreRanges: [core('hole')],
      structures: [structure('1', 'hole', 0.2), structure('2', 'hole', 1)] })
    expect(dataset.records[0]?.values).toHaveProperty('derived:Non-RMR zone')
    expect(dataset.records[0]?.values['derived:Joint spacing']).toBe(0)
    expect(dataset.records[0]?.values).not.toHaveProperty('derived:RMR76 JCR')
    expect(dataset.records[0]?.values).not.toHaveProperty('derived:RMR76 spacing score')
    expect(dataset.composite?.intervals[0]?.exclusionReason).toBe('Field structure omission rule')
  })
  it('uses boundary states across split image rows and restarts fixed lengths at state changes', () => {
    const dataset = source()
    const boundaryTemplate = { id: 'geotech', template_json: { id: 'local-geotech', classes: [{ id: 'integrity', fields: [{ id: 'grade' }] }] } }
    const interval = (from: number, to: number, value: string): LiveLoggingInput => ({ id: `${from}`, template_id: 'geotech', class_id: 'integrity', hole_id: 'hole',
      depth_from: from, depth_to: to, selections_json: { grade: value } })
    appendLiveStructureCalculations({ dataset, template: { ...template, structureComposite: { ...template.structureComposite, boundaryRule: 'local-geotech::integrity' } },
      templates: [boundaryTemplate], dictionaryCodes: codes, coreRanges: [core('hole')],
      intervals: [interval(0, 1, 'A'), interval(1, 2, 'A'), interval(2, 6, 'B')],
      structures: [structure('1', 'hole', 0.2), structure('2', 'hole', 1)] })
    expect(dataset.records.map(row => [row.depthFrom, row.depthTo])).toEqual([[0, 2], [2, 5], [5, 6]])
  })
  it('excludes located core loss and starts a fresh composite after it', () => {
    const dataset = source()
    appendLiveStructureCalculations({ dataset, template, dictionaryCodes: codes, intervals: [],
      coreRanges: [{ ...core('hole'), row_bbox_json: { coreLossIntervals: [{ depthFrom: 1, depthTo: 2 }] } }],
      structures: [structure('1', 'hole', 0.2), structure('2', 'hole', 0.6), structure('lost', 'hole', 1.5)] })
    expect(dataset.records.map(row => [row.depthFrom, row.depthTo])).toEqual([[0, 1], [2, 5], [5, 6]])
    expect(dataset.records[0]?.values['derived:Joint spacing']).toBe(0.4)
    expect(dataset.records[1]?.values['derived:Joint spacing']).toBe(0)
  })
  it('does not turn a single fracture into a measured zero spacing', () => {
    const dataset = source()
    appendLiveStructureCalculations({ dataset, template, dictionaryCodes: codes, intervals: [],
      coreRanges: [core('hole')], structures: [structure('1', 'hole', 0.2)] })
    expect(dataset.records[0]?.values).not.toHaveProperty('derived:Joint spacing')
    expect(dataset.records[1]?.values['derived:Joint spacing']).toBe(0)
    expect(dataset.records[1]?.values).not.toHaveProperty('derived:Non-RMR zone')
  })
  it('withholds derived values when a selected Field boundary has no records', () => {
    const dataset = source()
    appendLiveStructureCalculations({ dataset, template: { ...template, structureComposite: { ...template.structureComposite, boundaryRule: 'missing::class' } },
      dictionaryCodes: codes, intervals: [], coreRanges: [core('hole')],
      structures: [structure('1', 'hole', 0.2), structure('2', 'hole', 0.6)] })
    expect(dataset.records).toEqual([])
    expect(dataset.composite?.intervals).toEqual([])
  })
})
