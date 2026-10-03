import { describe, expect, it } from 'vitest'
import { edaDemoDataset } from '../data/edaDemo.js'
import { buildEdaRunRequest, calculateEdaRun, edaConfigurationSignature, type EdaRunConfiguration } from './edaRun.js'

function configuration(overrides: Partial<EdaRunConfiguration> = {}): EdaRunConfiguration {
  return {
    activeFilterKeys: [],
    compareBy: null,
    datasetId: edaDemoDataset.id,
    datasetName: edaDemoDataset.name,
    filterValues: {},
    minimumPopulationSize: 20,
    secondGroup: null,
    snapshotAt: edaDemoDataset.snapshotAt,
    supportLabel: edaDemoDataset.support,
    variableKeys: ['assay.au'],
    weighting: { cellSize: 25, method: 'cell-declustering' },
    ...overrides,
  }
}

describe('EDA batch runs', () => {
  it('expands every variable and valid two-dimensional population in one request', () => {
    const request = buildEdaRunRequest(configuration({
      compareBy: 'lithology',
      secondGroup: 'alteration',
      variableKeys: ['assay.au', 'assay.cu', 'assay.as'],
    }), edaDemoDataset, 7, new Date('2026-10-01T00:00:00.000Z'))

    const combinations = new Set(request.populations.map((population) => `${population.compareValue}/${population.secondGroupValue}`))
    expect(combinations.size).toBe(12)
    expect(request.populations).toHaveLength(combinations.size * 3)
    expect(request.populations.every((population) => population.distributionRequest.observations.length > 0)).toBe(true)
    expect(request.runNumber).toBe(7)
  })

  it('calculates and retains populations below the warning threshold', () => {
    const request = buildEdaRunRequest(configuration({ minimumPopulationSize: 1_000 }), edaDemoDataset, 1)
    const result = calculateEdaRun(request, new Date('2026-10-01T00:01:00.000Z'))

    expect(result.populations).toHaveLength(1)
    expect(result.populations[0]?.insufficient).toBe(true)
    expect(result.populations[0]?.result.sample.summary.count).toBeGreaterThan(0)
  })

  it('treats variable ordering as the same run configuration', () => {
    const left = configuration({ variableKeys: ['assay.au', 'assay.cu'] })
    const right = configuration({ variableKeys: ['assay.cu', 'assay.au'] })
    expect(edaConfigurationSignature(left)).toBe(edaConfigurationSignature(right))
  })
})
