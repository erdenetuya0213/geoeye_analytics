import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EdaDataset } from '../data/edaDemo.js'
import { EdaDatasetOptions } from './EdaDatasetOptions.js'

const loggingDataset: EdaDataset = {
  dimensions: [],
  id: 'local-field-logging-core-log',
  name: 'Core logging · Logging v2',
  observations: [],
  producer: 'GeoEye Field local database',
  project: 'Project',
  snapshotAt: '2026-10-04T00:00:00.000Z',
  source: 'live',
  support: 'logging intervals',
  variables: [{ dataType: 'numeric', decimals: 1, key: 'logging.rqd', label: 'RQD', shortLabel: 'RQD', unit: '%' }],
}

describe('EdaDatasetOptions', () => {
  it('shows the complete local data-type catalog and places available data in its group', () => {
    const markup = renderToStaticMarkup(createElement('select', null, createElement(EdaDatasetOptions, { datasets: [loggingDataset] })))

    expect(markup).toContain('<optgroup label="Drillholes">')
    expect(markup).toContain('<optgroup label="Logging"><option value="local-field-logging-core-log">Core logging · Logging v2</option>')
    expect(markup).toContain('<optgroup label="Lab / Assay">')
    expect(markup).toContain('<optgroup label="Strength">')
    expect(markup).toContain('<optgroup label="XRF">')
    expect(markup).toContain('<optgroup label="Spectral">')
  })
})
