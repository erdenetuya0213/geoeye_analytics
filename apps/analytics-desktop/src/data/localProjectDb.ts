import type {
  DataPoolClient,
  Dataset,
  DrillholeSummary,
  FieldLoggingOverview,
  FieldLoggingStructure,
  ObservationValue,
  ProjectSummary,
  ProjectionStatus,
  SurveyStation,
  TabularImportInput,
  TabularImportSection,
  VariableDefinition,
} from '@geoeye/datapool-client'
import type { DrillholeImportResult, ImportedCollarRecord } from '../components/DrillholeImportDialog.js'

const DATABASE_NAME = 'geoeye-analytics-local'
const DATABASE_VERSION = 1
const PROJECT_STORE = 'projects'
const FALLBACK_PREFIX = 'geoeye.analytics.local-project.v1.'
const OBSERVATION_PAGE_SIZE = 200_000

export interface LocalProjectSnapshot {
  datasets: Dataset[]
  drillholes: DrillholeSummary[]
  fieldLogging: FieldLoggingOverview
  fieldStructures: FieldLoggingStructure[]
  observations: ObservationValue[]
  project: ProjectSummary
  projection: ProjectionStatus[]
  refreshedAt: string
  surveysByHoleId: Record<string, SurveyStation[]>
  variables: VariableDefinition[]
  version: 1
}

export interface LocalDrillholeDraft extends DrillholeImportResult {
  dirty: boolean
  updatedAt: string
}

export interface LocalTabularDraft extends TabularImportInput {
  dirty: boolean
  updatedAt: string
}

export interface LocalProjectRecord {
  draft: LocalDrillholeDraft | null
  key: string
  snapshot: LocalProjectSnapshot | null
  tabularDrafts?: Partial<Record<TabularImportSection, LocalTabularDraft>>
}

export interface DrillholePublishReport {
  collars: number
  problems: string[]
  stations: number
  surveys: number
  unknownHoles: string[]
}

const fallbackMemory = new Map<string, LocalProjectRecord>()

export function localProjectKey(endpoint: string, projectId: string): string {
  return `${endpoint.replace(/\/$/, '').toLowerCase()}#${projectId}`
}

function fallbackStorageKey(key: string): string {
  return `${FALLBACK_PREFIX}${encodeURIComponent(key)}`
}

function hasRecordShape(value: unknown): value is LocalProjectRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<LocalProjectRecord>
  return typeof record.key === 'string' && ('snapshot' in record) && ('draft' in record)
}

function readFallback(key: string): LocalProjectRecord | null {
  const memory = fallbackMemory.get(key)
  if (memory !== undefined) return memory
  try {
    const raw = window.localStorage.getItem(fallbackStorageKey(key))
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (!hasRecordShape(parsed)) return null
    fallbackMemory.set(key, parsed)
    return parsed
  } catch {
    return null
  }
}

function writeFallback(record: LocalProjectRecord): void {
  fallbackMemory.set(record.key, record)
  try {
    window.localStorage.setItem(fallbackStorageKey(record.key), JSON.stringify(record))
  } catch {
    // IndexedDB is the normal storage. The in-memory copy remains usable if the
    // browser has disabled storage or a localStorage fallback is too small.
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onerror = () => reject(request.error ?? new Error('Local project database could not be opened'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PROJECT_STORE)) database.createObjectStore(PROJECT_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
  })
}

export async function readLocalProjectRecord(key: string): Promise<LocalProjectRecord | null> {
  if (typeof window === 'undefined' || window.indexedDB === undefined) return readFallback(key)
  try {
    const database = await openDatabase()
    const result = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, 'readonly')
      const request = transaction.objectStore(PROJECT_STORE).get(key)
      request.onerror = () => reject(request.error ?? new Error('Local project could not be read'))
      request.onsuccess = () => resolve(request.result)
    })
    database.close()
    return hasRecordShape(result) ? result : null
  } catch {
    return readFallback(key)
  }
}

export async function writeLocalProjectRecord(record: LocalProjectRecord): Promise<void> {
  fallbackMemory.set(record.key, record)
  if (typeof window === 'undefined' || window.indexedDB === undefined) {
    writeFallback(record)
    return
  }
  try {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, 'readwrite')
      transaction.onerror = () => reject(transaction.error ?? new Error('Local project could not be saved'))
      transaction.oncomplete = () => resolve()
      transaction.objectStore(PROJECT_STORE).put(record)
    })
    database.close()
  } catch {
    writeFallback(record)
  }
}

async function loadAllObservations(
  client: DataPoolClient,
  projectId: string,
  variableKeys: readonly string[],
): Promise<ObservationValue[]> {
  if (variableKeys.length === 0) return []
  const observations: ObservationValue[] = []
  let offset = 0
  do {
    const page = await client.queryObservations({
      // The local analytical copy must include explicitly uploaded database
      // rows. CSV imports are stored as raw observations until a later review,
      // and individual tools decide whether that quality is acceptable.
      acceptedOnly: false,
      limit: OBSERVATION_PAGE_SIZE,
      offset,
      projectId,
      variableKeys: [...variableKeys],
    })
    observations.push(...page)
    if (page.length < OBSERVATION_PAGE_SIZE) break
    offset += page.length
  } while (true)
  return observations
}

async function loadSurveys(
  client: DataPoolClient,
  projectId: string,
  holes: readonly DrillholeSummary[],
): Promise<Record<string, SurveyStation[]>> {
  const surveyed = holes.filter((hole) => hole.surveyStationCount > 0)
  const entries: Array<readonly [string, SurveyStation[]]> = []
  for (let index = 0; index < surveyed.length; index += 8) {
    const batch = surveyed.slice(index, index + 8)
    entries.push(...await Promise.all(batch.map(async (hole) => [hole.id, await client.surveys(projectId, hole.id)] as const)))
  }
  return Object.fromEntries(entries)
}

/** The only project-data cloud read used by Analytics. Call it only from an explicit refresh action. */
export async function loadLocalProjectSnapshot(
  client: DataPoolClient,
  project: ProjectSummary,
): Promise<LocalProjectSnapshot> {
  const [variables, datasets, drillholes, projection, fieldLogging, fieldStructures] = await Promise.all([
    client.variables(),
    client.datasets(project.id),
    client.drillholes(project.id),
    client.projectionStatus(project.id),
    client.fieldLogging(project.id),
    client.fieldLoggingStructures(project.id),
  ])
  const [observations, surveysByHoleId] = await Promise.all([
    loadAllObservations(client, project.id, variables.map((variable) => variable.key)),
    loadSurveys(client, project.id, drillholes),
  ])
  return {
    datasets,
    drillholes,
    fieldLogging,
    fieldStructures,
    observations,
    project,
    projection,
    refreshedAt: new Date().toISOString(),
    surveysByHoleId,
    variables,
    version: 1,
  }
}

function normalizedHoleName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, '')
}

function importedCrs(record: ImportedCollarRecord): { authority: string; code: string; name: string } {
  const raw = record.crs?.trim() ?? ''
  const match = raw.match(/^([a-z][a-z0-9_-]*)\s*[: ]\s*([a-z0-9._-]+)$/i)
  const authority = match?.[1]?.toUpperCase() ?? 'LOCAL'
  const code = match?.[2] ?? 'UNKNOWN'
  return { authority, code, name: raw || 'Local imported coordinates' }
}

/** Applies the unsent drillhole draft on top of the last cloud snapshot for every local consumer. */
export function effectiveDrillholes(
  snapshot: LocalProjectSnapshot | null,
  draft: LocalDrillholeDraft | null,
): DrillholeSummary[] {
  const holes = new Map((snapshot?.drillholes ?? []).map((hole) => [normalizedHoleName(hole.name), { ...hole }]))
  const surveyCounts = new Map<string, number>()
  draft?.survey.forEach((station) => {
    const key = normalizedHoleName(station.holeId)
    surveyCounts.set(key, (surveyCounts.get(key) ?? 0) + 1)
  })
  const importedNames = new Map<string, string>()
  draft?.survey.forEach((station) => importedNames.set(normalizedHoleName(station.holeId), station.holeId))
  // Collar spelling wins when survey and collar files format the same hole ID differently.
  draft?.collar.forEach((collar) => importedNames.set(normalizedHoleName(collar.holeId), collar.holeId))

  importedNames.forEach((name, key) => {
    const existing = holes.get(key)
    const collar = draft?.collar.find((item) => normalizedHoleName(item.holeId) === key)
    holes.set(key, {
      collar: collar === undefined ? existing?.collar ?? null : {
        accuracy: null,
        crs: importedCrs(collar),
        easting: collar.easting,
        elevation: collar.elevation,
        latitude: null,
        longitude: null,
        northing: collar.northing,
        source: 'GeoEye Analytics local import',
        surveyMethod: null,
        updatedAt: draft?.updatedAt ?? new Date(0).toISOString(),
      },
      id: existing?.id ?? `local:${key}`,
      // The local import is the user's active analytical identity. Preserve its
      // spelling so downstream selectors show the collar list rather than the
      // differently formatted Field/Core Logging name.
      name,
      projectId: existing?.projectId ?? snapshot?.project.id ?? 'local',
      surveyStationCount: surveyCounts.get(key) ?? existing?.surveyStationCount ?? 0,
    })
  })
  return [...holes.values()].sort((left, right) => left.name.localeCompare(right.name))
}

/** Applies local survey imports without modifying the cloud snapshot stored underneath. */
export function effectiveSurveysByHoleId(
  snapshot: LocalProjectSnapshot | null,
  draft: LocalDrillholeDraft | null,
): Record<string, SurveyStation[]> {
  const result = Object.fromEntries(Object.entries(snapshot?.surveysByHoleId ?? {}).map(([holeId, stations]) => [holeId, [...stations]]))
  if (draft === null) return result
  const holes = effectiveDrillholes(snapshot, draft)
  const holeIdByName = new Map(holes.map((hole) => [normalizedHoleName(hole.name), hole.id]))
  const grouped = new Map<string, SurveyStation[]>()
  draft.survey.forEach((station, index) => {
    const holeId = holeIdByName.get(normalizedHoleName(station.holeId)) ?? `local:${normalizedHoleName(station.holeId)}`
    const rows = grouped.get(holeId) ?? []
    rows.push({
      accuracy: null,
      azimuth: station.azimuth,
      dip: station.dip,
      id: `local:${holeId}:${station.depth}:${index}`,
      measuredDepth: station.depth,
      source: 'GeoEye Analytics local import',
      surveyMethod: null,
      surveyedAt: null,
      tool: null,
    })
    grouped.set(holeId, rows)
  })
  grouped.forEach((stations, holeId) => {
    result[holeId] = stations.sort((left, right) => left.measuredDepth - right.measuredDepth)
  })
  return result
}

export function createLocalDrillholeDraft(value: DrillholeImportResult, dirty = true): LocalDrillholeDraft {
  return {
    collar: value.collar,
    dirty,
    survey: value.survey,
    updatedAt: new Date().toISOString(),
  }
}

export function createLocalTabularDraft(value: TabularImportInput, dirty = true): LocalTabularDraft {
  return {
    ...value,
    columns: [...value.columns],
    dirty,
    rows: value.rows.map((row) => [...row]),
    updatedAt: new Date().toISOString(),
  }
}
