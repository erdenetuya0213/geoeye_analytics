import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { FieldFilters, type FilterField } from './FieldFilters.js'

const fields: FilterField[] = [
  { key: 'lithology', kind: 'category', label: 'Lithology', values: ['LST', 'DOL', 'AND'] },
  { key: 'logging.rqd', kind: 'number', label: 'RQD', unit: '%' },
  { key: 'drillhole', kind: 'category', label: 'Drillhole', values: ['TT_2026_001GT'] },
]
const render = (keys: string[], filters: Record<string, never> | object) => renderToStaticMarkup(createElement(FieldFilters, {
  ariaPrefix: 'EDA', fields, filters: filters as never, keys, onChangeFilter: vi.fn(), onChangeKeys: vi.fn(),
}))

it('offers the dictionary of a category field, with All and a multi-value summary', () => {
  const markup = render(['lithology'], { lithology: { kind: 'category', values: ['LST', 'DOL'] } })
  expect(markup).toContain('<span>Lithology</span><strong>2 selected</strong>')
  expect(markup).toContain('Remove Lithology filter')
  expect(markup).toContain('<option value="logging.rqd">RQD</option>')
  expect(render(['lithology'], {})).toContain('<span>Lithology</span><strong>All</strong>')
  expect(render(['lithology'], { lithology: { kind: 'category', values: ['DOL'] } })).toContain('<strong>DOL</strong>')
})

it('asks a numeric field for less than, more than or between, showing only the inputs that apply', () => {
  const less = render(['logging.rqd'], { 'logging.rqd': { kind: 'number', max: 80, min: null } })
  expect(less).toContain('<span>RQD (%)</span>')
  expect(less).toContain('value="max"')
  expect(less).toContain('aria-label="EDA RQD maximum"')
  expect(less).not.toContain('aria-label="EDA RQD minimum"')
  const between = render(['logging.rqd'], { 'logging.rqd': { kind: 'number', max: 80, min: 50 } })
  expect(between).toContain('aria-label="EDA RQD minimum"')
  expect(between).toContain('aria-label="EDA RQD maximum"')
  expect(between).toContain('value="50"')
  const more = render(['logging.rqd'], { 'logging.rqd': { kind: 'number', max: null, min: 50 } })
  expect(more).toContain('aria-label="EDA RQD minimum"')
  expect(more).not.toContain('aria-label="EDA RQD maximum"')
})

it('lists only the fields that are not filtered yet', () => {
  const markup = render(['lithology', 'logging.rqd'], {})
  expect(markup).toContain('<option value="drillhole">Drillhole</option>')
  expect(markup).not.toContain('<option value="lithology">Lithology</option>')
})
