import type { EdaObservation, SummaryStatistics } from './eda.js'
import { summarizeValues } from './eda.js'
import type { DomainType } from './domainAnalysis.js'
import type { EdaDataset } from '../data/edaDemo.js'
import type { MultivariateDomainEvidence } from '../data/multivariateEvidenceStore.js'

export type DomainPrimarySourceKind = 'numeric-ranges' | 'threshold' | 'dimension' | 'multivariate'

export interface DomainCandidateRange {
  code: string
  id: string
  label: string
  maximum: number
  minimum: number
}

export interface DomainPrimarySource {
  dimensionKey?: string
  dimensionValue?: string
  id: string
  kind: DomainPrimarySourceKind
  label: string
  operator?: 'gte' | 'lte'
  threshold?: number
  variableKey?: string
}

export interface DomainCandidateScope {
  id: 'dataset' | 'linked-selection'
  label: string
  sourceObservationIds?: string[]
}

export interface DomainSupportingSummary {
  label: string
  statistics: SummaryStatistics
  unit: string
  variableKey: string
}

export interface DomainCandidateGroup {
  candidateObservationIds: string[]
  code: string
  dominantAlteration: { count: number; label: string; share: number }
  dominantLithology: { count: number; label: string; share: number }
  id: string
  label: string
  memberships: Array<{ observationId: string; sourceObservationIds: string[] }>
  primaryStatistics: SummaryStatistics | null
  rowCount: number
  shareOfScope: number
  sourceObservationIds: string[]
  supportingSummaries: DomainSupportingSummary[]
}

export interface DomainCandidateRun {
  completedAt: string
  datasetId: string
  datasetName: string
  domainType: DomainType
  evidenceKeys: string[]
  groups: DomainCandidateGroup[]
  primarySource: DomainPrimarySource
  provenance: {
    datasetSnapshotAt: string
    engine: 'geoeye-domain-candidates'
    sourceRunId?: string
    sourceRunNumber?: number
    version: '1.0.0'
  }
  runId: string
  runNumber: number
  scope: DomainCandidateScope
  scopeRowCount: number
  scopeSourceObservationIds: string[]
}

export interface GenerateDomainCandidatesRequest {
  dataset: EdaDataset
  domainType: DomainType
  evidenceKeys: readonly string[]
  multivariateEvidence?: MultivariateDomainEvidence
  primarySource: DomainPrimarySource
  ranges: readonly DomainCandidateRange[]
  requestedAt: string
  runId: string
  runNumber: number
  scope: DomainCandidateScope
}

function sourceIds(observation: EdaObservation) {
  return observation.sourceObservationIds ?? [observation.sourceObservationId]
}

function finiteValue(observation: EdaObservation, key: string) {
  const value = observation.values[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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

function summaries(dataset: EdaDataset, observations: readonly EdaObservation[], evidenceKeys: readonly string[]) {
  return evidenceKeys.flatMap((variableKey): DomainSupportingSummary[] => {
    const definition = dataset.variables.find((variable) => variable.key === variableKey)
    if (definition === undefined) return []
    const values = observations.flatMap((observation) => finiteValue(observation, variableKey) ?? [])
    return [{
      label: definition.shortLabel,
      statistics: summarizeValues(values, observations.length),
      unit: definition.unit,
      variableKey,
    }]
  })
}

function buildGroup(
  request: GenerateDomainCandidatesRequest,
  code: string,
  id: string,
  label: string,
  observations: readonly EdaObservation[],
  scopeRowCount: number,
): DomainCandidateGroup {
  const primaryKey = request.primarySource.variableKey
  const primaryValues = primaryKey === undefined ? [] : observations.flatMap((observation) => finiteValue(observation, primaryKey) ?? [])
  return {
    candidateObservationIds: observations.map((observation) => observation.id),
    code,
    dominantAlteration: dominant(observations, (observation) => observation.dimensions.alteration),
    dominantLithology: dominant(observations, (observation) => observation.lithology),
    id,
    label,
    memberships: observations.map((observation) => ({ observationId: observation.id, sourceObservationIds: [...sourceIds(observation)] })),
    primaryStatistics: primaryKey === undefined ? null : summarizeValues(primaryValues, observations.length),
    rowCount: observations.length,
    shareOfScope: scopeRowCount === 0 ? 0 : observations.length / scopeRowCount,
    sourceObservationIds: [...new Set(observations.flatMap(sourceIds))],
    supportingSummaries: summaries(request.dataset, observations, request.evidenceKeys.filter((key) => key !== primaryKey)),
  }
}

function multivariateGroups(
  request: GenerateDomainCandidatesRequest,
  scopeObservations: readonly EdaObservation[],
) {
  const evidence = request.multivariateEvidence
  if (evidence === undefined) return []
  const prefix = domainPrefix(request.domainType)
  return evidence.clusterIds.map((clusterId, index) => {
    const rows = evidence.rows.filter((row) => row.clusterId === clusterId)
    const observationIds = new Set(rows.map((row) => row.observationId))
    const linkedIds = new Set(rows.flatMap((row) => row.sourceObservationIds))
    const observations = scopeObservations.filter((observation) => observationIds.has(observation.id) || sourceIds(observation).some((id) => linkedIds.has(id)))
    return buildGroup(request, `${prefix}-${String(index + 1).padStart(2, '0')}`, `cluster-${clusterId}`, `Cluster C${clusterId}`, observations, scopeObservations.length)
  })
}

function observationsInScope(request: GenerateDomainCandidatesRequest) {
  if (request.scope.id === 'dataset' || request.scope.sourceObservationIds === undefined) return request.dataset.observations
  const requestedIds = new Set(request.scope.sourceObservationIds)
  return request.dataset.observations.filter((observation) => requestedIds.has(observation.id) || sourceIds(observation).some((id) => requestedIds.has(id)))
}

export function domainPrefix(domainType: DomainType) {
  if (domainType === 'geotechnical') return 'GT'
  if (domainType === 'estimation') return 'ES'
  if (domainType === 'geological') return 'GL'
  if (domainType === 'structural') return 'ST'
  return 'AS'
}

export function defaultRmrRanges(prefix = 'GT'): DomainCandidateRange[] {
  return [
    { code: `${prefix}-01`, id: 'rmr-81-100', label: 'RMR 81–100', maximum: 100, minimum: 81 },
    { code: `${prefix}-02`, id: 'rmr-61-80', label: 'RMR 61–80', maximum: 80, minimum: 61 },
    { code: `${prefix}-03`, id: 'rmr-41-60', label: 'RMR 41–60', maximum: 60, minimum: 41 },
    { code: `${prefix}-04`, id: 'rmr-21-40', label: 'RMR 21–40', maximum: 40, minimum: 21 },
    { code: `${prefix}-05`, id: 'rmr-0-20', label: 'RMR 0–20', maximum: 20, minimum: 0 },
  ]
}

export function defaultNumericRanges(variableKey: string, prefix: string): DomainCandidateRange[] {
  if (variableKey === 'geotech.rmr76') return defaultRmrRanges(prefix)
  if (variableKey === 'geotech.rqd') return [
    { code: `${prefix}-01`, id: 'rqd-75-100', label: 'RQD 75–100', maximum: 100, minimum: 75 },
    { code: `${prefix}-02`, id: 'rqd-50-74', label: 'RQD 50–74.9', maximum: 74.9, minimum: 50 },
    { code: `${prefix}-03`, id: 'rqd-25-49', label: 'RQD 25–49.9', maximum: 49.9, minimum: 25 },
    { code: `${prefix}-04`, id: 'rqd-0-24', label: 'RQD 0–24.9', maximum: 24.9, minimum: 0 },
  ]
  return [
    { code: `${prefix}-01`, id: 'range-high', label: 'High range', maximum: 100, minimum: 50 },
    { code: `${prefix}-02`, id: 'range-low', label: 'Low range', maximum: 49.999, minimum: 0 },
  ]
}

export function buildGenerateDomainCandidatesRequest(
  dataset: EdaDataset,
  domainType: DomainType,
  primarySource: DomainPrimarySource,
  evidenceKeys: readonly string[],
  ranges: readonly DomainCandidateRange[],
  runNumber: number,
  scope: DomainCandidateScope,
  multivariateEvidence?: MultivariateDomainEvidence,
  now = new Date(),
): GenerateDomainCandidatesRequest {
  return {
    dataset,
    domainType,
    evidenceKeys: [...evidenceKeys],
    ...(multivariateEvidence === undefined ? {} : { multivariateEvidence }),
    primarySource,
    ranges: ranges.map((range) => ({ ...range })),
    requestedAt: now.toISOString(),
    runId: `domain-candidates-${now.getTime()}-${runNumber}`,
    runNumber,
    scope: scope.sourceObservationIds === undefined
      ? { id: scope.id, label: scope.label }
      : { id: scope.id, label: scope.label, sourceObservationIds: [...scope.sourceObservationIds] },
  }
}

export function generateDomainCandidates(request: GenerateDomainCandidatesRequest): DomainCandidateRun {
  const prefix = domainPrefix(request.domainType)
  const scopeObservations = observationsInScope(request)
  let groups: DomainCandidateGroup[]

  if (request.primarySource.kind === 'multivariate') {
    groups = multivariateGroups(request, scopeObservations)
  } else if (request.primarySource.kind === 'numeric-ranges') {
    const key = request.primarySource.variableKey ?? ''
    groups = request.ranges.map((range) => buildGroup(
      request,
      range.code,
      range.id,
      range.label,
      scopeObservations.filter((observation) => {
        const value = finiteValue(observation, key)
        return value !== null && value >= range.minimum && value <= range.maximum
      }),
      scopeObservations.length,
    ))
  } else if (request.primarySource.kind === 'threshold') {
    const key = request.primarySource.variableKey ?? ''
    const threshold = request.primarySource.threshold ?? 0
    const operator = request.primarySource.operator ?? 'gte'
    const observations = scopeObservations.filter((observation) => {
      const value = finiteValue(observation, key)
      return value !== null && (operator === 'gte' ? value >= threshold : value <= threshold)
    })
    groups = [buildGroup(request, `${prefix}-01`, 'threshold', request.primarySource.label, observations, scopeObservations.length)]
  } else {
    const key = request.primarySource.dimensionKey ?? ''
    const requestedValue = request.primarySource.dimensionValue
    const values = requestedValue === undefined
      ? [...new Set(request.dataset.observations.flatMap((observation) => observation.dimensions[key] ?? []))]
      : [requestedValue]
    groups = values.map((value, index) => buildGroup(
      request,
      `${prefix}-${String(index + 1).padStart(2, '0')}`,
      `dimension-${key}-${value}`,
      value,
      scopeObservations.filter((observation) => observation.dimensions[key] === value),
      scopeObservations.length,
    ))
  }

  return {
    completedAt: request.requestedAt,
    datasetId: request.dataset.id,
    datasetName: request.dataset.name,
    domainType: request.domainType,
    evidenceKeys: [...request.evidenceKeys],
    groups,
    primarySource: { ...request.primarySource },
    provenance: {
      datasetSnapshotAt: request.dataset.snapshotAt,
      engine: 'geoeye-domain-candidates',
      ...(request.multivariateEvidence === undefined ? {} : {
        sourceRunId: request.multivariateEvidence.runId,
        sourceRunNumber: request.multivariateEvidence.runNumber,
      }),
      version: '1.0.0',
    },
    runId: request.runId,
    runNumber: request.runNumber,
    scope: request.scope.sourceObservationIds === undefined
      ? { id: request.scope.id, label: request.scope.label }
      : { id: request.scope.id, label: request.scope.label, sourceObservationIds: [...request.scope.sourceObservationIds] },
    scopeRowCount: scopeObservations.length,
    scopeSourceObservationIds: [...new Set(scopeObservations.flatMap(sourceIds))],
  }
}
