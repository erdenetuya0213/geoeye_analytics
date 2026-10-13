import { expect, it } from 'vitest'
import type { EdaDataset } from './edaTypes.js'
import { categoryValues, filterFields, numericFields } from './fieldOptions.js'

const observation = (holeId: string, strength: string, rqd: number): EdaDataset['observations'][number] => ({
  depthFrom: 0,
  depthTo: 1,
  dimensions: { data_source: 'Geotechnical', dataset: 'Geotechnical', drillhole: holeId, field_strength: strength, logging_template: 'Geotechnical' },
  easting: 0,
  holeId,
  id: `${holeId}:${rqd}`,
  joinKey: `${holeId}:0:1`,
  lithology: 'Unassigned',
  northing: 0,
  sampleId: `${holeId}-1`,
  sourceObservationId: `${holeId}:${rqd}`,
  values: { 'logging.rqd': rqd },
})

const dataset: EdaDataset = {
  dimensions: [
    { key: 'drillhole', label: 'Drillhole' },
    { key: 'data_source', label: 'Data source' },
    { key: 'dataset', label: 'Dataset' },
    { key: 'logging_template', label: 'Logging template' },
    { key: 'field_strength', label: 'Field strength (ISRM)' },
  ],
  id: 'local-field-logging-geotech',
  kind: 'logging',
  name: 'Geotechnical',
  observations: [observation('GT-01', 'R4', 62), observation('GT-02', 'R2', 41), observation('GT-01', 'R4', 88)],
  producer: 'GeoEye Field local database',
  project: 'Tömörtolgoi',
  snapshotAt: '2026-10-13T00:00:00.000Z',
  source: 'live',
  support: 'logging intervals · 3 records',
  variables: [
    { dataType: 'numeric', decimals: 1, key: 'logging.rqd', label: 'RQD', shortLabel: 'RQD', unit: '%' },
    { dataType: 'category', decimals: 0, key: 'field_strength', label: 'Field strength (ISRM)', shortLabel: 'Field strength', unit: '' },
  ],
}

it('offers only numeric columns as analysis fields', () => {
  expect(numericFields(dataset).map((variable) => variable.key)).toEqual(['logging.rqd'])
  expect(numericFields(undefined)).toEqual([])
})

it('filters by the numeric fields and by the text columns of the chosen table', () => {
  expect(filterFields(dataset)).toEqual([
    { key: 'logging.rqd', kind: 'number', label: 'RQD', unit: '%' },
    { key: 'drillhole', kind: 'category', label: 'Drillhole', values: ['GT-01', 'GT-02'] },
    { key: 'field_strength', kind: 'category', label: 'Field strength (ISRM)', values: ['R2', 'R4'] },
  ])
})

it('leaves out a column that holds one value everywhere, so a table cannot be filtered by its own name', () => {
  const keys = filterFields(dataset).map((field) => field.key)
  expect(keys).not.toContain('dataset')
  expect(keys).not.toContain('data_source')
  expect(keys).not.toContain('logging_template')
})

it('reads a text column dictionary in order, ignoring blanks', () => {
  expect(categoryValues(dataset, 'field_strength')).toEqual(['R2', 'R4'])
  expect(categoryValues(dataset, 'missing')).toEqual([])
})
