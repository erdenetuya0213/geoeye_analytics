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
  it('matches point samples to intervals with normalized hole identifiers', () => {
    const base = observation('point', 15, 15, {})
    const candidate = { ...observation('interval', 10, 20, { xrf: 4 }), holeId: 'h_1' }
    const attachment = { datasetId: 'xrf', observations: [candidate], match: 'point-or-interval' as const }
    expect(buildAnalyticalObservations('lab', [base], [attachment])[0]?.values.xrf).toBe(4)
    expect(buildAnalyticalObservations('lab', [{ ...base, locationValid: false }], [attachment])[0]?.values.xrf).toBeUndefined()
  })
  it('handles unsorted holes, nested intervals, boundary points, and stable overlap ties', () => {
    const base = observation('base', 10, 20, {})
    const candidates = [
      { ...observation('wrong-hole', 10, 20, { rating: 99 }), holeId: 'H-2' },
      observation('tie-first', 12, 18, { rating: 1 }),
      observation('boundary', 20, 20, { rating: 2 }),
      observation('tie-second', 12, 18, { rating: 3 }),
      observation('nested-long', 0, 15, { rating: 4 }),
      observation('disjoint', 30, 40, { rating: 5 }),
    ]
    const [result] = buildAnalyticalObservations('base', [base], [{ datasetId: 'ratings', observations: candidates, match: 'interval-overlap' }])
    expect(result?.values.rating).toBe(1)
    expect(result?.sourceObservationIds).toContain('source-tie-first')
    const [point] = buildAnalyticalObservations('base', [observation('point-base', 20, 20, {})], [{ datasetId: 'points', observations: candidates, match: 'registered-depth' }])
    expect(point?.values.rating).toBe(2)
  })

  it('preserves exhaustive overlap results across many holes and irregular supports', () => {
    const candidates = Array.from({ length: 500 }, (_, i) => ({ ...observation(`c-${i}`, (i * 17) % 100, (i * 17) % 100 + (i % 13), { chosen: i }), holeId: `H-${i % 7}` }))
    const bases = Array.from({ length: 90 }, (_, i) => ({ ...observation(`b-${i}`, i % 100, i % 100 + (i % 11), {}), holeId: `H-${i % 7}` }))
    for (const method of ['interval-overlap', 'point-or-interval', 'registered-depth'] as const) {
      const results = buildAnalyticalObservations('base', bases, [{ datasetId: 'attached', observations: candidates, match: method }])
      bases.forEach((base, index) => {
        const scored = candidates.filter(candidate => candidate.holeId === base.holeId).map(candidate => ({ candidate, overlap: Math.max(0, Math.min(base.depthTo, candidate.depthTo) - Math.max(base.depthFrom, candidate.depthFrom)) }))
        const expected = scored.filter(({ candidate, overlap }) => overlap > 0 || (method !== 'interval-overlap' && ((candidate.depthFrom === candidate.depthTo && candidate.depthFrom >= base.depthFrom && candidate.depthFrom <= base.depthTo) || (base.depthFrom === base.depthTo && base.depthFrom >= candidate.depthFrom && base.depthFrom <= candidate.depthTo)))).sort((a, b) => b.overlap - a.overlap || a.candidate.depthFrom - b.candidate.depthFrom)[0]
        expect(results[index]?.values.chosen).toBe(expected?.candidate.values.chosen)
      })
    }
  })
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
