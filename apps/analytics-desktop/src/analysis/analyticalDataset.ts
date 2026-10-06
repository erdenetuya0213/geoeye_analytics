import type { EdaObservation } from './eda.js'
import { normalizedHoleIdentifier } from '@geoeye/datapool-client'

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
  if (!validLocation(base) || !validLocation(candidate) || normalizedHoleIdentifier(base.holeId) !== normalizedHoleIdentifier(candidate.holeId)) return false
  const overlap = overlapLength(base, candidate)
  if (overlap > 0) return true
  if (method === 'interval-overlap') return false
  const candidateIsPoint = candidate.depthFrom === candidate.depthTo
  const baseIsPoint = base.depthFrom === base.depthTo
  return (candidateIsPoint && candidate.depthFrom >= base.depthFrom && candidate.depthFrom <= base.depthTo)
    || (baseIsPoint && base.depthFrom >= candidate.depthFrom && base.depthFrom <= candidate.depthTo)
}

function validLocation(row: EdaObservation) {
  return row.locationValid !== false && normalizedHoleIdentifier(row.holeId).length > 0
    && Number.isFinite(row.depthFrom) && Number.isFinite(row.depthTo) && row.depthFrom >= 0 && row.depthTo >= row.depthFrom
}

interface IndexedSupport {
  rows: Array<{ candidate: EdaObservation; order: number }>
  maxEnds: number[]
}

function indexSupports(observations: readonly EdaObservation[]) {
  const holes = new Map<string, IndexedSupport>()
  observations.forEach((candidate, order) => {
    if (!validLocation(candidate)) return
    const holeKey = normalizedHoleIdentifier(candidate.holeId)
    let support = holes.get(holeKey)
    if (support === undefined) { support = { rows: [], maxEnds: [] }; holes.set(holeKey, support) }
    support.rows.push({ candidate, order })
  })
  holes.forEach(support => {
    support.rows.sort((a, b) => a.candidate.depthFrom - b.candidate.depthFrom || a.order - b.order)
    let maxEnd = -Infinity
    support.maxEnds = support.rows.map(({ candidate }) => { maxEnd = Math.max(maxEnd, candidate.depthTo); return maxEnd })
  })
  return holes
}

function bestSupportMatch(
  base: EdaObservation,
  support: IndexedSupport | undefined,
  method: SupportMatchMethod,
) {
  if (support === undefined) return undefined
  let lo = 0, hi = support.rows.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (support.rows[mid]!.candidate.depthFrom <= base.depthTo) lo = mid + 1; else hi = mid }
  const end = lo
  lo = 0; hi = end
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (support.maxEnds[mid]! < base.depthFrom) lo = mid + 1; else hi = mid }
  let best: { candidate: EdaObservation; overlap: number; order: number } | undefined
  for (let i = lo; i < end; i += 1) {
    const { candidate, order } = support.rows[i]!
    if (!supportMatches(base, candidate, method)) continue
    const overlap = overlapLength(base, candidate)
    if (best === undefined || overlap > best.overlap || (overlap === best.overlap && (candidate.depthFrom < best.candidate.depthFrom || (candidate.depthFrom === best.candidate.depthFrom && order < best.order)))) best = { candidate, overlap, order }
  }
  return best
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
  const indexedAttachments = attachments.map(attachment => ({ ...attachment, supports: indexSupports(attachment.observations) }))
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

    indexedAttachments.forEach((attachment) => {
      const match = bestSupportMatch(base, attachment.supports.get(normalizedHoleIdentifier(base.holeId)), attachment.match)
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
