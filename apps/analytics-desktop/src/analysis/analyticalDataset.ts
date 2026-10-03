import type { EdaObservation } from './eda.js'

export type SupportMatchMethod = 'interval-overlap' | 'point-or-interval' | 'registered-depth'

export interface AnalyticalAttachment {
  datasetId: string
  dimensions?: readonly string[]
  match: SupportMatchMethod
  observations: readonly EdaObservation[]
}

export interface AnalyticalLineageEntry {
  datasetId: string
  match: 'base-support' | SupportMatchMethod
  overlap: number | null
  sourceObservationId: string
}

export interface AnalyticalObservation extends EdaObservation {
  analyticalLineage: AnalyticalLineageEntry[]
  sourceObservationIds: string[]
}

function overlapLength(left: EdaObservation, right: EdaObservation) {
  return Math.max(0, Math.min(left.depthTo, right.depthTo) - Math.max(left.depthFrom, right.depthFrom))
}

function supportMatches(base: EdaObservation, candidate: EdaObservation, method: SupportMatchMethod) {
  if (base.holeId !== candidate.holeId) return false
  const overlap = overlapLength(base, candidate)
  if (overlap > 0) return true
  if (method === 'interval-overlap') return false
  const candidateIsPoint = candidate.depthFrom === candidate.depthTo
  return candidateIsPoint && candidate.depthFrom >= base.depthFrom && candidate.depthFrom <= base.depthTo
}

function bestSupportMatch(
  base: EdaObservation,
  observations: readonly EdaObservation[],
  method: SupportMatchMethod,
) {
  return observations
    .filter((candidate) => supportMatches(base, candidate, method))
    .map((candidate) => ({ candidate, overlap: overlapLength(base, candidate) }))
    .sort((left, right) => right.overlap - left.overlap || left.candidate.depthFrom - right.candidate.depthFrom)[0]
}

/**
 * Creates a query-time analytical view on one canonical support. Source rows
 * remain independent; matched values and lineage are attached in memory.
 */
export function buildAnalyticalObservations(
  baseDatasetId: string,
  baseObservations: readonly EdaObservation[],
  attachments: readonly AnalyticalAttachment[],
): AnalyticalObservation[] {
  return baseObservations.map((base) => {
    const sourceObservationIds = [...new Set(base.sourceObservationIds ?? [base.sourceObservationId])]
    const analyticalLineage: AnalyticalLineageEntry[] = sourceObservationIds.map((sourceObservationId) => ({
      datasetId: baseDatasetId,
      match: 'base-support',
      overlap: null,
      sourceObservationId,
    }))
    const dimensions = { ...base.dimensions }
    const values = { ...base.values }

    attachments.forEach((attachment) => {
      const match = bestSupportMatch(base, attachment.observations, attachment.match)
      if (match === undefined) return
      Object.assign(values, match.candidate.values)
      attachment.dimensions?.forEach((key) => {
        const value = match.candidate.dimensions[key]
        if (value !== undefined) dimensions[key] = value
      })
      const matchedSourceIds = match.candidate.sourceObservationIds ?? [match.candidate.sourceObservationId]
      matchedSourceIds.forEach((sourceObservationId) => {
        if (!sourceObservationIds.includes(sourceObservationId)) sourceObservationIds.push(sourceObservationId)
        analyticalLineage.push({
          datasetId: attachment.datasetId,
          match: attachment.match,
          overlap: match.overlap,
          sourceObservationId,
        })
      })
    })

    return {
      ...base,
      analyticalLineage,
      dimensions,
      id: `analytical-${base.id}`,
      sourceObservationIds,
      values,
    }
  })
}
