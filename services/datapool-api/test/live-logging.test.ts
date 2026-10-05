import { describe, expect, it } from 'vitest'
import { liveLoggingColumn, mergeLiveLoggingColumn } from '../src/live-logging.js'

describe('live logging calculation columns', () => {
  it('retains exact mapping keys for public calculated values', () => {
    expect(liveLoggingColumn('rmr76_apparent_spacing_m', 0.25)).toEqual({
      key: 'rmr76_apparent_spacing_m', label: 'Rmr76 apparent spacing m', dataType: 'numeric', unit: 'm',
    })
    expect(liveLoggingColumn('joint_condition_rating', '20')).toMatchObject({ dataType: 'numeric' })
  })
  it('does not expose internal metadata or nested selections', () => {
    expect(liveLoggingColumn('_orientation_status', 'accepted')).toBeUndefined()
    expect(liveLoggingColumn('calculation', { score: 20 })).toBeUndefined()
  })
  it('keeps numeric type across populated and missing borehole values', () => {
    const numeric = liveLoggingColumn('joint_spacing_m', 0.25)!
    const blank = liveLoggingColumn('joint_spacing_m', null)!
    expect(mergeLiveLoggingColumn(numeric, blank).dataType).toBe('numeric')
    expect(mergeLiveLoggingColumn(blank, numeric).dataType).toBe('numeric')
  })
})
