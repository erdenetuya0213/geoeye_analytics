import { describe, expect, it } from 'vitest'
import { readSchmidtRecords, writeSchmidtRecords, type SchmidtRecord } from './schmidtStore.js'

function memoryStorage(initial: string | null = null) {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
  }
}

const record: SchmidtRecord = {
  createdAt: '2026-10-01T00:00:00.000Z',
  depthFromM: 0,
  depthToM: 0.842,
  holeId: 'TT_2026_002GT',
  id: 'schmidt:test.csv:4',
  reboundValue: 12,
  sampleId: 'TT_2026_002GT-0-0.842-SCH',
  sourceFile: 'test.csv',
  sourceRow: 4,
}

describe('Schmidt strength records', () => {
  it('round-trips imported records', () => {
    const storage = memoryStorage()
    expect(writeSchmidtRecords(storage, [record])).toBe(true)
    expect(readSchmidtRecords(storage)).toEqual([record])
  })

  it('drops malformed stored rows', () => {
    const storage = memoryStorage(JSON.stringify([record, { ...record, reboundValue: 0 }]))
    expect(readSchmidtRecords(storage)).toEqual([record])
  })
})
