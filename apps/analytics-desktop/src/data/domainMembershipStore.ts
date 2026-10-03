import type { DomainAnalysisRunResult, DomainType } from '../analysis/domainAnalysis.js'
import type { DomainCandidateGroup, DomainCandidateRun } from '../analysis/domainCandidateEngine.js'
import type { StorageLike } from './geotechnicalDerivedStore.js'

export interface SavedDomainMembership {
  analysis_run_id: string
  created_at: string
  domain_id: string
  domain_type: DomainType
  evidence_references: string[]
  membership: Array<{
    member: true
    source_observation_ids: string[]
  }>
  provenance: {
    dataset_id: string
    dataset_snapshot_at?: string
    engine?: string
    primary_source_id: string
    primary_source_label: string
    source_run_id?: string
  }
  source_observation_ids: string[]
  source_type: string
}

export interface SavedDomainClass {
  class_id: string
  class_label: string
  membership: Array<{
    member: true
    observation_id: string
    source_observation_ids: string[]
  }>
  observation_ids: string[]
  source_observation_ids: string[]
}

export interface SavedDomainSet {
  analysis_run_id: string
  classes: SavedDomainClass[]
  created_at: string
  domain_set_id: string
  domain_type: DomainType
  provenance: {
    dataset_id: string
    engine: string
    primary_source_id: string
    primary_source_label: string
    run_number: number
    source_run_id?: string
  }
  scope: {
    id: string
    label: string
    observation_count: number
    source_observation_ids: string[]
  }
  snapshot: string
  source_evidence: string[]
  template_id: string
  template_version: number
}

export interface DomainMembershipDocument {
  domain_sets: SavedDomainSet[]
  domains: SavedDomainMembership[]
  version: 2
}

export const DOMAIN_MEMBERSHIP_STORAGE_KEY = 'geoeye.analytics.domain-membership.v1'
const emptyDocument: DomainMembershipDocument = { domain_sets: [], domains: [], version: 2 }

export function readDomainMembershipDocument(storage?: StorageLike): DomainMembershipDocument {
  if (storage === undefined) return emptyDocument
  try {
    const parsed = JSON.parse(storage.getItem(DOMAIN_MEMBERSHIP_STORAGE_KEY) ?? 'null') as {
      domain_sets?: SavedDomainSet[]
      domains?: SavedDomainMembership[]
      version?: number
    } | null
    if (parsed?.version === 1 && Array.isArray(parsed.domains)) return { domain_sets: [], domains: parsed.domains, version: 2 }
    if (parsed?.version !== 2 || !Array.isArray(parsed.domains) || !Array.isArray(parsed.domain_sets)) return emptyDocument
    return {
      domain_sets: parsed.domain_sets.map((domainSet) => ({
        ...domainSet,
        template_id: typeof domainSet.template_id === 'string' ? domainSet.template_id : domainSet.provenance.dataset_id,
        template_version: typeof domainSet.template_version === 'number' ? domainSet.template_version : 1,
      })),
      domains: parsed.domains,
      version: 2,
    }
  } catch {
    return emptyDocument
  }
}

export function saveDomainMembership(
  storage: StorageLike,
  result: DomainAnalysisRunResult,
  domainId: string,
  createdAt = new Date().toISOString(),
): DomainMembershipDocument {
  const membership: SavedDomainMembership = {
    analysis_run_id: result.runId,
    created_at: createdAt,
    domain_id: domainId,
    domain_type: result.domainType,
    evidence_references: [result.candidateSource.id, ...result.evidenceKeys],
    membership: result.sourceObservationIds.map((id) => ({ member: true, source_observation_ids: [id] })),
    provenance: {
      dataset_id: result.datasetId,
      primary_source_id: result.candidateSource.id,
      primary_source_label: result.candidateSource.label,
      ...(result.candidateSource.multivariateEvidence === undefined ? {} : { source_run_id: result.candidateSource.multivariateEvidence.runId }),
    },
    source_observation_ids: [...result.sourceObservationIds],
    source_type: result.candidateSource.kind,
  }
  const current = readDomainMembershipDocument(storage)
  const next: DomainMembershipDocument = {
    domain_sets: current.domain_sets,
    domains: [membership, ...current.domains.filter((domain) => domain.domain_id !== domainId)],
    version: 2,
  }
  storage.setItem(DOMAIN_MEMBERSHIP_STORAGE_KEY, JSON.stringify(next))
  return next
}

export function saveDomainCandidateMembership(
  storage: StorageLike,
  run: DomainCandidateRun,
  group: DomainCandidateGroup,
  domainId: string,
  createdAt = new Date().toISOString(),
): DomainMembershipDocument {
  const membership: SavedDomainMembership = {
    analysis_run_id: run.runId,
    created_at: createdAt,
    domain_id: domainId,
    domain_type: run.domainType,
    evidence_references: [run.primarySource.id, ...run.evidenceKeys],
    membership: group.sourceObservationIds.map((id) => ({ member: true, source_observation_ids: [id] })),
    provenance: {
      dataset_id: run.datasetId,
      dataset_snapshot_at: run.provenance.datasetSnapshotAt,
      engine: `${run.provenance.engine}@${run.provenance.version}`,
      primary_source_id: run.primarySource.id,
      primary_source_label: run.primarySource.label,
      ...(run.provenance.sourceRunId === undefined ? {} : { source_run_id: run.provenance.sourceRunId }),
    },
    source_observation_ids: [...group.sourceObservationIds],
    source_type: run.primarySource.kind,
  }
  const current = readDomainMembershipDocument(storage)
  const next: DomainMembershipDocument = {
    domain_sets: current.domain_sets,
    domains: [membership, ...current.domains.filter((domain) => domain.domain_id !== domainId)],
    version: 2,
  }
  storage.setItem(DOMAIN_MEMBERSHIP_STORAGE_KEY, JSON.stringify(next))
  return next
}

export function saveDomainCandidateSet(
  storage: StorageLike,
  run: DomainCandidateRun,
  domainSetId: string,
  createdAt = new Date().toISOString(),
  options: { templateId?: string; templateVersion?: number } = {},
): DomainMembershipDocument {
  const templateId = options.templateId ?? run.datasetId
  const templateVersion = options.templateVersion ?? 1
  const classes = run.groups.map((group): SavedDomainClass => ({
    class_id: group.code,
    class_label: group.label,
    membership: group.memberships.map((item) => ({
      member: true,
      observation_id: item.observationId,
      source_observation_ids: [...item.sourceObservationIds],
    })),
    observation_ids: [...group.candidateObservationIds],
    source_observation_ids: [...group.sourceObservationIds],
  }))
  const domainSet: SavedDomainSet = {
    analysis_run_id: run.runId,
    classes,
    created_at: createdAt,
    domain_set_id: domainSetId,
    domain_type: run.domainType,
    provenance: {
      dataset_id: run.datasetId,
      engine: `${run.provenance.engine}@${run.provenance.version}`,
      primary_source_id: run.primarySource.id,
      primary_source_label: run.primarySource.label,
      run_number: run.runNumber,
      ...(run.provenance.sourceRunId === undefined ? {} : { source_run_id: run.provenance.sourceRunId }),
    },
    scope: {
      id: run.scope.id,
      label: run.scope.label,
      observation_count: run.scopeRowCount,
      source_observation_ids: [...run.scopeSourceObservationIds],
    },
    snapshot: run.provenance.datasetSnapshotAt,
    source_evidence: [run.primarySource.id, ...run.evidenceKeys],
    template_id: templateId,
    template_version: templateVersion,
  }
  const current = readDomainMembershipDocument(storage)
  const next: DomainMembershipDocument = {
    domain_sets: [domainSet, ...current.domain_sets.filter((item) => !(
      item.domain_set_id === domainSetId
      && item.template_id === templateId
      && item.template_version === templateVersion
    ))],
    domains: current.domains,
    version: 2,
  }
  storage.setItem(DOMAIN_MEMBERSHIP_STORAGE_KEY, JSON.stringify(next))
  return next
}
