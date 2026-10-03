import { describe, expect, it } from 'vitest'
import { readStructureDerivedDocument, saveStructureDerivedValues } from './structureDerivedStore.js'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('structure derived values', () => {
  it('publishes joint sets with source lineage without changing the input rows', () => {
    const storage = memoryStorage()
    const rows = [{ observationId: 'OBS-1', jointSet: 'J1' }]
    const sourceSnapshot = JSON.stringify(rows)
    const document = saveStructureDerivedValues(storage, {
      datasetId: 'dataset.structural-logging', holeFilter: 'all', rows,
      templateId: 'structure-auto-v34', templateVersion: 34,
    }, '2026-10-03T01:00:00.000Z')

    expect(document.rows[0]).toMatchObject({ datasetId: 'dataset.structural-logging', jointSet: 'J1', sourceObservationIds: ['OBS-1'] })
    expect(document.runs[0]).toMatchObject({ rowCount: 1, templateVersion: 34 })
    expect(JSON.stringify(rows)).toBe(sourceSnapshot)
  })

  it('overwrites the active derived value while retaining run history', () => {
    const storage = memoryStorage()
    const input = { datasetId: 'dataset.structural-logging', holeFilter: 'all', rows: [{ observationId: 'OBS-1', jointSet: 'J1' }], templateId: 'structure-auto-v34', templateVersion: 34 }
    saveStructureDerivedValues(storage, input, '2026-10-03T01:00:00.000Z')
    saveStructureDerivedValues(storage, { ...input, rows: [{ observationId: 'OBS-1', jointSet: 'J2' }], templateVersion: 35 }, '2026-10-03T02:00:00.000Z')
    const document = readStructureDerivedDocument(storage)

    expect(document.rows).toHaveLength(1)
    expect(document.rows[0]?.jointSet).toBe('J2')
    expect(document.runs).toHaveLength(2)
  })
})
