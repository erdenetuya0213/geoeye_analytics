import { describe, expect, it } from 'vitest'
import { calculateDistribution, type DistributionObservation, type DistributionRequest } from './distributionEngine.js'

const observations: DistributionObservation[] = [
  { groupId: 'A', holeId: 'H1', sourceObservationId: 'obs-1', support: 1, value: 0, x: 0, y: 0, z: 1 },
  { groupId: 'A', holeId: 'H1', sourceObservationId: 'obs-2', support: 1, value: 0, x: 1, y: 1, z: 2 },
  { groupId: 'B', holeId: 'H2', sourceObservationId: 'obs-3', support: 2, value: 10, x: 20, y: 0, z: 1 },
]

function request(overrides: Partial<DistributionRequest> = {}): DistributionRequest {
  return {
    algorithmVersion: 'geoeye-distribution-1.0.0',
    bootstrap: { blockSize: 10, iterations: 80, method: 'hole', seed: 42 },
    datasetId: 'dataset-1',
    filterSignature: 'hole=all;group=all',
    missingCount: 1,
    observations,
    snapshotAt: '2026-10-01T00:00:00.000Z',
    supportLabel: 'Downhole interval',
    variableKey: 'assay.au',
    weighting: { cellSize: 10, method: 'equal-hole' },
    ...overrides,
  }
}

describe('DistributionEngine worker adapter', () => {
  it('separates raw sample and equal-hole representative statistics', () => {
    const result = calculateDistribution(request())

    expect(result.sample.summary.mean).toBeCloseTo(10 / 3)
    expect(result.representative.summary.mean).toBeCloseTo(5)
    expect(result.representative.summary.effectiveCount).toBeCloseTo(8 / 3)
    expect(result.representative.summary.missing).toBe(1)
  })

  it('uses centered cumulative weights for plotting positions and weighted quantiles', () => {
    const result = calculateDistribution(request())

    expect(result.representative.probabilityPlot.map((point) => point.probability)).toEqual([
      expect.closeTo(0.125), expect.closeTo(0.375), expect.closeTo(0.75),
    ])
    expect(result.representative.summary.median).toBeCloseTo(10 / 3)
  })

  it('retains source observation IDs through histogram, ECDF, and probability outputs', () => {
    const result = calculateDistribution(request())
    const expected = ['obs-1', 'obs-2', 'obs-3']

    expect(result.histogram.flatMap((bin) => bin.sourceObservationIds).sort()).toEqual(expected)
    expect(result.representative.ecdf.map((point) => point.sourceObservationId).sort()).toEqual(expected)
    expect(result.representative.probabilityPlot.map((point) => point.sourceObservationId).sort()).toEqual(expected)
  })

  it('performs reproducible grouped and spatial-block bootstrap', () => {
    const first = calculateDistribution(request())
    const second = calculateDistribution(request())
    const spatial = calculateDistribution(request({ bootstrap: { blockSize: 10, iterations: 80, method: 'spatial', seed: 42 } }))

    expect(first.uncertainty).toEqual(second.uncertainty)
    expect(first.uncertainty.resamplingUnits).toBe(2)
    expect(spatial.uncertainty.resamplingUnits).toBe(2)
    expect(first.uncertainty.intervals.mean.lower).toBeLessThanOrEqual(first.uncertainty.intervals.mean.estimate)
    expect(first.uncertainty.intervals.mean.upper).toBeGreaterThanOrEqual(first.uncertainty.intervals.mean.estimate)
  })

  it('retains a one-unit population with degenerate uncertainty instead of dropping it', () => {
    const result = calculateDistribution(request({ observations: [observations[0]!] }))

    expect(result.sample.summary.count).toBe(1)
    expect(result.uncertainty.resamplingUnits).toBe(1)
    expect(result.uncertainty.iterations).toBe(0)
    expect(result.uncertainty.intervals.mean.lower).toBe(result.uncertainty.intervals.mean.estimate)
  })
})
