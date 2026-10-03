import { describe, expect, it } from 'vitest'
import { edaIntegratedDataset } from './edaDemo.js'
import { buildDomainAnalysisRequest, runDomainAnalysis, type DomainCandidateSource } from '../analysis/domainAnalysis.js'
import { buildGenerateDomainCandidatesRequest, defaultNumericRanges, generateDomainCandidates } from '../analysis/domainCandidateEngine.js'
import { readDomainMembershipDocument, saveDomainCandidateMembership, saveDomainCandidateSet, saveDomainMembership } from './domainMembershipStore.js'

function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
}

const source: DomainCandidateSource = {
  dimensionKey: 'domain', dimensionValue: 'Mineralized envelope', id: 'existing-envelope', kind: 'dimension', label: 'Existing envelope',
}

describe('domain membership store', () => {
  it('persists interpreted membership and allows parallel domain systems', () => {
    const target = storage()
    const estimation = runDomainAnalysis(buildDomainAnalysisRequest(edaIntegratedDataset, 'estimation', ['assay.au'], source, 1))
    const geotechnical = runDomainAnalysis(buildDomainAnalysisRequest(edaIntegratedDataset, 'geotechnical', ['geotech.rqd'], source, 2))
    saveDomainMembership(target, estimation, 'estimation_domain.or-01', '2026-10-01T03:00:00.000Z')
    const document = saveDomainMembership(target, geotechnical, 'geotech_domain.or-01', '2026-10-01T03:01:00.000Z')

    expect(document.domains).toHaveLength(2)
    expect(document.domains.map((domain) => domain.domain_type)).toEqual(['geotechnical', 'estimation'])
    expect(document.domains[0]).toMatchObject({ analysis_run_id: geotechnical.runId, domain_id: 'geotech_domain.or-01' })
    expect(document.domains[0]?.provenance.primary_source_id).toBe(source.id)
    expect(document.domains[0]?.source_observation_ids.length).toBeGreaterThan(0)
    expect(readDomainMembershipDocument(target)).toEqual(document)
  })

  it('saves candidate membership with source and run provenance', () => {
    const target = storage()
    const primarySource = {
      id: 'geotech.rqd',
      kind: 'numeric-ranges' as const,
      label: 'RQD',
      variableKey: 'geotech.rqd',
    }
    const run = generateDomainCandidates(buildGenerateDomainCandidatesRequest(
      edaIntegratedDataset,
      'geotechnical',
      primarySource,
      ['geotech.ucs', 'lithology'],
      defaultNumericRanges('geotech.rqd', 'GT'),
      1,
      { id: 'dataset', label: 'Entire snapshot' },
      undefined,
      new Date('2026-10-01T03:02:00.000Z'),
    ))
    const group = run.groups.find((candidate) => candidate.rowCount > 0)
    expect(group).toBeDefined()
    if (group === undefined) return

    const document = saveDomainCandidateMembership(target, run, group, 'geotech_domain.gt-01', '2026-10-01T03:03:00.000Z')

    expect(document.domains[0]).toMatchObject({
      analysis_run_id: run.runId,
      domain_id: 'geotech_domain.gt-01',
      evidence_references: ['geotech.rqd', 'geotech.ucs', 'lithology'],
      provenance: {
        dataset_id: edaIntegratedDataset.id,
        engine: 'geoeye-domain-candidates@1.0.0',
        primary_source_id: 'geotech.rqd',
      },
    })
    expect(document.domains[0]?.source_observation_ids).toEqual(group.sourceObservationIds)
  })

  it('saves the complete candidate scheme as one domain set', () => {
    const target = storage()
    const run = generateDomainCandidates(buildGenerateDomainCandidatesRequest(
      edaIntegratedDataset,
      'geotechnical',
      { id: 'geotech.rqd', kind: 'numeric-ranges', label: 'RQD', variableKey: 'geotech.rqd' },
      ['geotech.ucs', 'lithology'],
      defaultNumericRanges('geotech.rqd', 'GT'),
      2,
      { id: 'dataset', label: 'Entire snapshot' },
      undefined,
      new Date('2026-10-01T03:04:00.000Z'),
    ))

    const document = saveDomainCandidateSet(target, run, 'GT-RQD-01', '2026-10-01T03:05:00.000Z')

    expect(document.domain_sets).toHaveLength(1)
    expect(document.domain_sets[0]).toMatchObject({
      analysis_run_id: run.runId,
      domain_set_id: 'GT-RQD-01',
      domain_type: 'geotechnical',
      snapshot: edaIntegratedDataset.snapshotAt,
      source_evidence: ['geotech.rqd', 'geotech.ucs', 'lithology'],
      template_id: edaIntegratedDataset.id,
      template_version: 1,
    })
    expect(document.domain_sets[0]?.classes.map((item) => item.class_id)).toEqual(run.groups.map((group) => group.code))
    expect(document.domain_sets[0]?.classes[0]?.membership[0]).toHaveProperty('observation_id')
    expect(document.domain_sets[0]?.scope.observation_count).toBe(edaIntegratedDataset.observations.length)
  })

  it('overwrites the active template version and retains the previous version on Save As', () => {
    const target = storage()
    const run = generateDomainCandidates(buildGenerateDomainCandidatesRequest(
      edaIntegratedDataset,
      'geotechnical',
      { id: 'geotech.rqd', kind: 'numeric-ranges', label: 'RQD', variableKey: 'geotech.rqd' },
      ['lithology'],
      defaultNumericRanges('geotech.rqd', 'GT'),
      3,
      { id: 'dataset', label: 'Entire snapshot' },
    ))
    saveDomainCandidateSet(target, run, 'GT-RQD-01', '2026-10-01T04:00:00.000Z', { templateVersion: 4 })
    let document = saveDomainCandidateSet(target, run, 'GT-RQD-01', '2026-10-01T04:01:00.000Z', { templateVersion: 4 })

    expect(document.domain_sets).toHaveLength(1)
    expect(document.domain_sets[0]?.created_at).toBe('2026-10-01T04:01:00.000Z')

    document = saveDomainCandidateSet(target, run, 'GT-RQD-01', '2026-10-01T04:02:00.000Z', { templateVersion: 5 })
    expect(document.domain_sets).toHaveLength(2)
    expect(document.domain_sets.map((item) => item.template_version)).toEqual([5, 4])
  })
})
