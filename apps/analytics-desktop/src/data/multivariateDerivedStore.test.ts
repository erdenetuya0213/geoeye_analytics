import { describe, expect, it } from 'vitest'
import type { MultivariateRunResult } from '../analysis/multivariateEngine.js'
import { readMultivariateDerivedDocument, saveMultivariateDerivedVariables } from './multivariateDerivedStore.js'

const storage = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
}

const result = {
  clustering: { centroids: [[0, 0]], clusterCount: 1, counts: [1], inertia: 0, requestedClusterCount: 2 },
  completedAt: '2026-10-01T01:00:01.000Z', configuration: { activeFilterKeys: [], clusterCount: 2, correlationMethod: 'pearson', datasetId: 'dataset-1', datasetName: 'Test', filterValues: {}, groupBy: null, method: 'full', missingPolicy: 'complete-case', scaling: 'standard', snapshotAt: '2026-10-01T00:00:00.000Z', supportLabel: 'Intervals', variableKeys: ['x', 'y'] },
  configurationSignature: 'signature', correlation: { counts: [[1]], pearson: [[1]], spearman: [[1]] }, groupComparison: [],
  missing: { analysisCount: 1, completeCount: 1, excludedOrImputedCount: 0, inputCount: 1, policy: 'complete-case' },
  pca: { componentCount: 2, cumulativeVarianceRatio: [0.7, 1], eigenvalues: [1.4, 0.6], explainedVarianceRatio: [0.7, 0.3], loadings: [[0.7, 0.7], [0.7, -0.7]] },
  provenance: { algorithmVersion: 'geoeye-multivariate-1.0.0', engine: 'GeoEye MultivariateEngine', randomSeed: 1 }, requestedAt: '2026-10-01T01:00:00.000Z',
  rows: [{ cluster: 1, group: 'All', imputed: false, observationId: 'row-1', scores: [1.2, -0.3], sourceObservationIds: ['source-1'], values: { x: 1, y: 2 } }],
  runId: 'run-1', runNumber: 1, scaling: { centers: [1, 2], method: 'standard', scales: [1, 1] },
} satisfies MultivariateRunResult

describe('multivariate derived store', () => {
  it('saves scores and cluster membership with versioned run provenance', () => {
    const target = storage()
    const document = saveMultivariateDerivedVariables(target, result, { clusters: true, pcaScores: true }, '2026-10-01T02:00:00.000Z')

    expect(document.fields.map((field) => field.key)).toEqual(['multivariate.pc1', 'multivariate.pc2', 'multivariate.cluster_id'])
    expect(document.rows[0]?.values).toEqual({ 'multivariate.cluster_id': 1, 'multivariate.pc1': 1.2, 'multivariate.pc2': -0.3 })
    expect(document.runs[0]).toMatchObject({ algorithmVersion: 'geoeye-multivariate-1.0.0', runId: 'run-1', scaling: 'standard', templateId: 'dataset-1', templateVersion: 1 })
    expect(readMultivariateDerivedDocument(target)).toEqual(document)
  })

  it('overwrites one template version and preserves the prior version on Save As', () => {
    const target = storage()
    const replacement: MultivariateRunResult = {
      ...result,
      runId: 'run-2',
      rows: result.rows.map((row) => ({ ...row, scores: [9.2, -4.1] })),
    }
    saveMultivariateDerivedVariables(target, result, { clusters: true, pcaScores: true, templateId: 'logging-template', templateVersion: 4 })
    let document = saveMultivariateDerivedVariables(target, replacement, { clusters: true, pcaScores: true, templateId: 'logging-template', templateVersion: 4 })

    expect(document.fields.filter((field) => field.templateVersion === 4)).toHaveLength(3)
    expect(document.rows.filter((row) => row.templateVersion === 4)).toHaveLength(1)
    expect(document.rows.find((row) => row.templateVersion === 4)?.values['multivariate.pc1']).toBe(9.2)

    document = saveMultivariateDerivedVariables(target, replacement, { clusters: true, pcaScores: true, templateId: 'logging-template', templateVersion: 5 })
    expect(new Set(document.fields.map((field) => field.templateVersion))).toEqual(new Set([4, 5]))
    expect(new Set(document.rows.map((row) => row.templateVersion))).toEqual(new Set([4, 5]))
  })
})
