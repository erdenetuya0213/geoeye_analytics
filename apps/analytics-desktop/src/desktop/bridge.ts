import type { AnalysisResultPackage } from '../data/analysisResultStore.js'
import type { LocalProjectRecord } from '../data/localProjectDb.js'

export interface DesktopCredential {
  accountId?: string
  token: string
}

export interface OfflineLicense {
  email: string
  accountId: string
  licenseId: string
  expiresAt: string
}

export interface ActivationStatus {
  license: OfflineLicense | null
  error: string | null
}

export interface DatabaseConfiguration {
  endpoint: string
  accountId: string
  email: string
  expiresAt: string
}

export interface ProjectStorageAddress {
  accountId?: string
  endpoint: string
  projectId: string
  tenantId?: string | null
}

export interface DesktopWorkspaceStatus {
  appDataPath: string
  configured: boolean
  rootPath: string | null
}

export interface DesktopDataPoolRequest {
  body?: string
  headers?: Record<string, string>
  method?: string
  url: string
}

export interface DesktopDataPoolResponse {
  body: string
  headers: Record<string, string>
  status: number
  statusText: string
}

export interface GeoEyeDesktopBridge {
  readonly isDesktop: true
  activationStatus(): Promise<ActivationStatus>
  activateOffline(input: { email: string; key: string }): Promise<ActivationStatus>
  logoutActivation(): Promise<void>
  readAppStorage(): Promise<Record<string, string>>
  writeAppStorage(input: { key: string; value: string }): Promise<void>
  removeAppStorage(key: string): Promise<void>
  loadCredential(): Promise<DesktopCredential | null>
  saveCredential(credential: DesktopCredential): Promise<void>
  clearCredential(): Promise<void>
  requestDataPool(input: DesktopDataPoolRequest): Promise<DesktopDataPoolResponse>
  databaseConfiguration(): Promise<DatabaseConfiguration | null>
  workspaceStatus(): Promise<DesktopWorkspaceStatus>
  chooseWorkspaceRoot(): Promise<DesktopWorkspaceStatus | null>
  readProjectRecord(address: ProjectStorageAddress): Promise<LocalProjectRecord | null>
  writeProjectRecord(input: { address: ProjectStorageAddress; record: LocalProjectRecord }): Promise<void>
  archiveImportFiles(input: { address: ProjectStorageAddress; files: ImportSourceFile[] }): Promise<string[]>
  exportWorkspaceFile(input: { address: ProjectStorageAddress; name: string; contents: string }): Promise<string>
  enqueueSync(input: { address: ProjectStorageAddress; entity: string; version: string; requests: SyncRequest[] }): Promise<SyncOperation[]>
  syncStatus(input: { address: ProjectStorageAddress }): Promise<SyncOperation[]>
  runSync(input: { address: ProjectStorageAddress }): Promise<SyncOperation[]>
  retrySync(input: { address: ProjectStorageAddress; id: string }): Promise<SyncOperation[]>
  cancelSync(input: { address: ProjectStorageAddress; id: string }): Promise<SyncOperation[]>
  readProjectDocuments(address: ProjectStorageAddress): Promise<Record<string, string>>
  writeProjectDocument(input: { address: ProjectStorageAddress; key: string; value: string }): Promise<void>
  removeProjectDocument(input: { address: ProjectStorageAddress; key: string }): Promise<void>
  saveAnalysisResultPackage(input: { address: ProjectStorageAddress; result: AnalysisResultPackage }): Promise<void>
  readAnalysisResultPackages(address: ProjectStorageAddress): Promise<AnalysisResultPackage[]>
}

export interface ImportSourceFile { name: string; contents: string; base64?: string }
export interface SyncRequest { path: string; method: 'PUT' | 'POST'; body: string }
export interface SyncOperation {
  id: string; entity: string; version: string; state: 'pending' | 'sending' | 'retry' | 'needs-review' | 'sent' | 'cancelled'
  attempts: number; nextAttemptAt: string | null; lastError: string | null; cursor: number
  result: unknown
}

declare global {
  interface Window {
    geoeyeDesktop?: GeoEyeDesktopBridge
  }
}

export function desktopBridge(): GeoEyeDesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.geoeyeDesktop
}
