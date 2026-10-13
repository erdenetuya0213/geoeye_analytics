import { useMemo } from 'react'
import { effectiveDrillholes } from '../data/localProjectDb.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { LiveLoggingPage } from './LiveLoggingPage.js'

export function LoggingPage() {
  const workspace = useDataPoolWorkspace()
  const { localDrillholeDraft, localSnapshot } = workspace
  const holeNames = useMemo(
    () => new Map(effectiveDrillholes(localSnapshot, localDrillholeDraft).map((hole) => [hole.id, hole.name])),
    [localDrillholeDraft, localSnapshot],
  )
  if (!workspace.live) return <div className="page logging-page"><div className="eda-state panel">No local project data is open.</div></div>
  if (workspace.projectsLoading || workspace.localLoading) return <div className="page logging-page"><div className="eda-state panel">Opening local core logging…</div></div>
  if (workspace.project === null) return <div className="page logging-page"><div className="eda-state panel">No project is available for this account.</div></div>
  return <LiveLoggingPage holeNames={holeNames} onRefresh={workspace.refreshLocalProject} overview={workspace.localSnapshot?.fieldLogging ?? null} project={workspace.project} refreshing={workspace.localRefreshing} />
}
