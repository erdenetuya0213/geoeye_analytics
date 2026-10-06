import { describe, expect, it } from 'vitest'
import { MemoryProjectStorage } from '../state/ProjectStorageContext.js'
import { readPersistedState, writePersistedState } from '../state/persistentState.js'
import type { EdaDataset } from './edaTypes.js'
import { prepareDatasetAnalysis } from './datasetAnalysisNavigation.js'

const dataset: EdaDataset = {
  id: 'local-field-logging-structure:v35', name: 'Structure v35', producer: 'Field', project: 'DMP',
  snapshotAt: '2026-10-05T00:00:00Z', source: 'live', support: 'intervals', dimensions: [], observations: [],
  variables: [
    { key: 'type', label: 'Type', shortLabel: 'Type', unit: '', decimals: 0, dataType: 'category' },
    { key: 'spacing', label: 'Spacing', shortLabel: 'Spacing', unit: 'm', decimals: 2, dataType: 'numeric' },
    { key: 'alpha', label: 'Alpha', shortLabel: 'Alpha', unit: '°', decimals: 1 },
  ],
}

describe('local dataset analysis navigation', () => {
  it.each(['explore', 'multivariate'] as const)('opens the exact version in %s without stale filters or results', (target) => {
    const storage = new MemoryProjectStorage({}, null)
    writePersistedState(storage, `${target}.filterValues`, { drillhole: 'other-hole' })
    writePersistedState(storage, `${target}.activeRun`, { datasetId: 'other' })
    prepareDatasetAnalysis(storage, dataset, target)
    expect(readPersistedState(storage, `${target}.datasetId`, '')).toBe(dataset.id)
    expect(readPersistedState(storage, `${target}.variableKeys`, [])).toEqual(['spacing', 'alpha'])
    expect(readPersistedState(storage, `${target}.filterValues`, {})).toEqual({})
    expect(readPersistedState(storage, `${target}.activeRun`, null)).toBeUndefined()
    if (target === 'explore') {
      expect(readPersistedState(storage, 'explore.datasetHandoff', false)).toBe(true)
      expect(readPersistedState(storage, 'explore.relationshipDatasetIds', [])).toEqual([dataset.id])
      expect(readPersistedState(storage, 'explore.yVariableKey', '')).toBe('alpha')
    }
    const otherProject = new MemoryProjectStorage({}, null)
    expect(readPersistedState(otherProject, `${target}.datasetId`, '')).toBeUndefined()
  })
})
