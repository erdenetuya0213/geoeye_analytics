import { describe, expect, it } from 'vitest'
import { edaIntegratedDataset } from '../data/edaDemo.js'
import { buildDomainAnalysisRequest, runDomainAnalysis, type DomainCandidateSource } from './domainAnalysis.js'

const existingEnvelope: DomainCandidateSource = {
  dimensionKey: 'domain',
  dimensionValue: 'Mineralized envelope',
  id: 'dimension:domain:Mineralized envelope',
  kind: 'dimension',
  label: 'Existing domain → Mineralized envelope',
}

describe('domain analysis', () => {
  it('tests a candidate population without mutating primary observations', () => {
    const original = JSON.stringify(edaIntegratedDataset.observations)
    const request = buildDomainAnalysisRequest(
      edaIntegratedDataset,
      'estimation',
      ['lithology', 'alteration', 'assay.au', 'geotech.rqd'],
      existingEnvelope,
      5,
      new Date('2026-10-01T02:00:00.000Z'),
    )
    const result = runDomainAnalysis(request)

    expect(result.runNumber).toBe(5)
    expect(result.rowCount).toBeGreaterThan(0)
    expect(result.sourceObservationIds.length).toBeGreaterThan(result.rowCount)
    expect(result.spatial.candidateHoleCount).toBeGreaterThan(0)
    expect(result.contacts.find((contact) => contact.variableKey === 'assay.au')?.boundaryCount).toBeGreaterThan(0)
    expect(result.population.find((population) => population.variableKey === 'assay.au')?.candidate.count).toBeGreaterThan(0)
    expect(JSON.stringify(edaIntegratedDataset.observations)).toBe(original)
  })

  it('accepts threshold candidates as evidence rather than domain assignments', () => {
    const source: DomainCandidateSource = {
      id: 'threshold:geotech.rqd:lte:50',
      kind: 'threshold',
      label: 'Geotechnical → RQD ≤ 50%',
      operator: 'lte',
      threshold: 50,
      variableKey: 'geotech.rqd',
    }
    const result = runDomainAnalysis(buildDomainAnalysisRequest(edaIntegratedDataset, 'geotechnical', ['geotech.rqd', 'geotech.ucs'], source, 1))

    expect(result.rowCount).toBeGreaterThan(0)
    expect(result.domainType).toBe('geotechnical')
    expect(result.candidateSource.kind).toBe('threshold')
  })
})
