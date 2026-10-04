import type { ProjectSummary } from '@geoeye/datapool-client'
import { ArrowRight, Check, CircleAlert, RefreshCw } from 'lucide-react'
import { effectiveDrillholes, type LocalDrillholeDraft, type LocalProjectSnapshot } from '../data/localProjectDb.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import type { SectionId } from '../types.js'

interface OverviewPageProps {
  onNavigate: (section: SectionId) => void
}

export function OverviewPage({ onNavigate }: OverviewPageProps) {
  const workspace = useDataPoolWorkspace()
  if (!workspace.live) return <div className="page overview-page"><div className="eda-state panel">No local project data is open.</div></div>
  if (workspace.projectsLoading || workspace.localLoading) return <div className="page overview-page"><div className="eda-state panel">Opening the local project copy…</div></div>
  if (workspace.project === null) return <div className="page overview-page"><div className="eda-state panel">No project is available for this account.</div></div>
  return <ProjectOverview draft={workspace.localDrillholeDraft} onNavigate={onNavigate} onRefresh={workspace.refreshLocalProject} project={workspace.project} refreshing={workspace.localRefreshing} snapshot={workspace.localSnapshot} />
}

function ProjectOverview({ draft, onNavigate, onRefresh, project, refreshing, snapshot }: {
  draft: LocalDrillholeDraft | null
  onNavigate: (section: SectionId) => void
  onRefresh: () => Promise<void>
  project: ProjectSummary
  refreshing: boolean
  snapshot: LocalProjectSnapshot | null
}) {
  const drillholes = effectiveDrillholes(snapshot, draft)
  const datasets = snapshot?.datasets ?? []
  const projection = snapshot?.projection ?? []
  const variables = snapshot?.variables ?? []
  const observationCount = snapshot?.observations.length ?? 0
  const issues = projection.reduce((sum, item) => sum + Object.values(item.issueSummary).reduce((subtotal, count) => subtotal + count, 0), 0)
  const withCollar = drillholes.filter((hole) => hole.collar !== null).length
  const surveyed = drillholes.filter((hole) => hole.surveyStationCount > 0).length

  return (
    <div className="page overview-page">
      <section aria-label="Project summary" className="supervisor-status-strip">
        <article className="supervisor-status-cell"><span>Drillholes</span><strong>{drillholes.length.toLocaleString()}</strong><small>{withCollar} collars · {surveyed} surveyed</small><em className="trend-neutral">Local</em></article>
        <article className="supervisor-status-cell"><span>Datasets</span><strong>{datasets.length.toLocaleString()}</strong><small>{variables.length} registered variables</small><em className="trend-neutral">Database</em></article>
        <article className="supervisor-status-cell"><span>Observations</span><strong>{observationCount.toLocaleString()}</strong><small>Normalized local records</small><em className="trend-up">Stored</em></article>
        <article className="supervisor-status-cell"><span>Projection issues</span><strong>{issues.toLocaleString()}</strong><small>{projection.filter((item) => item.lastStatus !== 'ok').length} failed sources</small><em className={issues > 0 ? 'trend-neutral' : 'trend-up'}>{issues > 0 ? 'Review' : 'Current'}</em></article>
      </section>

      <div className="supervisor-workbench">
        <section className="panel plot-matrix-panel">
          <div className="panel-heading workbench-heading">
            <div><p className="eyebrow">Local project copy</p><h2>{project.name}</h2></div>
            <button className="button button-small button-secondary" disabled={refreshing} onClick={() => void onRefresh()} type="button"><RefreshCw className={refreshing ? 'spin' : ''} size={14} /> Refresh local copy</button>
          </div>
          {snapshot === null ? <p className="pool-live-note">No local snapshot yet. Open Database and refresh this project before running analyses.</p> : <p className="pool-live-note">Snapshot saved {new Date(snapshot.refreshedAt).toLocaleString()}.</p>}
          <div className="pool-activity-table">
            <div className="pool-activity-row pool-activity-header"><span>Source</span><span>Rows</span><span>Observations</span><span>Issues</span><span>Status</span></div>
            {projection.map((item) => <div className="pool-activity-row" key={item.sourceEntityType}><span><strong>{item.sourceEntityType}</strong></span><span>{item.sourceRowCount.toLocaleString()}</span><span>{item.observationCount.toLocaleString()}</span><span>{Object.values(item.issueSummary).reduce((sum, count) => sum + count, 0).toLocaleString()}</span><span className={item.lastStatus === 'ok' ? 'pool-accepted' : 'validation-label needs-review'}>{item.lastStatus === 'ok' ? <Check size={13} /> : <CircleAlert size={13} />} {item.lastStatus === 'ok' ? 'Current' : 'Failed'}</span></div>)}
            {projection.length === 0 ? <p className="pool-live-note">No projection run has been recorded yet.</p> : null}
          </div>
        </section>

        <aside className="overview-inspector-column">
          <section className="panel diagnostics-panel">
            <div className="panel-heading compact-heading"><div><p className="eyebrow">Validation</p><h2>Project readiness</h2></div></div>
            <div className="diagnostic-list">
              <div><span><Check size={14} /> Collar coordinates</span><strong>{withCollar} / {drillholes.length}</strong></div>
              <div><span><Check size={14} /> Survey traces</span><strong>{surveyed} / {drillholes.length}</strong></div>
              <div className={issues > 0 ? 'has-warning' : ''}><span>{issues > 0 ? <CircleAlert size={14} /> : <Check size={14} />} Projection inputs</span><strong>{issues > 0 ? `${issues} issues` : 'Ready'}</strong></div>
            </div>
            <button className="card-link" onClick={() => onNavigate('data-pool')} type="button">Open Database <ArrowRight size={14} /></button>
          </section>
        </aside>
      </div>

      <section className="panel datasets-panel supervisor-datasets-panel">
        <div className="panel-heading"><div><p className="eyebrow">Database</p><h2>Project datasets</h2></div></div>
        <div className="dataset-table">
          <div className="dataset-row dataset-header"><span>Dataset</span><span>Support</span><span>Version</span><span>Status</span><span>Updated</span></div>
          {datasets.map((dataset) => <button className="dataset-row" key={dataset.id} onClick={() => onNavigate('data-pool')} type="button"><span className="dataset-name-cell"><i /><span><strong>{dataset.name}</strong><small>{dataset.producerName}</small></span></span><span><span className="support-tag">{dataset.spatialSupport}</span></span><span className="tabular">v{dataset.currentVersion}</span><span>{dataset.status}</span><span className="muted-cell">{new Date(dataset.updatedAt).toLocaleString()}</span></button>)}
          {datasets.length === 0 ? <p className="pool-live-note">No datasets are registered for this project yet.</p> : null}
        </div>
      </section>
    </div>
  )
}
