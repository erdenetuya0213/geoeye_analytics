import type { ReactNode } from 'react'
import { useProjectEdaDatasets } from '../data/liveEda.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'

/** Keep the local analytical snapshot alive across feature navigation. */
export function LocalWorkspaceBootstrap({ children }: { children: ReactNode }) {
  const workspace = useDataPoolWorkspace()
  const datasets = useProjectEdaDatasets()
  if (workspace.projectsLoading || workspace.localLoading) return <div className="eda-state panel" role="status">Opening saved project files…</div>
  if (workspace.live && datasets.isPending) return <div className="eda-state panel" role="status">Preparing the local workspace…</div>
  return children
}
