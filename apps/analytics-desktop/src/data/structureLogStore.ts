export interface StructureSetBoundaryPoint {
  x: number
  y: number
}

export interface StructureSetDefinition {
  boundary?: StructureSetBoundaryPoint[]
  color: string
  id: string
  label: string
}

export interface StructureLogAnalysisRow {
  jointSet: string
  observationId: string
}

export interface StructureLogVersion {
  holeFilter: string
  rows: StructureLogAnalysisRow[]
  sets: StructureSetDefinition[]
  templateId: string
  updatedAt: string
  version: number
}

const storageKey = 'geoeye.analytics.structure-log.versions.v1'

export function upsertStructureLogVersion(
  versions: readonly StructureLogVersion[],
  next: StructureLogVersion,
) {
  const identity = (version: StructureLogVersion) => (
    version.templateId === next.templateId
    && version.holeFilter === next.holeFilter
    && version.version === next.version
  )
  const existingIndex = versions.findIndex(identity)
  if (existingIndex === -1) return [...versions, next]
  return versions.map((version, index) => index === existingIndex ? next : version)
}

export function readStructureLogVersions(storage: StorageAdapter = appStorage): StructureLogVersion[] {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed as StructureLogVersion[] : []
  } catch {
    return []
  }
}

export function readLatestStructureLogVersion(templateId: string, holeFilter: string, storage: StorageAdapter = appStorage) {
  return readStructureLogVersions(storage)
    .filter((version) => version.templateId === templateId && version.holeFilter === holeFilter)
    .sort((a, b) => b.version - a.version)[0]
}

export function nextStructureLogVersionNumber(
  versions: readonly StructureLogVersion[],
  templateId: string,
  holeFilter: string,
  currentVersion: number,
) {
  const latestVersion = versions
    .filter((version) => version.templateId === templateId && version.holeFilter === holeFilter)
    .reduce((latest, version) => Math.max(latest, version.version), currentVersion)
  return latestVersion + 1
}

export function writeStructureLogVersion(version: StructureLogVersion, storage: StorageAdapter = appStorage) {
  storage.setItem(storageKey, JSON.stringify(upsertStructureLogVersion(readStructureLogVersions(storage), version)))
}
import { appStorage, type StorageAdapter } from '../desktop/runtime.js'
