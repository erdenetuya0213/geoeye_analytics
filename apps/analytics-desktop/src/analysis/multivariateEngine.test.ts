import { describe, expect, it } from 'vitest'
import { buildMultivariateRunRequest, calculateMultivariateRun, type MultivariateConfiguration } from './multivariateEngine.js'
import type { EdaDataset } from '../data/edaDemo.js'

const dataset: EdaDataset = {
  dimensions: [{ key: 'lithology', label: 'Lithology' }, { key: 'domain', label: 'Domain' }],
  id: 'dataset-1',
  name: 'Test',
  observations: [
    { depthFrom: 0, depthTo: 1, dimensions: { domain: 'North', lithology: 'A' }, easting: 0, holeId: 'H1', id: 'row-a', joinKey: 'a', lithology: 'A', northing: 0, sampleId: 'A', sourceObservationId: 'source-a', values: { x: 1, y: 2, z: 8 } },
    { depthFrom: 1, depthTo: 2, dimensions: { domain: 'South', lithology: 'A' }, easting: 0, holeId: 'H1', id: 'row-b', joinKey: 'b', lithology: 'A', northing: 0, sampleId: 'B', sourceObservationId: 'source-b', values: { x: 2, y: 4, z: 6 } },
    { depthFrom: 2, depthTo: 3, dimensions: { domain: 'North', lithology: 'B' }, easting: 0, holeId: 'H2', id: 'row-c', joinKey: 'c', lithology: 'B', northing: 0, sampleId: 'C', sourceObservationId: 'source-c', values: { x: 3, y: 6, z: null } },
    { depthFrom: 3, depthTo: 4, dimensions: { domain: 'South', lithology: 'B' }, easting: 0, holeId: 'H2', id: 'row-d', joinKey: 'd', lithology: 'B', northing: 0, sampleId: 'D', sourceObservationId: 'source-d', values: { x: 4, y: 8, z: 2 } },
  ],
  producer: 'Test', project: 'Test', snapshotAt: '2026-10-01T00:00:00.000Z', source: 'demo', support: 'Intervals',
  variables: [
    { decimals: 1, key: 'x', label: 'X', shortLabel: 'X', unit: 'ppm' },
    { decimals: 1, key: 'y', label: 'Y', shortLabel: 'Y', unit: 'ppm' },
    { decimals: 1, key: 'z', label: 'Z', shortLabel: 'Z', unit: 'ppm' },
  ],
}

const configuration: MultivariateConfiguration = {
  activeFilterKeys: [], clusterCount: 2, correlationMethod: 'pearson', datasetId: dataset.id, datasetName: dataset.name,
  filterValues: {}, groupBy: 'lithology', method: 'full', missingPolicy: 'complete-case', scaling: 'standard',
  snapshotAt: dataset.snapshotAt, supportLabel: dataset.support, variableKeys: ['x', 'y', 'z'],
}

describe('GeoEye MultivariateEngine browser adapter', () => {
  it('calculates pairwise counts, PCA, clusters, and group comparisons', () => {
    const request = buildMultivariateRunRequest(configuration, dataset, 1, new Date('2026-10-01T01:00:00.000Z'))
    const result = calculateMultivariateRun(request, new Date('2026-10-01T01:00:01.000Z'))

    expect(result.correlation.pearson[0]?.[1]).toBeCloseTo(1)
    expect(result.correlation.counts[0]?.[2]).toBe(3)
    expect(result.missing.analysisCount).toBe(3)
    expect(result.pca.explainedVarianceRatio.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
    expect(result.rows.flatMap((row) => row.sourceObservationIds).sort()).toEqual(['source-a', 'source-b', 'source-d'])
    expect(result.rows.every((row) => row.holeId !== undefined && row.depthFrom !== undefined && row.sourceDatasetIds?.length === 1)).toBe(true)
    expect(result.rows.every((row) => (row.clusterDistance ?? -1) >= 0 && (row.membershipStrength ?? 0) >= 0.5 && (row.membershipStrength ?? 2) <= 1)).toBe(true)
    expect(new Set(result.rows.map((row) => row.cluster)).size).toBe(2)
    expect(result.groupComparison.map((group) => group.group)).toEqual(['A', 'B'])
  })

  it('retains all rows with deterministic median imputation', () => {
    const request = buildMultivariateRunRequest({ ...configuration, missingPolicy: 'median-impute' }, dataset, 2, new Date('2026-10-01T02:00:00.000Z'))
    const first = calculateMultivariateRun(request)
    const second = calculateMultivariateRun(request)

    expect(first.missing.analysisCount).toBe(4)
    expect(first.rows.find((row) => row.observationId === 'row-c')?.imputed).toBe(true)
    expect(first.rows.map((row) => row.cluster)).toEqual(second.rows.map((row) => row.cluster))
  })

  it('combines a primary and second categorical group for population comparison', () => {
    const request = buildMultivariateRunRequest({ ...configuration, secondGroup: 'domain' }, dataset, 3)

    expect(request.rows.map((row) => row.group)).toEqual(['A · North', 'A · South', 'B · North', 'B · South'])
  })
})
