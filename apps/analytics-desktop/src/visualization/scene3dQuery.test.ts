import { describe, expect, it } from 'vitest'
import type { EdaObservation } from '../analysis/eda.js'
import type { EdaDataset } from '../data/edaDemo.js'
import { compileSceneQuery, distanceToSection } from './scene3dQuery.js'

const observation: EdaObservation = {
  depthFrom: 10,
  depthTo: 14,
  dimensions: { alteration: 'Phyllic', domain: 'D-02', lithology: 'Diorite' },
  easting: 500,
  holeId: 'DD-01',
  id: 'row-1',
  joinKey: 'DD-01:10:14',
  lithology: 'Diorite',
  northing: 1_000,
  sampleId: 'S-1',
  sourceObservationId: 'source-1',
  values: { 'assay.au': 1.8, 'geotech.rmr76': 36, 'multivariate.cluster_id': 2 },
}

const dataset = {
  dimensions: [{ key: 'lithology', label: 'Lithology' }],
  id: 'dataset',
  name: 'Dataset',
  observations: [observation],
  producer: 'test',
  project: 'test',
  snapshotAt: '2026-10-01T00:00:00.000Z',
  source: 'demo',
  support: 'interval',
  variables: [
    { decimals: 2, key: 'assay.au', label: 'Gold', shortLabel: 'Au', unit: 'g/t' },
    { decimals: 0, key: 'geotech.rmr76', label: 'RMR 1976', shortLabel: 'RMR76', unit: 'score' },
    { dataType: 'category', decimals: 0, key: 'multivariate.cluster_id', label: 'Cluster ID', shortLabel: 'Cluster', unit: 'class' },
  ],
} satisfies EdaDataset

describe('3D scene queries', () => {
  it('matches numeric Data Pool aliases', () => {
    expect(compileSceneQuery(dataset, 'Au > 1').matches(observation)).toBe(true)
    expect(compileSceneQuery(dataset, 'RMR76 < 40').matches(observation)).toBe(true)
  })

  it('matches category and C-prefixed cluster values', () => {
    expect(compileSceneQuery(dataset, 'Lithology = Diorite').matches(observation)).toBe(true)
    expect(compileSceneQuery(dataset, 'Cluster_ID = C2').matches(observation)).toBe(true)
  })

  it('reports fields that are not in the current view', () => {
    expect(compileSceneQuery(dataset, 'Fe > 10').error).toContain('not available')
  })

  it('measures signed section-normal distance', () => {
    expect(distanceToSection(observation, { x: 480, y: 900 }, 0)).toBe(20)
    expect(distanceToSection(observation, { x: 480, y: 900 }, 90)).toBeCloseTo(-100)
  })
})
