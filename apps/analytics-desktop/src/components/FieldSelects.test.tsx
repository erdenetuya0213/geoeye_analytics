import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { EdaVariableDefinition } from '../data/edaTypes.js'
import { FieldSelects } from './FieldSelects.js'

const variable = (key: string, label: string, unit = ''): EdaVariableDefinition => ({ dataType: 'numeric', decimals: 2, key, label, shortLabel: label, unit })
const variables = [variable('a.rqd', 'RQD', '%'), variable('a.ucs', 'UCS', 'MPa'), variable('a.is50', 'Is(50)', 'MPa')]

it('numbers each chosen field and offers the rest under Add field', () => {
  const markup = renderToStaticMarkup(createElement(FieldSelects, { ariaPrefix: 'EDA', onChange: vi.fn(), value: ['a.rqd', 'a.ucs'], variables }))
  expect(markup).toContain('<span>Field 1</span>')
  expect(markup).toContain('<span>Field 2</span>')
  expect(markup).toContain('<span>Add field</span>')
  expect(markup).toContain('>RQD (%)</option>')
  const [first, second, add] = markup.split('<select').slice(1)
  expect(first).toContain('aria-label="EDA field 1"')
  expect(first).toContain('>Remove field 1</option>')
  expect(second).not.toContain('>UCS (MPa)</option><option value="a.ucs"')
  expect(add).toContain('>Is(50) (MPa)</option>')
  expect(add).not.toContain('>RQD (%)</option>')
})

it('keeps the last field when the minimum is one, and stops offering more when every field is used', () => {
  const single = renderToStaticMarkup(createElement(FieldSelects, { ariaPrefix: 'EDA', onChange: vi.fn(), value: ['a.rqd'], variables }))
  expect(single).not.toContain('Remove field 1')
  const full = renderToStaticMarkup(createElement(FieldSelects, { ariaPrefix: 'EDA', onChange: vi.fn(), value: variables.map(item => item.key), variables }))
  expect(full).not.toContain('<span>Add field</span>')
  expect(full).toContain('<span>Field 3</span>')
})
