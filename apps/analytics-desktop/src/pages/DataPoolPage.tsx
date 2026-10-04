import { FolderOpen, HardDrive } from 'lucide-react'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import type { ConnectionSettings, ConnectionState } from '../types.js'
import { LiveDataPoolPanel } from './LiveDataPoolPanel.js'
import { useDesktopWorkspace } from '../desktop/DesktopWorkspaceContext.js'
import { WorkspaceTransfers } from '../components/WorkspaceTransfers.js'

interface DataPoolPageProps {
  connectionSettings: ConnectionSettings
  connectionState: ConnectionState
}

export function DataPoolPage({ connectionState }: DataPoolPageProps) {
  const workspace = useDataPoolWorkspace()
  const desktop = useDesktopWorkspace()
  const variableCount = workspace.localSnapshot?.variables.length ?? null
  const filesystemPanel = desktop.isDesktop ? (
    <section className={`panel local-workspace-panel ${desktop.configured ? 'is-configured' : 'needs-folder'}`}>
      <div className="local-workspace-icon"><HardDrive size={22} /></div>
      <div className="local-workspace-copy">
        <p className="eyebrow">Windows local workspace</p>
        <h2>{desktop.configured ? 'Project files are stored on this computer' : 'Choose where GeoEye project files are stored'}</h2>
        <p>{desktop.rootPath ?? 'Database snapshots, imports, analysis results, and graph files will be written to a durable folder you control.'}</p>
      </div>
      <button className="button button-secondary" disabled={desktop.choosing} onClick={() => void desktop.chooseRoot()} type="button">
        <FolderOpen size={14} /> {desktop.choosing ? 'Opening…' : desktop.configured ? 'Change folder' : 'Choose folder'}
      </button>
    </section>
  ) : null

  if (workspace.live) {
    return (
      <div className="page data-pool-page data-pool-console">
        <h1 className="sr-only">Database</h1>
        <p className="pool-live-banner">
          <span className={`pool-connection-state ${workspace.connected ? 'is-connected' : ''}`}><i />{workspace.connected ? 'Database connected' : 'Local project'}{variableCount === null ? '' : ` · ${variableCount} variables`}</span>
          {workspace.projectsError !== null ? <span role="alert">{workspace.projectsError}</span> : null}
        </p>
        {filesystemPanel}
        <WorkspaceTransfers />
        {workspace.project === null ? (
          <section className="panel pool-sources-panel">
            <p className="pool-live-note">
              {workspace.projectsLoading
                ? 'Loading projects from the Database…'
                : 'This Database has no projects yet. Projects appear here once GeoEye Field creates them.'}
            </p>
          </section>
        ) : (
          <LiveDataPoolPanel
            connected={workspace.connected}
            draft={workspace.localDrillholeDraft}
            error={workspace.localError}
            onRefresh={workspace.refreshLocalProject}
            project={workspace.project}
            refreshing={workspace.localRefreshing}
            snapshot={workspace.localSnapshot}
          />
        )}
      </div>
    )
  }

  return (
    <div className="page data-pool-page data-pool-console">
      <h1 className="sr-only">Database</h1>
      {filesystemPanel}
      <section className="panel pool-sources-panel">
        <div className="eda-state">
          <strong>No project data is open.</strong>
          <span>{connectionState === 'checking'
            ? 'Checking the Database connection…'
            : 'Choose a workspace folder above to start importing and analyzing local data.'}</span>
        </div>
      </section>
    </div>
  )
}
