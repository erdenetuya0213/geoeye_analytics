import { DataPoolError, type DataPoolClient, type ProjectSummary, type Session } from '@geoeye/datapool-client'
import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createDataPoolClient } from '../data/dataPoolConnection.js'
import type { ConnectionSettings, ConnectionState } from '../types.js'

const projectStorageKey = 'geoeye.analytics.project.v1'

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
  /** Called on sign-out and when the Data Pool no longer accepts the session. */
  onSignOut: () => void
}

export function DataPoolWorkspaceProvider({ children, connectionSettings, connectionState, onSignOut }: ProviderProps) {
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
    if (expired) onSignOut()
  }, [expired, onSignOut])

  const selectProject = useCallback((projectId: string) => {
    window.localStorage.setItem(projectStorageKey, projectId)
    setPreferredId(projectId)
  }, [])

  const value = useMemo<DataPoolWorkspace>(() => {
    if (client === null) return demoWorkspace
    const projects = projectsQuery.data ?? []
    return {
      live: true,
      client,
      scope,
      session: sessionQuery.data ?? null,
      projects,
      project: resolveActiveProject(projects, preferredId),
      projectsLoading: projectsQuery.isPending,
      projectsError: projectsQuery.error === null ? null : 'Projects could not be loaded from the Data Pool',
      selectProject,
      signOut: onSignOut,
    }
  }, [client, onSignOut, preferredId, projectsQuery.data, projectsQuery.error, projectsQuery.isPending, scope, selectProject, sessionQuery.data])

  return <DataPoolWorkspaceContext.Provider value={value}>{children}</DataPoolWorkspaceContext.Provider>
}

export function useDataPoolWorkspace(): DataPoolWorkspace {
  return useContext(DataPoolWorkspaceContext)
}
