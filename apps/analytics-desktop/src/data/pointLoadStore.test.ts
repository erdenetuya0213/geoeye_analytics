import { describe, expect, it } from 'vitest'
import { createPointLoadRecord, pointLoadDemoRecords, readPointLoadRecords, writePointLoadRecords } from './pointLoadStore.js'

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
    const source = pointLoadDemoRecords.slice(0, 1)
    expect(writePointLoadRecords(storage, source)).toBe(true)
    expect(readPointLoadRecords(storage)).toEqual(source)
  })

  it('falls back to demo records when stored data is malformed', () => {
    expect(readPointLoadRecords(memoryStorage('{bad json'))).toEqual(pointLoadDemoRecords)
  })
})
