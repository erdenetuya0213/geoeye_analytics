import { describe, expect, it } from 'vitest'
import { readSpatialViewRequest, saveSpatialViewRequest } from './spatialViewStore.js'

describe('central spatial view handoff', () => {
  it('retains the dataset, source module, layer label, and unique observation IDs', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
    const request = saveSpatialViewRequest(storage, {
      colorBy: 'candidate',
      datasetId: 'integrated-v4',
      label: 'Estimation domain · OR-01',
      sourceModule: 'domain',
      sourceObservationIds: ['source-1', 'source-2', 'source-1'],
    }, '2026-10-01T04:00:00.000Z')

    expect(request.sourceObservationIds).toEqual(['source-1', 'source-2'])
    expect(readSpatialViewRequest(storage)).toEqual(request)
  })
})
