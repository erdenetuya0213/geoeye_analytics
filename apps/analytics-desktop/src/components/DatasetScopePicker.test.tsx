import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

vi.mock('../state/persistentState.js', () => ({ usePersistentState: (_key: string, value: unknown) => [value, vi.fn()] }))
import { withClassScopes } from '../data/datasetScope.js'
import type { EdaDataset } from '../data/edaTypes.js'
import { DatasetScopePicker } from './DatasetScopePicker.js'

const dataset = (id: string, name: string, kind: NonNullable<EdaDataset['kind']>): EdaDataset => ({
  dimensions: [], id, kind, name, observations: [], producer: 'GeoEye Analytics local database',
  project: 'P', snapshotAt: '2026-10-13T00:00:00.000Z', source: 'live', support: '', variables: [],
})

const datasets = withClassScopes([
  dataset('local-class:strength:t1', 'UCS', 'strength'),
  dataset('local-class:strength:t2', 'Point load', 'strength'),
  dataset('local-field-logging-geotech', 'Geotechnical', 'logging'),
])

it('asks for the class, then the table inside it, with All first', () => {
  const markup = renderToStaticMarkup(createElement(DatasetScopePicker, { ariaPrefix: 'EDA', datasets, onChange: vi.fn(), storageKey: 'explore', value: 'local-class:strength:t2' }))
  expect(markup).toContain('<span>Class</span>')
  expect(markup).toContain('<span>Table</span>')
  const [classSelect, fieldSelect] = markup.split('<select').slice(1)
  expect(classSelect).toContain('<option value="logging">Logging</option><option value="strength"')
  expect(classSelect).toContain('value="strength"')
  expect(fieldSelect).toContain('<option value="class-all:strength">All</option>')
  expect(fieldSelect).toContain('>Point load</option>')
  expect(fieldSelect).toMatch(/value="local-class:strength:t2" selected=""/)
  expect(fieldSelect).not.toContain('Geotechnical')
})

it('falls back to the first class when nothing is selected yet', () => {
  const markup = renderToStaticMarkup(createElement(DatasetScopePicker, { ariaPrefix: 'EDA', datasets, onChange: vi.fn(), storageKey: 'explore', value: '' }))
  const [, fieldSelect] = markup.split('<select').slice(1)
  expect(fieldSelect).toMatch(/value="class-all:logging" selected=""/)
  expect(fieldSelect).toContain('Geotechnical')
})
