import { DataPoolError, type DataPoolClient, type ProjectSummary, type Session, type TabularImportInput, type TabularImportResult, type TabularImportSection } from '@geoeye/datapool-client'
import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DrillholeImportResult } from '../components/DrillholeImportDialog.js'
import { createDataPoolClient } from '../data/dataPoolConnection.js'
import { readDrillholeImport } from '../data/drillholeImportStore.js'
import { planDrillholePublish } from '../data/drillholePublish.js'
import {
  createLocalDrillholeDraft,
  createLocalTabularDraft,
  loadLocalProjectSnapshot,
  localProjectKey,
  readLocalProjectRecord,
  writeLocalProjectRecord,
  type DrillholePublishReport,
  type LocalDrillholeDraft,
  type LocalProjectRecord,
  type LocalProjectSnapshot,
  type LocalTabularDraft,
} from '../data/localProjectDb.js'
import type { ConnectionSettings, ConnectionState } from '../types.js'

const projectStorageKey = 'geoeye.analytics.project.v1'
const legacyImportMigrationKey = 'geoeye.analytics.drillhole-import.migrated.v1'

export interface DataPoolWorkspace {
  /** True when the app is signed in to a Data Pool rather than showing the demo workspace. */
  live: boolean
  client: DataPoolClient | null
  /** Cache-key prefix that isolates queries per endpoint and signed-in user. */
  scope: string
  /** The signed-in user and their organizations; null in the demo workspace. */
  session: Session | null
  /** Projects the signed-in user may open. Already limited by the Data Pool. */
  projects: readonly ProjectSummary[]
  project: ProjectSummary | null
  projectsLoading: boolean
  projectsError: string | null
  /** Last explicitly refreshed project snapshot stored in the local desktop database. */
  localSnapshot: LocalProjectSnapshot | null
  /** Unsent collar/survey edits layered over localSnapshot for every feature. */
  localDrillholeDraft: LocalDrillholeDraft | null
  /** Unsent CSV imports, persisted locally and isolated by project. */
  localTabularDrafts: Partial<Record<TabularImportSection, LocalTabularDraft>>
  localLoading: boolean
  localRefreshing: boolean
  localError: string | null
  refreshLocalProject: () => Promise<void>
  saveDrillholesLocally: (value: DrillholeImportResult) => Promise<void>
  saveTabularImportLocally: (value: TabularImportInput) => Promise<void>
  publishLocalDrillholes: () => Promise<DrillholePublishReport>
  publishLocalTabularImport: (section: TabularImportSection) => Promise<TabularImportResult>
  selectProject: (projectId: string) => void
  signOut: () => void
}

const demoWorkspace: DataPoolWorkspace = {
  live: false,
  client: null,
  scope: 'demo',
  session: null,
  projects: [],
  project: null,
  projectsLoading: false,
  projectsError: null,
  localSnapshot: null,
  localDrillholeDraft: null,
  localTabularDrafts: {},
  localLoading: false,
  localRefreshing: false,
  localError: null,
  refreshLocalProject: async () => undefined,
  saveDrillholesLocally: async () => undefined,
  saveTabularImportLocally: async () => undefined,
  publishLocalDrillholes: async () => ({ collars: 0, problems: [], stations: 0, surveys: 0, unknownHoles: [] }),
  publishLocalTabularImport: async () => { throw new Error('Connect to the Database before saving an import.') },
  selectProject: () => undefined,
  signOut: () => undefined,
}

const DataPoolWorkspaceContext = createContext<DataPoolWorkspace>(demoWorkspace)

/** Picks the stored project when it still exists, otherwise the one with the most drillholes. */
export function resolveActiveProject(
  projects: readonly ProjectSummary[],
  preferredId: string | null,
): ProjectSummary | null {
  const preferred = projects.find((project) => project.id === preferredId)
  if (preferred !== undefined) return preferred
  return [...projects].sort((left, right) =>
    Number(right.isActive) - Number(left.isActive)
    || right.drillholeCount - left.drillholeCount
    || left.name.localeCompare(right.name),
  )[0] ?? null
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof DataPoolError && error.status === 401
}

interface ProviderProps {
  children: ReactNode
  connectionSettings: ConnectionSettings
  connectionState: ConnectionState
  /** Called when the user explicitly requests sign-out. */
  onSignOut: () => void
  /** Called immediately when the Data Pool no longer accepts the session. */
  onSessionExpired: () => void
}

export function DataPoolWorkspaceProvider({ children, connectionSettings, connectionState, onSessionExpired, onSignOut }: ProviderProps) {
  const live = connectionState === 'connected'
  const client = useMemo(
    () => live ? createDataPoolClient(connectionSettings) : null,
    [connectionSettings, live],
  )
  // The last characters of the token separate one user's cached data from the next.
  const scope = `${connectionSettings.endpoint}#${connectionSettings.token.slice(-12)}`
  const [preferredId, setPreferredId] = useState<string | null>(
    () => window.localStorage.getItem(projectStorageKey),
  )
  const [localRecord, setLocalRecord] = useState<LocalProjectRecord | null>(null)
  const [loadedLocalKey, setLoadedLocalKey] = useState<string | null>(null)
  const [localRefreshing, setLocalRefreshing] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const projectsQuery = useQuery({
    queryKey: ['datapool', scope, 'projects'],
    queryFn: () => client === null ? [] : client.projects(),
    enabled: client !== null,
    retry: (count, error) => !isUnauthorized(error) && count < 1,
  })
  const sessionQuery = useQuery({
    queryKey: ['datapool', scope, 'session'],
    queryFn: () => client === null ? null : client.session(),
    enabled: client !== null,
    retry: false,
  })

  const expired = isUnauthorized(projectsQuery.error)
  useEffect(() => {
    if (expired) onSessionExpired()
  }, [expired, onSessionExpired])

  const selectProject = useCallback((projectId: string) => {
    window.localStorage.setItem(projectStorageKey, projectId)
    setPreferredId(projectId)
  }, [])

  const projects = projectsQuery.data ?? []
  const project = resolveActiveProject(projects, preferredId)
  const activeLocalKey = project === null ? null : localProjectKey(connectionSettings.endpoint, project.id)

  useEffect(() => {
    let cancelled = false
    setLocalError(null)
    setLoadedLocalKey(null)
    setLocalRecord(null)
    if (activeLocalKey === null) return () => { cancelled = true }
    void readLocalProjectRecord(activeLocalKey).then(async (stored) => {
      if (cancelled) return
      let next = stored
      const legacyWasMigrated = window.localStorage.getItem(legacyImportMigrationKey) === 'true'
      const legacy = (stored === null || stored.draft === null) && !legacyWasMigrated ? readDrillholeImport() : undefined
      if (legacy !== undefined) {
        next = { draft: createLocalDrillholeDraft(legacy), key: activeLocalKey, snapshot: stored?.snapshot ?? null, tabularDrafts: stored?.tabularDrafts ?? {} }
        await writeLocalProjectRecord(next)
        window.localStorage.setItem(legacyImportMigrationKey, 'true')
      }
      if (cancelled) return
      setLocalRecord(next ?? { draft: null, key: activeLocalKey, snapshot: null, tabularDrafts: {} })
      setLoadedLocalKey(activeLocalKey)
    }).catch(() => {
      if (cancelled) return
      setLocalError('The local project database could not be opened.')
      setLocalRecord({ draft: null, key: activeLocalKey, snapshot: null, tabularDrafts: {} })
      setLoadedLocalKey(activeLocalKey)
    })
    return () => { cancelled = true }
  }, [activeLocalKey])

  const refreshLocalProject = useCallback(async () => {
    if (client === null || project === null || activeLocalKey === null) return
    setLocalRefreshing(true)
    setLocalError(null)
    try {
      const snapshot = await loadLocalProjectSnapshot(client, project)
      const next = { draft: localRecord?.draft ?? null, key: activeLocalKey, snapshot, tabularDrafts: localRecord?.tabularDrafts ?? {} }
      await writeLocalProjectRecord(next)
      setLocalRecord(next)
      setLoadedLocalKey(activeLocalKey)
    } catch {
      setLocalError('The Database could not refresh the local project copy. The previous local data is unchanged.')
    } finally {
      setLocalRefreshing(false)
    }
  }, [activeLocalKey, client, localRecord, project])

  const saveDrillholesLocally = useCallback(async (value: DrillholeImportResult) => {
    if (activeLocalKey === null) return
    const next: LocalProjectRecord = {
      draft: createLocalDrillholeDraft(value),
      key: activeLocalKey,
      snapshot: localRecord?.snapshot ?? null,
      tabularDrafts: localRecord?.tabularDrafts ?? {},
    }
    setLocalRecord(next)
    setLoadedLocalKey(activeLocalKey)
    setLocalError(null)
    await writeLocalProjectRecord(next)
  }, [activeLocalKey, localRecord])

  const saveTabularImportLocally = useCallback(async (value: TabularImportInput) => {
    if (activeLocalKey === null) return
    const next: LocalProjectRecord = {
      draft: localRecord?.draft ?? null,
      key: activeLocalKey,
      snapshot: localRecord?.snapshot ?? null,
      tabularDrafts: {
        ...(localRecord?.tabularDrafts ?? {}),
        [value.section]: createLocalTabularDraft(value),
      },
    }
    setLocalRecord(next)
    setLoadedLocalKey(activeLocalKey)
    setLocalError(null)
    await writeLocalProjectRecord(next)
  }, [activeLocalKey, localRecord])

  const publishLocalDrillholes = useCallback(async (): Promise<DrillholePublishReport> => {
    const snapshot = localRecord?.snapshot ?? null
    const draft = localRecord?.draft ?? null
    if (client === null || project === null || activeLocalKey === null || snapshot === null || draft === null) {
      return { collars: 0, problems: ['Refresh the local project copy before saving drillholes to the Database.'], stations: 0, surveys: 0, unknownHoles: [] }
    }
    if (!project.canWrite) {
      return { collars: 0, problems: ['Your role on this project is read-only.'], stations: 0, surveys: 0, unknownHoles: [] }
    }

    const plan = planDrillholePublish(draft, snapshot.drillholes)
    const problems = [...plan.rejected]
    let collarCount = 0
    let surveyCount = 0
    let stationCount = 0
    let drillholes = [...snapshot.drillholes]
    const surveysByHoleId = { ...snapshot.surveysByHoleId }

    for (const collar of plan.collars) {
      const imported = draft.collar.find((row) => row.holeId.trim().toLowerCase() === collar.holeName.trim().toLowerCase())
      const existing = snapshot.drillholes.find((hole) => hole.id === collar.holeId)
      const match = imported?.crs?.trim().match(/^([a-z][a-z0-9_-]*)\s*[: ]\s*([a-z0-9._-]+)$/i)
      const crs = match === null || match === undefined
        ? existing?.collar === null || existing?.collar === undefined ? null : existing.collar.crs
        : { authority: match[1]!.toUpperCase(), code: match[2]! }
      if (crs === null) {
        problems.push(`${collar.holeName}: a CRS such as EPSG:32648 is required before saving the collar`)
        continue
      }
      try {
        const saved = await client.saveCollar(project.id, collar.holeId, {
          crs,
          easting: collar.easting,
          elevation: collar.elevation,
          northing: collar.northing,
          source: 'GeoEye Analytics local import',
        })
        drillholes = drillholes.map((hole) => hole.id === collar.holeId ? { ...hole, collar: saved } : hole)
        collarCount += 1
      } catch {
        problems.push(`${collar.holeName}: the Database rejected the collar`)
      }
    }

    for (const survey of plan.surveys) {
      try {
        const saved = await client.replaceSurveys(project.id, survey.holeId, {
          stations: survey.stations.map((station) => ({ ...station, source: 'GeoEye Analytics local import' })),
        })
        surveysByHoleId[survey.holeId] = saved
        drillholes = drillholes.map((hole) => hole.id === survey.holeId ? { ...hole, surveyStationCount: saved.length } : hole)
        surveyCount += 1
        stationCount += saved.length
      } catch {
        problems.push(`${survey.holeName}: the Database rejected the survey`)
      }
    }

    const dirty = problems.length > 0 || plan.unknownHoles.length > 0
    const next: LocalProjectRecord = {
      draft: { ...draft, dirty, updatedAt: new Date().toISOString() },
      key: activeLocalKey,
      snapshot: { ...snapshot, drillholes, refreshedAt: new Date().toISOString(), surveysByHoleId },
      tabularDrafts: localRecord?.tabularDrafts ?? {},
    }
    await writeLocalProjectRecord(next)
    setLocalRecord(next)
    return { collars: collarCount, problems, stations: stationCount, surveys: surveyCount, unknownHoles: plan.unknownHoles }
  }, [activeLocalKey, client, localRecord, project])

  const publishLocalTabularImport = useCallback(async (section: TabularImportSection): Promise<TabularImportResult> => {
    const draft = localRecord?.tabularDrafts?.[section]
    if (client === null || project === null || activeLocalKey === null || draft === undefined) {
      throw new Error('Import a CSV locally before saving it to the Database.')
    }
    if (!project.canWrite) throw new Error('Your role on this project is read-only.')
    const result = await client.saveTabularImport(project.id, draft)
    const next: LocalProjectRecord = {
      draft: localRecord?.draft ?? null,
      key: activeLocalKey,
      snapshot: localRecord?.snapshot ?? null,
      tabularDrafts: {
        ...(localRecord?.tabularDrafts ?? {}),
        [section]: { ...draft, dirty: false, updatedAt: new Date().toISOString() },
      },
    }
    await writeLocalProjectRecord(next)
    setLocalRecord(next)
    return result
  }, [activeLocalKey, client, localRecord, project])

  const value = useMemo<DataPoolWorkspace>(() => {
    if (client === null) return demoWorkspace
    return {
      live: true,
      client,
      scope,
      session: sessionQuery.data ?? null,
      projects,
      project,
      projectsLoading: projectsQuery.isPending,
      projectsError: projectsQuery.error === null ? null : 'Projects could not be loaded from the Database',
      localSnapshot: localRecord?.snapshot ?? null,
      localDrillholeDraft: localRecord?.draft ?? null,
      localTabularDrafts: localRecord?.tabularDrafts ?? {},
      localLoading: activeLocalKey !== null && loadedLocalKey !== activeLocalKey,
      localRefreshing,
      localError,
      refreshLocalProject,
      saveDrillholesLocally,
      saveTabularImportLocally,
      publishLocalDrillholes,
      publishLocalTabularImport,
      selectProject,
      signOut: onSignOut,
    }
  }, [activeLocalKey, client, loadedLocalKey, localError, localRecord, localRefreshing, onSignOut, project, projects, projectsQuery.error, projectsQuery.isPending, publishLocalDrillholes, publishLocalTabularImport, refreshLocalProject, saveDrillholesLocally, saveTabularImportLocally, scope, selectProject, sessionQuery.data])

  return <DataPoolWorkspaceContext.Provider value={value}>{children}</DataPoolWorkspaceContext.Provider>
}

export function useDataPoolWorkspace(): DataPoolWorkspace {
  return useContext(DataPoolWorkspaceContext)
}
