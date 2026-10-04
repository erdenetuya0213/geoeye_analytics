import { planDrillholePublish } from './drillholePublish.js'
import type { LocalDrillholeDraft, LocalProjectSnapshot } from './localProjectDb.js'
import type { SyncRequest } from '../desktop/bridge.js'

export function drillholeSyncRequests(projectId: string, draft: LocalDrillholeDraft, snapshot: LocalProjectSnapshot): SyncRequest[] {
  const plan = planDrillholePublish(draft, snapshot.drillholes)
  if (plan.rejected.length || plan.unknownHoles.length) {
    throw new Error([...plan.rejected, ...(plan.unknownHoles.length ? [`${plan.unknownHoles.length} imported holes are not in this Database project. Match the hole IDs before syncing.`] : [])].join(' '))
  }
  const prefix = `/v1/projects/${encodeURIComponent(projectId)}/drillholes/`
  const key = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  const requests: SyncRequest[] = plan.collars.map(collar => {
    const imported = draft.collar.find(row => key(row.holeId) === key(collar.holeName))
    const existing = snapshot.drillholes.find(hole => hole.id === collar.holeId)
    const match = imported?.crs?.trim().match(/^([a-z][a-z0-9_-]*)\s*[: ]\s*([a-z0-9._-]+)$/i)
    const crs = match ? { authority: match[1]!.toUpperCase(), code: match[2]! } : existing?.collar?.crs
    if (!crs) throw new Error(`${collar.holeName}: a CRS such as EPSG:32648 is required before syncing.`)
    return { path: `${prefix}${encodeURIComponent(collar.holeId)}/collar`, method: 'PUT', body: JSON.stringify({ crs, easting: collar.easting, northing: collar.northing, elevation: collar.elevation, source: 'GeoEye Analytics local import' }) }
  })
  for (const survey of plan.surveys) requests.push({ path: `${prefix}${encodeURIComponent(survey.holeId)}/surveys`, method: 'PUT', body: JSON.stringify({ stations: survey.stations.map(station => ({ ...station, source: 'GeoEye Analytics local import' })) }) })
  if (!requests.length) throw new Error('There are no collar or survey rows to sync.')
  return requests
}
