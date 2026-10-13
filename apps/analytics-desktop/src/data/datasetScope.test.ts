import { expect, it } from 'vitest'
import type { EdaDataset } from './edaTypes.js'
import { datasetClasses, mergeDatasets, resolveScope, withClassScopes } from './datasetScope.js'

const dataset = (id: string, name: string, kind: NonNullable<EdaDataset['kind']>, variable: string, rows: number): EdaDataset => ({
  dimensions: [{ key: 'drillhole', label: 'Drillhole' }, { key: id, label: id }],
  id, kind, name,
  observations: Array.from({ length: rows }, (_, index) => ({ depthFrom: index, depthTo: index + 1, values: { [variable]: index } })) as EdaDataset['observations'],
  producer: 'GeoEye Analytics local database',
  project: 'Tömörtolgoi',
  snapshotAt: `2026-10-1${rows}T00:00:00.000Z`,
  source: 'live',
  support: 'records',
  variables: [{ dataType: 'numeric', decimals: 2, key: variable, label: variable, shortLabel: variable, unit: '' }] as EdaDataset['variables'],
})

const ucs = dataset('local-class:strength:t1', 'UCS', 'strength', 'strength.ucs', 2)
const pointLoad = dataset('local-class:strength:t2', 'Point load', 'strength', 'strength.is50', 3)
const geotech = dataset('local-field-logging-geotech', 'Geotechnical', 'logging', 'logging.rqd', 4)

it('merges every table of a class into one population, keeping each variable and dimension once', () => {
  const merged = mergeDatasets('class-all:strength', 'All Strength', [ucs, pointLoad])!
  expect(merged.observations).toHaveLength(5)
  expect(merged.variables.map(variable => variable.key)).toEqual(['strength.ucs', 'strength.is50'])
  expect(merged.dimensions.map(dimension => dimension.key)).toEqual(['drillhole', 'local-class:strength:t1', 'local-class:strength:t2'])
  expect(merged).toMatchObject({ kind: 'strength', name: 'All Strength', snapshotAt: '2026-10-13T00:00:00.000Z', support: '2 tables · 5 records' })
})

it('offers an All table for every class, listed first, and lists classes in catalog order', () => {
  const classes = datasetClasses(withClassScopes([pointLoad, geotech, ucs]))
  expect(classes.map(group => group.label)).toEqual(['Logging', 'Strength'])
  expect(classes.map(group => group.datasets.map(item => item.name))).toEqual([
    ['All Logging', 'Geotechnical'],
    ['All Strength', 'Point load', 'UCS'],
  ])
  expect(classes[1]!.datasets[0]!.id).toBe('class-all:strength')
  expect(classes[1]!.datasets[0]!.observations).toHaveLength(5)
})

it('keeps a single-table class usable as All without duplicating its rows', () => {
  const [group] = datasetClasses(withClassScopes([geotech]))
  expect(group!.datasets.map(item => item.id)).toEqual(['class-all:logging', 'local-field-logging-geotech'])
  expect(group!.datasets[0]!.observations).toHaveLength(4)
})

it('keeps a saved selection, and keeps its class when the table is gone', () => {
  const classes = datasetClasses(withClassScopes([ucs, pointLoad, geotech]))
  expect(resolveScope(classes, 'local-class:strength:t1', 'strength').dataset?.name).toBe('UCS')
  // The test was re-imported under a new id: the class stays, the All table stands in for it.
  expect(resolveScope(classes, 'local-class:strength:gone', 'strength')).toMatchObject({ dataset: { id: 'class-all:strength' }, group: { id: 'strength' } })
  // Nothing saved yet, or a class that no longer holds data: the first class opens.
  expect(resolveScope(classes, '', '').group?.id).toBe('logging')
  expect(resolveScope(classes, '', 'xrf').group?.id).toBe('logging')
  expect(resolveScope([], 'any', 'strength')).toEqual({ dataset: undefined, group: undefined })
})
