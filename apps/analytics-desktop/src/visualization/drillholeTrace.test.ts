import { describe, expect, it } from 'vitest'
import { buildDrillholeTrace } from './drillholeTrace.js'

describe('buildDrillholeTrace', () => {
  it('derives the path, station markers, and scale from survey stations', () => {
    const trace = buildDrillholeTrace([
      { depth: 0, azimuth: 40, dip: -70 },
      { depth: 75, azimuth: 52, dip: -64 },
      { depth: 150, azimuth: 68, dip: -58 },
    ])

    expect(trace.totalDepth).toBe(150)
    expect(trace.depthTicks).toEqual([0, 37.5, 75, 112.5, 150])
    expect(trace.points).toHaveLength(3)
    expect(trace.path).toMatch(/^M\d+\.\d{2} 12\.00L/)
    expect(trace.path).toContain('278.00')
  })

  it('changes the trace when the survey orientation changes', () => {
    const vertical = buildDrillholeTrace([
      { depth: 0, azimuth: 0, dip: -90 },
      { depth: 100, azimuth: 0, dip: -90 },
    ])
    const deviated = buildDrillholeTrace([
      { depth: 0, azimuth: 45, dip: -70 },
      { depth: 100, azimuth: 80, dip: -40 },
    ])

    expect(deviated.path).not.toBe(vertical.path)
  })

  it('does not fabricate a trace when there is no positive-depth survey', () => {
    expect(buildDrillholeTrace([])).toEqual({ depthTicks: [], path: '', points: [], totalDepth: null })
    expect(buildDrillholeTrace([{ depth: 0, azimuth: 42, dip: -60 }]).path).toBe('')
  })
})
