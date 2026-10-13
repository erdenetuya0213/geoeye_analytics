import { describe, expect, it } from 'vitest'
import { completeness, intervalIssues, recoveryLogic, dataSupport } from './geotechQaqc.js'
import type { EdaDataset, EdaObservation } from '../data/edaTypes.js'

const obs = (holeId: string, from: number, to: number, values: Record<string, number | null>, lith = 'A'): EdaObservation => ({ id: `${holeId}-${from}`, holeId, depthFrom: from, depthTo: to, easting: 0, northing: 0, dimensions: {}, lithology: lith, sampleId: '', sourceObservationId: `${holeId}-${from}`, joinKey: holeId, values })
const ds: EdaDataset = { id: 'd', name: 'D', producer: '', project: '', snapshotAt: '', source: 'demo', support: '', dimensions: [], variables: [{ key: 'rqd', label: 'RQD', shortLabel: 'RQD', unit: '%', decimals: 0 }, { key: 'tcr', label: 'TCR', shortLabel: 'TCR', unit: '%', decimals: 0 }],
  observations: [obs('H1', 0, 1, { rqd: 50, tcr: 90 }), obs('H1', 1.5, 2, { rqd: 95, tcr: 80 }), obs('H1', 1.8, 3, { rqd: null, tcr: 100 }, 'B'), obs('H2', 0, 2, { rqd: 10, tcr: 105 })] }

describe('geotech QA/QC', () => {
  it('finds gaps, overlaps and recovery logic breaches', () => {
    const issues = intervalIssues(ds)
    expect(issues.map((i) => i.kind)).toEqual(['gap', 'overlap'])
    const breaches = recoveryLogic(ds, { rqd: 'rqd', tcr: 'tcr' })
    expect(breaches.map((b) => b.rule)).toEqual(['RQD > TCR', 'TCR outside 0–100'])
  })
  it('computes completeness and support', () => {
    const c = completeness(ds)
    expect(c.cells.find((x) => x.holeId === 'H1' && x.variableKey === 'rqd')?.populated).toBe(2)
    const s = dataSupport(ds, 'lithology', ['rqd'])
    expect(s.find((r) => r.group === 'A')?.metres).toBeCloseTo(3.5)
    expect(s.find((r) => r.group === 'B')?.tests.rqd).toBe(0)
  })
})
