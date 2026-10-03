import type { StorageLike } from './geotechnicalDerivedStore.js'

export interface SpatialViewRequest {
  colorBy: string
  createdAt: string
  datasetId: string
  label: string
  sourceModule: 'domain' | 'multivariate' | 'statistics' | 'manual'
  sourceObservationIds: string[]
  version: 1
}

export const SPATIAL_VIEW_REQUEST_KEY = 'geoeye.analytics.spatial-view-request.v1'

export function readSpatialViewRequest(storage?: StorageLike): SpatialViewRequest | null {
  if (storage === undefined) return null
  try {
    const parsed = JSON.parse(storage.getItem(SPATIAL_VIEW_REQUEST_KEY) ?? 'null') as Partial<SpatialViewRequest> | null
    if (parsed?.version !== 1 || typeof parsed.datasetId !== 'string' || typeof parsed.label !== 'string' || !Array.isArray(parsed.sourceObservationIds)) return null
    return parsed as SpatialViewRequest
  } catch {
    return null
  }
}

export function saveSpatialViewRequest(
  storage: StorageLike,
  request: Omit<SpatialViewRequest, 'createdAt' | 'version'>,
  createdAt = new Date().toISOString(),
): SpatialViewRequest {
  const next: SpatialViewRequest = {
    ...request,
    createdAt,
    sourceObservationIds: [...new Set(request.sourceObservationIds)],
    version: 1,
  }
  storage.setItem(SPATIAL_VIEW_REQUEST_KEY, JSON.stringify(next))
  return next
}
