import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { LiveLoggingPage } from './LiveLoggingPage.js'

export function LoggingPage() {
  const workspace = useDataPoolWorkspace()
  if (!workspace.live) return <div className="page logging-page"><div className="eda-state panel">No local project data is open.</div></div>
  if (workspace.projectsLoading || workspace.localLoading) return <div className="page logging-page"><div className="eda-state panel">Opening local core logging…</div></div>
  if (workspace.project === null) return <div className="page logging-page"><div className="eda-state panel">No project is available for this account.</div></div>
  return <LiveLoggingPage onRefresh={workspace.refreshLocalProject} overview={workspace.localSnapshot?.fieldLogging ?? null} project={workspace.project} refreshing={workspace.localRefreshing} />
}
