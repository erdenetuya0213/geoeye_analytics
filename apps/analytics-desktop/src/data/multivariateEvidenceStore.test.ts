import { describe, expect, it } from 'vitest'
import type { MultivariateRunResult } from '../analysis/multivariateEngine.js'
import { readMultivariateDomainEvidence, saveMultivariateDomainEvidence } from './multivariateEvidenceStore.js'

function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
}

const result = {
  clustering: { centroids: [[0, 0], [1, 1]], clusterCount: 2, counts: [1, 1], inertia: 0.2, requestedClusterCount: 2 },
  completedAt: '2026-10-01T01:00:01.000Z', configuration: { activeFilterKeys: [], clusterCount: 2, correlationMethod: 'pearson', datasetId: 'dataset-1', datasetName: 'Test', filterValues: {}, groupBy: null, method: 'full', missingPolicy: 'complete-case', scaling: 'standard', snapshotAt: '2026-10-01T00:00:00.000Z', supportLabel: 'Intervals', variableKeys: ['assay.au', 'geotech.rqd'] },
  configurationSignature: 'signature', correlation: { counts: [[2]], pearson: [[1]], spearman: [[1]] }, groupComparison: [],
  missing: { analysisCount: 2, completeCount: 2, excludedOrImputedCount: 0, inputCount: 2, policy: 'complete-case' },
  pca: { componentCount: 2, cumulativeVarianceRatio: [0.7, 1], eigenvalues: [1.4, 0.6], explainedVarianceRatio: [0.7, 0.3], loadings: [[0.7, 0.7], [0.7, -0.7]] },
  provenance: { algorithmVersion: 'geoeye-multivariate-1.0.0', engine: 'GeoEye MultivariateEngine', randomSeed: 1 }, requestedAt: '2026-10-01T01:00:00.000Z',
  rows: [
    { cluster: 1, depthFrom: 10, depthTo: 14, dimensions: { lithology: 'Diorite' }, group: 'All', holeId: 'DD-01', imputed: false, observationId: 'row-1', scores: [1.2, -0.3], sourceObservationIds: ['assay-1', 'log-1'], values: { 'assay.au': 2.4, 'geotech.rqd': 61 } },
    { cluster: 2, depthFrom: 14, depthTo: 18, dimensions: { lithology: 'Breccia' }, group: 'All', holeId: 'DD-01', imputed: false, observationId: 'row-2', scores: [-0.8, 0.5], sourceObservationIds: ['assay-2', 'log-2'], values: { 'assay.au': 0.2, 'geotech.rqd': 82 } },
  ],
  runId: 'run-5', runNumber: 5, scaling: { centers: [1, 70], method: 'standard', scales: [1, 10] },
} satisfies MultivariateRunResult

describe('multivariate Domain evidence handoff', () => {
  it('passes the selected cluster, PCA scores, variables, run, values, and source IDs', () => {
    const target = storage()
    const evidence = saveMultivariateDomainEvidence(target, result, [2], '2026-10-01T02:00:00.000Z')

    expect(evidence).toMatchObject({ clusterIds: [2], datasetId: 'dataset-1', runId: 'run-5', runNumber: 5, variableKeys: ['assay.au', 'geotech.rqd'] })
    expect(evidence.rows).toEqual([expect.objectContaining({ clusterId: 2, observationId: 'row-2', pcaScores: [-0.8, 0.5], sourceObservationIds: ['assay-2', 'log-2'], values: { 'assay.au': 0.2, 'geotech.rqd': 82 } })])
    expect(readMultivariateDomainEvidence(target)).toEqual(evidence)
  })
})
