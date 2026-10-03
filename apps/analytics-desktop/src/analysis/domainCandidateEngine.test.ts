import { describe, expect, it } from 'vitest'
import { edaIntegratedDataset } from '../data/edaDemo.js'
import { buildGenerateDomainCandidatesRequest, defaultRmrRanges, generateDomainCandidates } from './domainCandidateEngine.js'

describe('domain candidate generation', () => {
  it('creates mutually interpretable RMR groups without changing source observations', () => {
    const dataset = {
      ...edaIntegratedDataset,
      observations: edaIntegratedDataset.observations.map((observation, index) => ({
        ...observation,
        values: { ...observation.values, 'geotech.rmr76': 15 + index % 80 },
      })),
      variables: [...edaIntegratedDataset.variables, { decimals: 0, key: 'geotech.rmr76', label: 'Rock Mass Rating 1976', shortLabel: 'RMR76', unit: 'score' }],
    }
    const before = JSON.stringify(dataset.observations)
    const request = buildGenerateDomainCandidatesRequest(
      dataset,
      'geotechnical',
      { id: 'variable:geotech.rmr76', kind: 'numeric-ranges', label: 'RMR76', variableKey: 'geotech.rmr76' },
      ['geotech.rqd', 'geotech.ucs', 'lithology'],
      defaultRmrRanges(),
      4,
      { id: 'dataset', label: 'Entire snapshot' },
      undefined,
      new Date('2026-10-01T05:00:00.000Z'),
    )
    const result = generateDomainCandidates(request)

    expect(result.groups).toHaveLength(5)
    expect(result.groups[1]).toMatchObject({ code: 'GT-02', label: 'RMR 61–80' })
    expect(result.groups.reduce((sum, group) => sum + group.rowCount, 0)).toBe(dataset.observations.length)
    expect(result.groups.reduce((sum, group) => sum + group.shareOfScope, 0)).toBeCloseTo(1)
    expect(result.scopeRowCount).toBe(dataset.observations.length)
    expect(result.groups.some((group) => (group.primaryStatistics?.median ?? 0) > 0)).toBe(true)
    expect(JSON.stringify(dataset.observations)).toBe(before)
  })

  it('calculates class percentages against the selected scope', () => {
    const selected = edaIntegratedDataset.observations.slice(0, 20)
    const request = buildGenerateDomainCandidatesRequest(
      edaIntegratedDataset,
      'geotechnical',
      { id: 'variable:geotech.rqd', kind: 'numeric-ranges', label: 'RQD', variableKey: 'geotech.rqd' },
      ['geotech.ucs'],
      [{ code: 'GT-01', id: 'all-rqd', label: 'All RQD', maximum: 100, minimum: 0 }],
      5,
      { id: 'linked-selection', label: 'Linked selection', sourceObservationIds: selected.flatMap((observation) => observation.sourceObservationIds ?? [observation.sourceObservationId]) },
      undefined,
      new Date('2026-10-01T05:01:00.000Z'),
    )

    const result = generateDomainCandidates(request)

    expect(result.scopeRowCount).toBe(20)
    expect(result.groups[0]?.rowCount).toBeLessThanOrEqual(20)
    expect(result.groups[0]?.shareOfScope).toBe((result.groups[0]?.rowCount ?? 0) / 20)
  })
})
