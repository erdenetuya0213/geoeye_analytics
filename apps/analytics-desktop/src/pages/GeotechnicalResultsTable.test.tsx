import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { calculateRmr76Intervals, type GeotechnicalInterval, type InputCandidate } from '../analysis/geotechnicalWorkflow.js'
import { filterRmrResults, GeotechnicalResultsTable, resultValue } from './GeotechnicalResultsTable.js'

function interval(id = 'DH-01', missing = false): GeotechnicalInterval {
  const values: Array<[InputCandidate['canonicalKey'], unknown]> = [
    ['geotech.ucs', 120], ['geotech.rqd', 90], ['structure.joint_spacing', 1.2],
    ['geotech.joint_condition', 6], ['geotech.groundwater', 'moist'], ['structure.orientation_rating', 0],
  ]
  return { id, holeId: id, depthFrom: 10.01234, depthTo: 13.05678, lithology: 'LST',
    candidates: values.filter(([key]) => !missing || key !== 'geotech.ucs').map(([canonicalKey, value]) => ({
      canonicalKey, value, availability: canonicalKey === 'geotech.joint_condition' ? 'fallback' : 'direct',
      sourceLabel: 'Logging', sourceTemplateId: 'source', sourceFieldId: canonicalKey, observationId: id + canonicalKey,
    })) }
}
const results = calculateRmr76Intervals([interval(), interval('DH-02', true), { ...interval('DH-03'), exclusionReason: 'Core loss' }], new Set(['source']), 'run', '2026-10-05').intervals
function render(rows = results) {
  return renderToStaticMarkup(createElement(GeotechnicalResultsTable, { intervals: rows, selectedId: null, onSelect: vi.fn(), status: 'all', onStatusChange: vi.fn() }))
}

describe('RMR results table', () => {
  it('shows input values and component ratings with an explicit result basis', () => {
    const html = render([results[0]!])
    expect(html).toContain('<table')
    expect(html).toContain('10.01234')
    expect(html).toContain('13.05678')
    expect(html).toContain('UCS (MPa)')
    expect(html).toContain('Spacing (m)')
    expect(html).toContain('Groundwater')
    expect(html).toContain('Basic RMR')
    expect(html).toContain('Adjusted')
    expect(html).toContain('12 pts')
    expect(html).toContain('6 pts')
    expect(html).toContain('Estimated: Joint condition')
    expect(html).toContain('Adjustment (pts)')
    expect(html).toContain('<td>0<small>0</small></td>')
    expect(html).not.toContain('[object Object]')
  })
  it('retains available inputs but does not display a final rating for missing or excluded rows', () => {
    const html = render(results.slice(1))
    expect(html).toContain('Missing: UCS')
    expect(html).toContain('Core loss')
    expect(html).toContain('>90</span>')
    expect(html.match(/Not calculated/g)).toHaveLength(2)
    expect(html).not.toContain('Adjusted')
    expect(html).not.toContain('Basic</small>')
  })
  it('identifies a basic result with unassessed orientation', () => {
    const result = results[0]!
    const basic = [{ ...result, calculation: { ...result.calculation!, ratingBasis: 'basic' as const,
      orientationAdjustment: null, total: result.calculation!.basic }, resolvedInputs: { ...result.resolvedInputs,
      'structure.orientation_rating': { ...result.resolvedInputs['structure.orientation_rating'], availability: 'missing' as const, value: null } } }]
    const html = render(basic)
    expect(html).toContain('Basic</small>')
    expect(html).toContain('Not assessed')
    expect(html).not.toContain('Missing inputs</span>')
  })
  it('filters by borehole, missing status and estimated inputs', () => {
    expect(filterRmrResults(results, ' dh-02 ', 'missing').map(row => row.holeId)).toEqual(['DH-02'])
    expect(filterRmrResults(results, '', 'valid')).toHaveLength(1)
    expect(filterRmrResults(results, '', 'estimated')).toHaveLength(3)
    expect(filterRmrResults(results, 'unknown', 'all')).toHaveLength(0)
  })
  it('bounds the rendered table to 50 rows and keeps the full row count', () => {
    const html = render(Array.from({ length: 1908 }, (_, index) => ({ ...results[0]!, id: String(index) })))
    expect(html.match(/scope="row"/g)).toHaveLength(50)
    expect(html).toContain('Rows 1–50 of 1,908')
    expect(html).toContain('Page 1 of 39')
  })
  it('formats missing, zero and orientation values without inventing a score', () => {
    expect(resultValue(null)).toBe('—')
    expect(resultValue(NaN)).toBe('—')
    expect(resultValue(0)).toBe('0')
    expect(resultValue({ orientation: 'very-favourable', excavationType: 'slope' })).toBe('very favourable')
  })
})
