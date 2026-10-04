import { expect, it } from 'vitest'
import { drillholeSyncRequests } from './syncOutbox.js'
import { emptyOfflineProject } from './offlineProject.js'
import type { LocalDrillholeDraft } from './localProjectDb.js'

const snapshot = { ...emptyOfflineProject('project-1'), drillholes: [{ id: 'hole-1', name: 'BH-1', projectId: 'project-1', collar: null, surveyStationCount: 0 }] }
const draft: LocalDrillholeDraft = {
  dirty: true, updatedAt: 'v1',
  collar: [{ holeId: 'BH 1', crs: 'EPSG:32648', easting: 100, northing: 200, elevation: 300 }],
  survey: [{ holeId: 'BH 1', depth: 0, dip: -90, azimuth: 360 }],
}

it('queues validated repeatable requests with normalized hole names and CRS', () => {
  const requests = drillholeSyncRequests('project-1', draft, snapshot)
  expect(requests.map(request => request.method)).toEqual(['PUT', 'PUT'])
  expect(JSON.parse(requests[0]!.body).crs).toEqual({ authority: 'EPSG', code: '32648' })
  expect(JSON.parse(requests[1]!.body).stations[0].azimuth).toBe(0)
})

it('does not queue partial data for unknown holes, invalid surveys, or missing CRS', () => {
  expect(() => drillholeSyncRequests('project-1', draft, { ...snapshot, drillholes: [] })).toThrow('not in this Database project')
  expect(() => drillholeSyncRequests('project-1', { ...draft, collar: draft.collar.map(row => ({ ...row, crs: undefined })) }, snapshot)).toThrow('CRS')
  expect(() => drillholeSyncRequests('project-1', { ...draft, survey: [{ holeId: 'BH 1', depth: -1, dip: -90, azimuth: 0 }] }, snapshot)).toThrow()
})
