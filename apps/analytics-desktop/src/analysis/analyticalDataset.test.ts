import { describe, expect, it } from 'vitest'
import type { EdaObservation } from './eda.js'
import { buildAnalyticalObservations } from './analyticalDataset.js'

function observation(id: string, depthFrom: number, depthTo: number, values: Record<string, number>): EdaObservation {
  return {
    depthFrom,
    depthTo,
    dimensions: { lithology: 'Base' },
    easting: 0,
    holeId: 'H-1',
    id,
    joinKey: `H-1:${depthFrom}:${depthTo}`,
    lithology: 'Base',
    northing: 0,
    sampleId: id,
    sourceObservationId: `source-${id}`,
    values,
  }
}

describe('analytical dataset support matching', () => {
  it('attaches the greatest interval overlap and preserves source lineage', () => {
    const base = observation('assay-1', 10, 20, { 'assay.au': 1.2 })
    const shortMatch = { ...observation('log-short', 9, 13, { 'geotech.rqd': 30 }), dimensions: { lithology: 'Breccia' } }
    const bestMatch = { ...observation('log-best', 12, 19, { 'geotech.rqd': 72 }), dimensions: { lithology: 'Diorite' } }

    const [result] = buildAnalyticalObservations('assays', [base], [{
      datasetId: 'logging',
      dimensions: ['lithology'],
      match: 'interval-overlap',
      observations: [shortMatch, bestMatch],
    }])

    expect(result?.values).toMatchObject({ 'assay.au': 1.2, 'geotech.rqd': 72 })
    expect(result?.dimensions.lithology).toBe('Diorite')
    expect(result?.sourceObservationIds).toEqual(['source-assay-1', 'source-log-best'])
    expect(result?.analyticalLineage).toEqual(expect.arrayContaining([
      expect.objectContaining({ datasetId: 'assays', match: 'base-support', sourceObservationId: 'source-assay-1' }),
      expect.objectContaining({ datasetId: 'logging', match: 'interval-overlap', overlap: 7, sourceObservationId: 'source-log-best' }),
    ]))
  })

  it('matches point support only when it falls inside the base interval', () => {
    const base = observation('assay-1', 10, 20, { 'assay.au': 1.2 })
    const inside = observation('xrf-in', 15, 15, { 'xrf.cu': 0.4 })
    const outside = observation('xrf-out', 25, 25, { 'xrf.cu': 0.9 })
    const [result] = buildAnalyticalObservations('assays', [base], [{ datasetId: 'xrf', match: 'point-or-interval', observations: [outside, inside] }])

    expect(result?.values['xrf.cu']).toBe(0.4)
    expect(result?.sourceObservationIds).not.toContain('source-xrf-out')
  })
})
