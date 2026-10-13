import { expect, it } from 'vitest'
import { loggedMetres, projectSummaryGroups } from './projectSummary.js'
import type { LocalProjectSnapshot } from './localProjectDb.js'

it('counts overlapping logged intervals of one hole once and keeps holes apart', () => {
  expect(loggedMetres([
    { depthFrom: 0, depthTo: 10, holeId: 'a' },
    { depthFrom: 5, depthTo: 12, holeId: 'a' },
    { depthFrom: 20, depthTo: 25, holeId: 'a' },
    { depthFrom: 0, depthTo: 8, holeId: 'b' },
    { depthFrom: 3, depthTo: 3, holeId: 'b' },
    { depthFrom: null, depthTo: 4, holeId: 'b' },
  ])).toBe(25)
  expect(loggedMetres([])).toBe(0)
})

const snapshot = {
  datasets: [], drillholes: [
    { id: 'h1', name: 'DH1', collar: { easting: 1 }, surveyStationCount: 3 },
    { id: 'h2', name: 'DH2', collar: null, surveyStationCount: 0 },
  ],
  fieldLogging: {
    datasets: [{ id: 'geotech', name: 'Geotechnical', columns: [{ key: 'rqd' }, { key: 'ucs' }], records: [{ depthFrom: 0, depthTo: 30, holeId: 'h1' }] }],
    projectId: 'p', submissions: [{ templateName: 'Structure', depthFrom: 0, depthTo: 12.4, holeId: 'h1' }], templates: [{ name: 'Geotechnical' }, { name: 'Structure' }],
  },
  observations: [], variables: [],
} as unknown as LocalProjectSnapshot

it('summarises holes, logging, classes and XRF as names and numbers only', () => {
  const groups = projectSummaryGroups({
    drillholeDraft: null, snapshot,
    lab: [{ columns: [], id: 'l1', name: 'Au assay', rows: [[], [], []] }],
    strength: [],
    xrfDraft: { columns: [], dirty: true, fileName: 'xrf.csv', rows: [[], []], section: 'xrf', updatedAt: '' },
  })
  expect(groups.map(group => group.label)).toEqual(['Holes', 'Logging', 'Lab', 'Strength', 'XRF'])
  expect(groups[0]!.rows).toEqual([{ name: 'Holes', value: '2' }, { name: 'Collar', value: '1' }, { name: 'Surveyed', value: '1' }])
  expect(groups[1]!.rows).toEqual([
    { name: 'Geotechnical', note: '2 fields', value: '30 m' },
    { name: 'Structure', note: '0 fields', value: '12 m' },
  ])
  expect(groups[2]!.rows).toEqual([{ name: 'Au assay', value: '3' }])
  expect(groups[3]!.rows).toEqual([{ name: 'Tests', value: '0' }])
  expect(groups[4]!.rows).toEqual([{ name: 'Measurements', value: '2' }])
})
