import { FolderOpen, HardDrive, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { readClassTables } from '../data/classTableStore.js'
import { projectSummaryGroups, type SummaryGroup } from '../data/projectSummary.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'
import { useDesktopWorkspace } from '../desktop/DesktopWorkspaceContext.js'
import { WorkspaceTransfers } from '../components/WorkspaceTransfers.js'
import type { ConnectionState } from '../types.js'

export function ProjectSummaryPanel({ groups, onRefresh, refreshing, title }: {
  groups: readonly SummaryGroup[]
  onRefresh?: () => void
  refreshing?: boolean
  title: string
}) {
  return (
    <section aria-label="Project summary" className="panel project-summary-panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        {onRefresh === undefined ? null : <button className="button button-secondary" disabled={refreshing} onClick={onRefresh} type="button"><RefreshCw className={refreshing === true ? 'spin' : ''} size={14} /> Refresh local copy</button>}
      </div>
      <div className="project-summary">
        {groups.map((group) => (
          <div className="summary-group" key={group.label}>
            <p className="eyebrow">{group.label}</p>
            {group.rows.map((row) => (
              <div className="summary-row" key={row.name} title={row.name}>
                <span>{row.name}</span>
                {row.note === undefined ? null : <small>{row.note}</small>}
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

export function DataPoolPage({ connectionState }: { connectionState: ConnectionState }) {
  const workspace = useDataPoolWorkspace()
  const desktop = useDesktopWorkspace()
  const storage = useProjectStorage()
  const { localDrillholeDraft, localSnapshot, localTabularDrafts } = workspace
  const groups = useMemo(() => projectSummaryGroups({
    drillholeDraft: localDrillholeDraft,
    lab: readClassTables(storage, 'laboratory'),
    snapshot: localSnapshot,
    strength: readClassTables(storage, 'strength'),
    xrfDraft: localTabularDrafts.xrf,
  }), [localDrillholeDraft, localSnapshot, localTabularDrafts.xrf, storage])

  const filesystemPanel = desktop.isDesktop ? (
    <section className={`panel local-workspace-panel ${desktop.configured ? 'is-configured' : 'needs-folder'}`}>
      <div className="local-workspace-icon"><HardDrive size={22} /></div>
      <div className="local-workspace-copy">
        {desktop.configured ? <p>{desktop.rootPath}</p> : <h2>Choose where GeoEye project files are stored</h2>}
      </div>
      <button className="button button-secondary" disabled={desktop.choosing} onClick={() => void desktop.chooseRoot()} type="button">
        <FolderOpen size={14} /> {desktop.choosing ? 'Opening…' : desktop.configured ? 'Change folder' : 'Choose folder'}
      </button>
    </section>
  ) : null

  return (
    <div className="page data-pool-page data-pool-console">
      <h1 className="sr-only">Database</h1>
      <p className="pool-live-banner">
        <span className={`pool-connection-state ${workspace.connected ? 'is-connected' : ''}`}><i />{workspace.connected ? 'Database connected' : 'Local project'}</span>
        {workspace.projectsError !== null ? <span role="alert">{workspace.projectsError}</span> : null}
      </p>
      {filesystemPanel}
      {workspace.live && workspace.project !== null ? (
        <>
          <ProjectSummaryPanel groups={groups} onRefresh={() => { void workspace.refreshLocalProject() }} refreshing={workspace.localRefreshing} title={workspace.project.name} />
          {workspace.localError === null ? null : <p className="pool-live-note is-error" role="alert">{workspace.localError}</p>}
          <WorkspaceTransfers />
        </>
      ) : (
        <section className="panel">
          <p className="pool-live-note">{workspace.projectsLoading || connectionState === 'checking' ? 'Opening the local project…' : 'No project data is open.'}</p>
        </section>
      )}
    </div>
  )
}
