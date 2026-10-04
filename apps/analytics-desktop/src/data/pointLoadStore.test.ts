import { describe, expect, it } from 'vitest'
import { createPointLoadRecord, readPointLoadRecords, writePointLoadRecords } from './pointLoadStore.js'

function memoryStorage(initial: string | null = null) {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
  }
}

describe('point-load test records', () => {
  it('validates depth intervals', () => {
    expect(() => createPointLoadRecord({
      depthFromM: 11,
      depthToM: 10,
      equivalentDiameterMm: 50,
      holeId: 'DD-01',
      labName: 'Lab',
      peakLoadKn: 10,
      sampleId: 'PLT-1',
      testedAt: '2026-10-01',
      testType: 'diametral',
      validBreak: true,
    }, 'test-1')).toThrow('To depth')
  })

  it('round-trips records and recalculates derived values', () => {
    const storage = memoryStorage()
    const source = [createPointLoadRecord({
      depthFromM: 10,
      depthToM: 11,
      equivalentDiameterMm: 50,
      holeId: 'TEST-01',
      labName: 'Test lab',
      peakLoadKn: 10,
      sampleId: 'PLT-1',
      testedAt: '2026-10-01',
      testType: 'diametral',
      validBreak: true,
    }, 'test-1')]
    expect(writePointLoadRecords(storage, source)).toBe(true)
    expect(readPointLoadRecords(storage)).toEqual(source)
  })

  it('returns an empty collection when stored data is malformed', () => {
    expect(readPointLoadRecords(memoryStorage('{bad json'))).toEqual([])
  })
})
