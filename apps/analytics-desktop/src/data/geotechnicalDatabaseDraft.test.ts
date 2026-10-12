import { describe, expect, it } from 'vitest'
import { calculateRmr76Intervals, RMR76_METHOD_DEFINITION, type GeotechnicalInterval } from '../analysis/geotechnicalWorkflow.js'
import { geotechnicalDatabaseDraft, geotechnicalDatabaseDraftFileName } from './geotechnicalDatabaseDraft.js'

function interval(orientation?: number): GeotechnicalInterval {
  const values: unknown[] = [150, 70, .3, 20, 'dry', orientation]
  return { id: 'interval', holeId: 'TEST-001', depthFrom: 0, depthTo: 3, lithology: '', candidates: RMR76_METHOD_DEFINITION.requiredInputs.flatMap((input, index) => values[index] === undefined ? [] : [{ canonicalKey: input.key, value: values[index], availability: 'direct', sourceTemplateId: 'source', sourceFieldId: input.key, sourceLabel: 'Reference test', observationId: input.key }]) }
}
function run(intervals: GeotechnicalInterval[]) { return calculateRmr76Intervals(intervals, new Set(['source']), 'test-run', '2026-10-05T00:00:00Z', 'test-snapshot') }
function records(result: ReturnType<typeof run>, components: boolean) {
  const draft = geotechnicalDatabaseDraft(result, components)
  return draft.rows.map(row => Object.fromEntries(draft.columns.map((column, index) => [column, row[index]])))
}

describe('RMR76 database results', () => {
  it('names new result files using the analysis label and calculation date, not the run UUID', () => {
    const name = geotechnicalDatabaseDraftFileName('opaque-uuid', true, 'RMR76 Auto / хүний засвар', '2026-10-06T05:25:36.327Z')
    expect(name).toContain('RMR76 Auto')
    expect(name).toContain('хүний засвар')
    expect(name).toContain('2026-10-06')
    expect(name).not.toContain('opaque-uuid')
    expect(name).not.toMatch(/[<>:"/\\|?*]/)
  })
  it('matches published RMR76 component ratings and preserves Basic versus Adjusted', () => {
    // Hoek, Kaiser & Bawden, Support of Underground Excavations, table 8.5:
    // UCS 100–200 => 12; RQD 70 => 13; spacing 0.3m => 20; condition 20; dry => 10.
    const result = run([interval(), { ...interval(-25), id: 'adjusted' }])
    expect(result.intervals.map(item => item.calculation?.total)).toEqual([75, 50])
    const rows = records(result, true)
    expect(rows[0]).toMatchObject({ RMR76: '75', 'Rating basis': 'basic', 'Basic RMR76': '75', 'RMR76 class': 'Class II · good', 'Strength rating': '12', 'RQD rating': '13', 'Joint spacing rating': '20', 'Groundwater rating': '10', 'Orientation adjustment': '' })
    expect(rows[1]).toMatchObject({ RMR76: '50', 'Rating basis': 'adjusted', 'Orientation adjustment': '-25' })
  })
  it('retains unresolved and excluded intervals without assigning a score', () => {
    const missing = { ...interval(), id: 'missing', candidates: [] }
    const excluded = { ...interval(), id: 'excluded', exclusionReason: 'Invalid sample' }
    const rows = records(run([missing, excluded]), true)
    expect(rows[0]).toMatchObject({ RMR76: '', Status: 'missing', 'Strength rating': '', 'UCS MPa': '' })
    expect(rows[0]!['Missing inputs']).toContain('geotech.ucs')
    expect(rows[1]).toMatchObject({ RMR76: '', Status: 'excluded', 'Exclusion reason': 'Invalid sample' })
  })
  it('retains estimation lineage and omits optional components when unchecked', () => {
    const sample=interval(); sample.candidates=sample.candidates.map(item=>item.canonicalKey==='geotech.joint_condition'?{...item, availability:'fallback'}:item)
    const row=records(run([sample]),false)[0]!
    expect(row['Estimated inputs']).toBe('geotech.joint_condition')
    expect(row['Source lineage']).toContain('fallback')
    expect(row).not.toHaveProperty('Joint condition rating')
  })
  it('exports logged strength grades separately from numeric UCS', () => {
    const sample = interval()
    sample.candidates = sample.candidates.map(item => item.canonicalKey === 'geotech.ucs'
      ? { ...item, value: { strengthRating: 4, label: 'R3 · Medium strong', basis: 'ISRM field grade (lower rating)' } } : item)
    const row = records(run([sample]), true)[0]!
    expect(row['UCS MPa']).toBe('')
    expect(row['Field strength grade']).toContain('R3')
    expect(row['Strength rating']).toBe('4')
  })
})
