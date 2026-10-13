import { describe, expect, it } from 'vitest'
import { compositeDataset } from './compositing.js'
import type { EdaDataset } from '../data/edaTypes.js'
import type { EdaObservation } from './eda.js'

const obs = (holeId: string, from: number, to: number, au: number | null, lith = 'A'): EdaObservation => ({ id: `${holeId}-${from}`, holeId, depthFrom: from, depthTo: to, easting: 100, northing: 200, dimensions: {}, lithology: lith, sampleId: 's', sourceObservationId: `${holeId}-${from}`, joinKey: holeId, values: { au } })
const dataset: EdaDataset = { id: 'd', name: 'D', producer: 'p', project: 'x', snapshotAt: '', source: 'demo', support: '1 m', dimensions: [], variables: [{ key: 'au', label: 'Au', shortLabel: 'Au', unit: 'ppm', decimals: 2 }],
  observations: [obs('H1', 0, 1, 1), obs('H1', 1, 2, 3), obs('H1', 2, 3, 5, 'B'), obs('H1', 3, 3.4, 7, 'B'), obs('H2', 10, 12, 2), obs('H2', 12, 13, null)] }

describe('compositeDataset', () => {
  it('length-weights values and majority-picks categories', () => {
    const { dataset: c, stats } = compositeDataset(dataset, { length: 2 })
    const h1 = c.observations.filter((o) => o.holeId === 'H1')
    expect(h1.map((o) => [o.depthFrom, o.depthTo])).toEqual([[0, 2], [2, 3.4]])
    expect(h1[0]?.values.au).toBeCloseTo(2)
    expect(h1[1]?.values.au).toBeCloseTo((5 * 1 + 7 * 0.4) / 1.4)
    expect(h1[1]?.lithology).toBe('B')
    expect(stats.merged).toBe(1)
  })
  it('ignores nulls in the weighted mean and keeps lineage', () => {
    const { dataset: c } = compositeDataset(dataset, { length: 3 })
    const h2 = c.observations.find((o) => o.holeId === 'H2')
    expect(h2?.values.au).toBeCloseTo(2)
    expect(h2?.sourceObservationIds).toEqual(['H2-10', 'H2-12'])
  })
  it('rejects bad length', () => { expect(() => compositeDataset(dataset, { length: 0 })).toThrow() })
})
