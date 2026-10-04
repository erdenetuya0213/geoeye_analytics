export type SectionId =
  | 'overview'
  | 'data-pool'
  | 'drillholes'
  | 'field-logging'
  | 'laboratory'
  | 'strength'
  | 'xrf'
  | 'spectral'
  | 'spatial-reference'
  | 'explore'
  | 'domain'
  | 'grade'
  | 'variography'
  | 'structure'
  | 'geotechnical'
  | 'multivariate'
  | 'view-3d'

export interface NavigationItem {
  id: SectionId
  label: string
  icon: string
  badge?: string
}

export interface ConnectionSettings {
  version: 1
  endpoint: string
  token: string
  /** Authorization is injected by the native host; no API token enters the UI. */
  managed?: boolean
  /** Stable GeoEye account identity used to isolate durable local workspaces. */
  accountId?: string
}

export type ConnectionState = 'checking' | 'connected' | 'unavailable'
