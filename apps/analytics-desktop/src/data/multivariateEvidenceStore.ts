import type { MultivariateRunResult } from '../analysis/multivariateEngine.js'
import type { StorageLike } from './geotechnicalDerivedStore.js'

export interface MultivariateDomainEvidence {
  candidateType: 'statistical-population'
  clusterIds: number[]
  createdAt: string
  datasetId: string
  provenance: MultivariateRunResult['provenance']
  rows: Array<{
    clusterId: number
    depthFrom?: number
    depthTo?: number
    dimensions?: Record<string, string>
    holeId?: string
    observationId: string
    pcaScores: number[]
    sourceObservationIds: string[]
    values: Record<string, number | null>
  }>
  runId: string
  runNumber: number
  variableKeys: string[]
  version: 1
}

export const MULTIVARIATE_DOMAIN_EVIDENCE_KEY = 'geoeye.analytics.domain-evidence.multivariate.v1'

export function readMultivariateDomainEvidence(storage?: StorageLike): MultivariateDomainEvidence | null {
  if (storage === undefined) return null
  try {
    const parsed = JSON.parse(storage.getItem(MULTIVARIATE_DOMAIN_EVIDENCE_KEY) ?? 'null') as Partial<MultivariateDomainEvidence> | null
    if (parsed?.version !== 1 || parsed.candidateType !== 'statistical-population' || !Array.isArray(parsed.rows) || !Array.isArray(parsed.variableKeys)) return null
    return parsed as MultivariateDomainEvidence
  } catch {
    return null
  }
}

export function saveMultivariateDomainEvidence(
  storage: StorageLike,
  result: MultivariateRunResult,
  clusterIds: readonly number[],
  createdAt = new Date().toISOString(),
): MultivariateDomainEvidence {
  const selected = new Set(clusterIds)
  const evidence: MultivariateDomainEvidence = {
    candidateType: 'statistical-population',
    clusterIds: [...selected].sort((left, right) => left - right),
    createdAt,
    datasetId: result.configuration.datasetId,
    provenance: { ...result.provenance },
    rows: result.rows.filter((row) => selected.has(row.cluster)).map((row) => ({
      clusterId: row.cluster,
      ...(row.depthFrom === undefined ? {} : { depthFrom: row.depthFrom }),
      ...(row.depthTo === undefined ? {} : { depthTo: row.depthTo }),
      ...(row.dimensions === undefined ? {} : { dimensions: { ...row.dimensions } }),
      ...(row.holeId === undefined ? {} : { holeId: row.holeId }),
      observationId: row.observationId,
      pcaScores: [...row.scores],
      sourceObservationIds: [...row.sourceObservationIds],
      values: { ...row.values },
    })),
    runId: result.runId,
    runNumber: result.runNumber,
    variableKeys: [...result.configuration.variableKeys],
    version: 1,
  }
  storage.setItem(MULTIVARIATE_DOMAIN_EVIDENCE_KEY, JSON.stringify(evidence))
  return evidence
}
