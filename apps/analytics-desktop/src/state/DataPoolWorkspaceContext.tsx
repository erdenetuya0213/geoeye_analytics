import { DataPoolError, type DataPoolClient, type ProjectSummary, type Session, type TabularImportInput, type TabularImportResult, type TabularImportSection } from '@geoeye/datapool-client'
import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DrillholeImportResult } from '../components/DrillholeImportDialog.js'
import { createDataPoolClient } from '../data/dataPoolConnection.js'
import { readDrillholeImport } from '../data/drillholeImportStore.js'
import { planDrillholePublish } from '../data/drillholePublish.js'
import { drillholeSyncRequests } from '../data/syncOutbox.js'
import { useDesktopWorkspace } from '../desktop/DesktopWorkspaceContext.js'
import { appStorage } from '../desktop/runtime.js'
import { useOfflineLicense } from '../desktop/ActivationContext.js'
import { emptyOfflineProject } from '../data/offlineProject.js'
import { desktopBridge, type ImportSourceFile, type ProjectStorageAddress } from '../desktop/bridge.js'
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
  /** True when a project-backed workspace is open, including its offline local copy. */
  live: boolean
  /** True only while the Database session is available. */
  connected: boolean
  client: DataPoolClient | null
  /** Cache-key prefix that isolates queries per endpoint and signed-in user. */
  scope: string
  /** Native filesystem identity for the open project. */
  storageAddress: ProjectStorageAddress | null
  /** The signed-in user and their organizations; null while offline or signed out. */
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
  saveDrillholesLocally: (value: DrillholeImportResult, files?: ImportSourceFile[]) => Promise<void>
  saveTabularImportLocally: (value: TabularImportInput, files?: ImportSourceFile[]) => Promise<void>
  reloadLocalProject: () => Promise<void>
  publishLocalDrillholes: () => Promise<DrillholePublishReport>
  publishLocalTabularImport: (section: TabularImportSection) => Promise<TabularImportResult>
  selectProject: (projectId: string) => void
  signOut: () => void
}

const emptyWorkspace: DataPoolWorkspace = {
  live: false,
  connected: false,
  client: null,
  scope: 'signed-out',
  storageAddress: null,
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
  reloadLocalProject: async () => undefined,
  saveDrillholesLocally: async () => undefined,
  saveTabularImportLocally: async () => undefined,
  publishLocalDrillholes: async () => ({ collars: 0, problems: [], stations: 0, surveys: 0, unknownHoles: [] }),
  publishLocalTabularImport: async () => { throw new Error('Connect to the Database before saving an import.') },
  selectProject: () => undefined,
  signOut: () => undefined,
}

const DataPoolWorkspaceContext = createContext<DataPoolWorkspace>(emptyWorkspace)

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

/** Keeps the last local project usable when the Database session is unavailable. */
export function resolveWorkspaceProject(
  onlineProjects: readonly ProjectSummary[],
  preferredId: string | null,
  cachedProject: ProjectSummary | null,
): ProjectSummary | null {
  return resolveActiveProject(onlineProjects, preferredId) ?? cachedProject
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
  const desktopWorkspace = useDesktopWorkspace()
  const license = useOfflineLicense()
  const live = connectionState === 'connected'
  const client = useMemo(
    () => live ? createDataPoolClient(connectionSettings) : null,
    [connectionSettings, live],
  )
  const accountId = connectionSettings.accountId ?? license?.accountId ?? 'local'
  const offlineOnly = connectionSettings.accountId === undefined && license !== null
  const storageEndpoint = offlineOnly ? 'local' : connectionSettings.endpoint
  const scope = `${storageEndpoint}#${accountId}`
  const scopedProjectStorageKey = `${projectStorageKey}.${scope}`
  const [preferredId, setPreferredId] = useState<string | null>(
    () => {
      const stored = appStorage.getItem(scopedProjectStorageKey)
      if (stored !== null) return stored
      if (!offlineOnly) return appStorage.getItem(projectStorageKey)
      const id = crypto.randomUUID()
      appStorage.setItem(scopedProjectStorageKey, id)
      return id
    },
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
    appStorage.setItem(scopedProjectStorageKey, projectId)
    setPreferredId(projectId)
  }, [scopedProjectStorageKey])

  const onlineProjects = projectsQuery.data ?? []
  const onlineProject = resolveActiveProject(onlineProjects, preferredId)
  const activeProjectId = onlineProject?.id ?? preferredId
  const activeLocalKey = activeProjectId === null ? null : localProjectKey(storageEndpoint, activeProjectId, accountId)
  const legacyLocalKey = activeProjectId === null || offlineOnly ? null : `${connectionSettings.endpoint.replace(/\/$/, '').toLowerCase()}#${activeProjectId}`
  const storageAddress = useMemo<ProjectStorageAddress | null>(() => activeProjectId === null ? null : ({
    accountId,
    endpoint: storageEndpoint,
    projectId: activeProjectId,
    ...(offlineOnly ? { tenantId: null } : {}),
    ...(onlineProject === null || onlineProject === undefined ? {} : { tenantId: onlineProject.organizationId }),
  }), [accountId, activeProjectId, storageEndpoint, offlineOnly, onlineProject?.organizationId])

  useEffect(() => {
    let cancelled = false
    setLocalError(null)
    setLoadedLocalKey(null)
    setLocalRecord(null)
    if (activeLocalKey === null) return () => { cancelled = true }
    if (desktopWorkspace.isDesktop && !desktopWorkspace.configured) {
      setLocalError('Choose a workspace folder before opening or refreshing project data.')
      setLoadedLocalKey(activeLocalKey)
      return () => { cancelled = true }
    }
    void readLocalProjectRecord(activeLocalKey, storageAddress ?? undefined, legacyLocalKey ?? undefined).then(async (stored) => {
      if (cancelled) return
      let next = stored
      if (next === null && offlineOnly && activeProjectId !== null) {
        next = { key: activeLocalKey, snapshot: emptyOfflineProject(activeProjectId), draft: null, tabularDrafts: {} }
        await writeLocalProjectRecord(next, storageAddress ?? undefined)
      }
      const legacyWasMigrated = appStorage.getItem(legacyImportMigrationKey) === 'true'
      const legacy = !offlineOnly && (stored === null || stored.draft === null) && !legacyWasMigrated ? readDrillholeImport() : undefined
      if (legacy !== undefined) {
        next = { draft: createLocalDrillholeDraft(legacy), key: activeLocalKey, snapshot: stored?.snapshot ?? null, tabularDrafts: stored?.tabularDrafts ?? {} }
        await writeLocalProjectRecord(next, storageAddress ?? undefined)
        appStorage.setItem(legacyImportMigrationKey, 'true')
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
  }, [activeLocalKey, activeProjectId, offlineOnly, desktopWorkspace.configured, desktopWorkspace.isDesktop, desktopWorkspace.revision, legacyLocalKey, storageAddress])

  const cachedProject = localRecord?.snapshot?.project ?? null
  const project = resolveWorkspaceProject(onlineProjects, preferredId, cachedProject)
  const projects = client === null
    ? cachedProject === null ? [] : [cachedProject]
    : onlineProjects
  const localLoading = activeLocalKey !== null && loadedLocalKey !== activeLocalKey
  const projectWorkspaceOpen = client !== null || (preferredId !== null && (localLoading || localRecord !== null))
  const currentKey = useRef(activeLocalKey)
  currentKey.current = activeLocalKey
  const saveInProgress = useRef(false)
  const reloadLocalProject = useCallback(async () => {
    if (!activeLocalKey) return
    const record = await readLocalProjectRecord(activeLocalKey, storageAddress ?? undefined)
    if (currentKey.current === activeLocalKey) setLocalRecord(record)
  }, [activeLocalKey, storageAddress])

  const refreshLocalProject = useCallback(async () => {
    if (client === null || project === null || activeLocalKey === null) return
    if (desktopWorkspace.isDesktop && !desktopWorkspace.configured) {
      setLocalError('Choose a workspace folder before refreshing project data.')
      return
    }
    setLocalRefreshing(true)
    setLocalError(null)
    try {
      const snapshot = await loadLocalProjectSnapshot(client, project)
      const latest = await readLocalProjectRecord(activeLocalKey, storageAddress ?? undefined)
      const next = { draft: latest?.draft ?? null, key: activeLocalKey, snapshot, tabularDrafts: latest?.tabularDrafts ?? {} }
      await writeLocalProjectRecord(next, storageAddress ?? undefined)
      if (currentKey.current === activeLocalKey) {
        setLocalRecord(next)
        setLoadedLocalKey(activeLocalKey)
      }
    } catch {
      setLocalError('The Database could not refresh the local project copy. The previous local data is unchanged.')
    } finally {
      setLocalRefreshing(false)
    }
  }, [activeLocalKey, client, desktopWorkspace.configured, desktopWorkspace.isDesktop, localRecord, project, storageAddress])

  const saveDrillholesLocally = useCallback(async (value: DrillholeImportResult, files: ImportSourceFile[] = []) => {
    if (activeLocalKey === null || localLoading) throw new Error('Open a project and wait for its files before importing.')
    if (saveInProgress.current) throw new Error('Another import is being saved. Please wait and try again.')
    saveInProgress.current = true
    try {
    const latest = await readLocalProjectRecord(activeLocalKey, storageAddress ?? undefined)
    const next: LocalProjectRecord = {
      draft: createLocalDrillholeDraft(value),
      key: activeLocalKey,
      snapshot: latest?.snapshot ?? null,
      tabularDrafts: latest?.tabularDrafts ?? {},
    }
    await writeLocalProjectRecord(next, storageAddress ?? undefined)
    if (files.length && storageAddress) await desktopBridge()?.archiveImportFiles({ address: storageAddress, files })
    if (currentKey.current === activeLocalKey) {
      setLocalRecord(next)
      setLoadedLocalKey(activeLocalKey)
      setLocalError(null)
    }
    } catch (error) {
      if (currentKey.current === activeLocalKey) setLocalError('Import could not be fully saved. Keep the source files and retry.')
      throw error
    } finally { saveInProgress.current = false }
  }, [activeLocalKey, localLoading, localRecord, storageAddress])

  const saveTabularImportLocally = useCallback(async (value: TabularImportInput, files: ImportSourceFile[] = []) => {
    if (activeLocalKey === null || localLoading) throw new Error('Open a project and wait for its files before importing.')
    if (saveInProgress.current) throw new Error('Another import is being saved. Please wait and try again.')
    saveInProgress.current = true
    try {
    const latest = await readLocalProjectRecord(activeLocalKey, storageAddress ?? undefined)
    const next: LocalProjectRecord = {
      draft: latest?.draft ?? null,
      key: activeLocalKey,
      snapshot: latest?.snapshot ?? null,
      tabularDrafts: {
        ...(latest?.tabularDrafts ?? {}),
        [value.section]: createLocalTabularDraft(value),
      },
    }
    await writeLocalProjectRecord(next, storageAddress ?? undefined)
    if (files.length && storageAddress) await desktopBridge()?.archiveImportFiles({ address: storageAddress, files })
    if (currentKey.current === activeLocalKey) {
      setLocalRecord(next)
      setLoadedLocalKey(activeLocalKey)
      setLocalError(null)
    }
    } catch (error) {
      if (currentKey.current === activeLocalKey) setLocalError('Import could not be fully saved. Keep the source file and retry.')
      throw error
    } finally { saveInProgress.current = false }
  }, [activeLocalKey, localLoading, localRecord, storageAddress])

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
    const native = desktopBridge()
    if (native && storageAddress) {
      await native.enqueueSync({ address: storageAddress, entity: 'drillholes', version: draft.updatedAt, requests: drillholeSyncRequests(project.id, draft, snapshot) })
      const rows = await native.runSync({ address: storageAddress })
      await reloadLocalProject()
      const operation = rows.find(row => row.entity === 'drillholes' && row.version === draft.updatedAt)
      if (operation?.state !== 'sent') throw new Error(operation?.lastError ?? 'Transfer queued. Open Database → Sync pending imports to continue.')
      return { collars: plan.collars.length, surveys: plan.surveys.length, stations: plan.surveys.reduce((total, survey) => total + survey.stations.length, 0), problems: [], unknownHoles: [] }
    }
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
    await writeLocalProjectRecord(next, storageAddress ?? undefined)
    setLocalRecord(next)
    return { collars: collarCount, problems, stations: stationCount, surveys: surveyCount, unknownHoles: plan.unknownHoles }
  }, [activeLocalKey, client, localRecord, project, storageAddress, reloadLocalProject])

  const publishLocalTabularImport = useCallback(async (section: TabularImportSection): Promise<TabularImportResult> => {
    const draft = localRecord?.tabularDrafts?.[section]
    if (client === null || project === null || activeLocalKey === null || draft === undefined) {
      throw new Error('Import a CSV locally before saving it to the Database.')
    }
    if (!project.canWrite) throw new Error('Your role on this project is read-only.')
    const native = desktopBridge()
    if (native && storageAddress) {
      await native.enqueueSync({ address: storageAddress, entity: section, version: draft.updatedAt, requests: [{ path: `/v1/projects/${encodeURIComponent(project.id)}/tabular-imports`, method: 'POST', body: JSON.stringify({ section, fileName: draft.fileName, columns: draft.columns, rows: draft.rows }) }] })
      const rows = await native.runSync({ address: storageAddress })
      await reloadLocalProject()
      const operation = rows.find(row => row.entity === section && row.version === draft.updatedAt)
      if (operation?.state !== 'sent') throw new Error(operation?.lastError ?? 'Transfer queued. Open Database → Sync pending imports to continue.')
      return operation.result as TabularImportResult
    }
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
    await writeLocalProjectRecord(next, storageAddress ?? undefined)
    setLocalRecord(next)
    return result
  }, [activeLocalKey, client, localRecord, project, storageAddress, reloadLocalProject])

  const value = useMemo<DataPoolWorkspace>(() => {
    return {
      live: projectWorkspaceOpen,
      connected: client !== null,
      client,
      scope,
      storageAddress,
      session: sessionQuery.data ?? null,
      projects,
      project,
      projectsLoading: client === null ? false : projectsQuery.isPending,
      projectsError: client === null || projectsQuery.error === null ? null : 'Projects could not be loaded from the Database',
      localSnapshot: localRecord?.snapshot ?? null,
      localDrillholeDraft: localRecord?.draft ?? null,
      localTabularDrafts: localRecord?.tabularDrafts ?? {},
      localLoading,
      localRefreshing,
      localError,
      refreshLocalProject,
      reloadLocalProject,
      saveDrillholesLocally,
      saveTabularImportLocally,
      publishLocalDrillholes,
      publishLocalTabularImport,
      selectProject,
      signOut: onSignOut,
    }
  }, [client, localError, localLoading, localRecord, localRefreshing, onSignOut, project, projectWorkspaceOpen, projects, projectsQuery.error, projectsQuery.isPending, publishLocalDrillholes, publishLocalTabularImport, refreshLocalProject, reloadLocalProject, saveDrillholesLocally, saveTabularImportLocally, scope, selectProject, sessionQuery.data, storageAddress])

  return <DataPoolWorkspaceContext.Provider value={value}>{children}</DataPoolWorkspaceContext.Provider>
}

export function useDataPoolWorkspace(): DataPoolWorkspace {
  return useContext(DataPoolWorkspaceContext)
}
