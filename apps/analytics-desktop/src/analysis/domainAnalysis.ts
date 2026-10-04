import type { EdaObservation, SummaryStatistics } from './eda.js'
import { summarizeValues } from './eda.js'
import type { EdaDataset } from '../data/edaTypes.js'
import type { MultivariateDomainEvidence } from '../data/multivariateEvidenceStore.js'

export type DomainType = 'geological' | 'estimation' | 'structural' | 'geotechnical' | 'alteration-spectral'
export interface DomainCandidateSource {
  dimensionKey?: string
  dimensionValue?: string
  id: string
  kind: 'multivariate' | 'dimension' | 'threshold' | 'membership'
  label: string
  multivariateEvidence?: MultivariateDomainEvidence
  observationIds?: string[]
  operator?: 'gte' | 'lte'
  threshold?: number
  variableKey?: string
}

export interface DomainAnalysisRequest {
  candidateSource: DomainCandidateSource
  dataset: EdaDataset
  domainType: DomainType
  evidenceKeys: string[]
  requestedAt: string
  runId: string
  runNumber: number
}

export interface DomainPopulationComparison {
  background: SummaryStatistics
  candidate: SummaryStatistics
  difference: number | null
  label: string
  unit: string
  variableKey: string
}

export interface DomainContactSummary {
  backgroundMean: number | null
  boundaryCount: number
  candidateMean: number | null
  difference: number | null
  profile: Array<{ count: number; distance: number; mean: number | null; sourceObservationIds: string[] }>
  style: 'hard' | 'soft' | 'insufficient'
  variableKey: string
}

export interface DomainAnalysisRunResult {
  candidateObservationIds: string[]
  candidateSource: DomainCandidateSource
  completedAt: string
  contactStatus: 'complete' | 'limited' | 'not-tested'
  contacts: DomainContactSummary[]
  datasetId: string
  domainType: DomainType
  dominantAlteration: { count: number; label: string; share: number }
  dominantLithology: { count: number; label: string; share: number }
  evidenceKeys: string[]
  population: DomainPopulationComparison[]
  rowCount: number
  runId: string
  runNumber: number
  sourceObservationIds: string[]
  spatial: {
    candidateHoleCount: number
    continuity: number
    contiguousRuns: number
    totalHoleCount: number
  }
}

function sourceIds(observation: EdaObservation) {
  return observation.sourceObservationIds ?? [observation.sourceObservationId]
}

function observationMatchesSource(observation: EdaObservation, source: DomainCandidateSource) {
  if (source.kind === 'membership') return new Set(source.observationIds ?? []).has(observation.id)
  if (source.kind === 'dimension') return observation.dimensions[source.dimensionKey ?? ''] === source.dimensionValue
  if (source.kind === 'threshold') {
    const value = observation.values[source.variableKey ?? '']
    if (typeof value !== 'number' || !Number.isFinite(value) || source.threshold === undefined) return false
    return source.operator === 'lte' ? value <= source.threshold : value >= source.threshold
  }
  const evidence = source.multivariateEvidence
  if (evidence === undefined) return false
  const observationIds = new Set(evidence.rows.map((row) => row.observationId))
  const evidenceSourceIds = new Set(evidence.rows.flatMap((row) => row.sourceObservationIds))
  return observationIds.has(observation.id) || sourceIds(observation).some((id) => evidenceSourceIds.has(id))
}

function dominant(observations: readonly EdaObservation[], value: (observation: EdaObservation) => string | undefined) {
  const counts = new Map<string, number>()
  observations.forEach((observation) => {
    const label = value(observation)
    if (label !== undefined && label.length > 0) counts.set(label, (counts.get(label) ?? 0) + 1)
  })
  const winner = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]
  return winner === undefined
    ? { count: 0, label: 'Unassigned', share: 0 }
    : { count: winner[1], label: winner[0], share: observations.length === 0 ? 0 : winner[1] / observations.length }
}

function observationsByHole(observations: readonly EdaObservation[]) {
  const grouped = new Map<string, EdaObservation[]>()
  observations.forEach((observation) => {
    const rows = grouped.get(observation.holeId) ?? []
    rows.push(observation)
    grouped.set(observation.holeId, rows)
  })
  grouped.forEach((rows) => rows.sort((left, right) => left.depthFrom - right.depthFrom))
  return grouped
}

function buildSpatialSummary(observations: readonly EdaObservation[], candidateIds: ReadonlySet<string>) {
  const holes = observationsByHole(observations)
  let adjacentCandidatePairs = 0
  let candidatePairs = 0
  let contiguousRuns = 0
  let candidateHoleCount = 0
  holes.forEach((rows) => {
    let previousCandidate = false
    let hasCandidate = false
    rows.forEach((row, index) => {
      const candidate = candidateIds.has(row.id)
      if (candidate) {
        hasCandidate = true
        if (!previousCandidate) contiguousRuns += 1
        if (index > 0) {
          candidatePairs += 1
          if (previousCandidate) adjacentCandidatePairs += 1
        }
      }
      previousCandidate = candidate
    })
    if (hasCandidate) candidateHoleCount += 1
  })
  const continuity = candidatePairs === 0 ? 0 : adjacentCandidatePairs / candidatePairs
  return { candidateHoleCount, continuity, contiguousRuns, totalHoleCount: holes.size }
}

interface ContactPair {
  background: EdaObservation
  candidate: EdaObservation
  contactDepth: number
  holeId: string
}

function contactPairs(observations: readonly EdaObservation[], candidateIds: ReadonlySet<string>) {
  const pairs: ContactPair[] = []
  observationsByHole(observations).forEach((rows, holeId) => {
    for (let index = 1; index < rows.length; index += 1) {
      const left = rows[index - 1]
      const right = rows[index]
      if (left === undefined || right === undefined) continue
      const leftCandidate = candidateIds.has(left.id)
      const rightCandidate = candidateIds.has(right.id)
      if (leftCandidate === rightCandidate) continue
      pairs.push({
        background: leftCandidate ? right : left,
        candidate: leftCandidate ? left : right,
        contactDepth: (left.depthTo + right.depthFrom) / 2,
        holeId,
      })
    }
  })
  return pairs
}

function finiteValue(observation: EdaObservation, key: string) {
  const value = observation.values[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildContacts(
  observations: readonly EdaObservation[],
  candidateIds: ReadonlySet<string>,
  variableKeys: readonly string[],
): DomainContactSummary[] {
  const boundaries = contactPairs(observations, candidateIds)
  const holes = observationsByHole(observations)
  const distances = [-12, -8, -4, 4, 8, 12]
  return variableKeys.map((variableKey) => {
    const candidateValues = boundaries.flatMap((pair) => finiteValue(pair.candidate, variableKey) ?? [])
    const backgroundValues = boundaries.flatMap((pair) => finiteValue(pair.background, variableKey) ?? [])
    const candidateMean = candidateValues.length === 0 ? null : candidateValues.reduce((sum, value) => sum + value, 0) / candidateValues.length
    const backgroundMean = backgroundValues.length === 0 ? null : backgroundValues.reduce((sum, value) => sum + value, 0) / backgroundValues.length
    const difference = candidateMean === null || backgroundMean === null ? null : candidateMean - backgroundMean
    const combined = [...candidateValues, ...backgroundValues]
    const combinedStats = summarizeValues(combined)
    const standardizedDifference = difference === null || combinedStats.standardDeviation === null || combinedStats.standardDeviation === 0
      ? 0
      : Math.abs(difference) / combinedStats.standardDeviation
    const style = boundaries.length < 3 || candidateValues.length < 3 || backgroundValues.length < 3
      ? 'insufficient'
      : standardizedDifference >= 0.8 ? 'hard' : 'soft'
    const profile = distances.map((distance) => {
      const values: number[] = []
      const ids: string[] = []
      boundaries.forEach((boundary) => {
        const rows = holes.get(boundary.holeId) ?? []
        const target = boundary.contactDepth + distance
        const row = rows.find((item) => target >= item.depthFrom && target < item.depthTo)
        if (row === undefined) return
        const value = finiteValue(row, variableKey)
        if (value === null) return
        values.push(value)
        ids.push(...sourceIds(row))
      })
      return {
        count: values.length,
        distance,
        mean: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
        sourceObservationIds: [...new Set(ids)],
      }
    })
    return { backgroundMean, boundaryCount: boundaries.length, candidateMean, difference, profile, style, variableKey }
  })
}

export function buildDomainAnalysisRequest(
  dataset: EdaDataset,
  domainType: DomainType,
  evidenceKeys: readonly string[],
  candidateSource: DomainCandidateSource,
  runNumber: number,
  now = new Date(),
): DomainAnalysisRequest {
  return {
    candidateSource,
    dataset,
    domainType,
    evidenceKeys: [...evidenceKeys],
    requestedAt: now.toISOString(),
    runId: `domain-run-${now.getTime()}-${runNumber}`,
    runNumber,
  }
}

export function runDomainAnalysis(request: DomainAnalysisRequest, completedAt = request.requestedAt): DomainAnalysisRunResult {
  const candidate = request.dataset.observations.filter((observation) => observationMatchesSource(observation, request.candidateSource))
  const candidateIds = new Set(candidate.map((observation) => observation.id))
  const background = request.dataset.observations.filter((observation) => !candidateIds.has(observation.id))
  const variableKeys = request.evidenceKeys.filter((key) => request.dataset.variables.some((variable) => variable.key === key))
  const population = variableKeys.map((variableKey): DomainPopulationComparison => {
    const variable = request.dataset.variables.find((item) => item.key === variableKey)
    const candidateStats = summarizeValues(candidate.flatMap((observation) => finiteValue(observation, variableKey) ?? []), candidate.length)
    const backgroundStats = summarizeValues(background.flatMap((observation) => finiteValue(observation, variableKey) ?? []), background.length)
    return {
      background: backgroundStats,
      candidate: candidateStats,
      difference: candidateStats.mean === null || backgroundStats.mean === null ? null : candidateStats.mean - backgroundStats.mean,
      label: variable?.shortLabel ?? variableKey,
      unit: variable?.unit ?? '',
      variableKey,
    }
  })
  const contacts = buildContacts(request.dataset.observations, candidateIds, variableKeys)
  const boundaryCount = contacts[0]?.boundaryCount ?? 0
  return {
    candidateObservationIds: candidate.map((observation) => observation.id),
    candidateSource: request.candidateSource,
    completedAt,
    contactStatus: boundaryCount >= 3 ? 'complete' : boundaryCount > 0 ? 'limited' : 'not-tested',
    contacts,
    datasetId: request.dataset.id,
    domainType: request.domainType,
    dominantAlteration: dominant(candidate, (observation) => observation.dimensions.alteration),
    dominantLithology: dominant(candidate, (observation) => observation.lithology),
    evidenceKeys: [...request.evidenceKeys],
    population,
    rowCount: candidate.length,
    runId: request.runId,
    runNumber: request.runNumber,
    sourceObservationIds: [...new Set(candidate.flatMap(sourceIds))],
    spatial: buildSpatialSummary(request.dataset.observations, candidateIds),
  }
}
