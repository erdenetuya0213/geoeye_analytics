import {
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react'
import type { ProjectSummary } from '@geoeye/datapool-client'
import type { AnalyticalSeriesResult, VariogramAnalysisResult } from '../analysis/chartResults.js'
import { TechnicalPlot } from '../components/TechnicalPlot.js'
import { activities, datasets, projectMetrics } from '../data/demo.js'
import { effectiveDrillholes, type LocalDrillholeDraft, type LocalProjectSnapshot } from '../data/localProjectDb.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import type { SectionId } from '../types.js'

interface OverviewPageProps {
  onNavigate: (section: SectionId) => void
}

function analyticalSeries(id: string, values: readonly number[], bars?: readonly number[], comparison?: readonly number[]): AnalyticalSeriesResult {
  const points = (series: string, observations: readonly number[]) => observations.map((y, x) => ({
    sourceObservationIds: [`overview:${id}:${series}:${x}`],
    x,
    y,
  }))
  return {
    kind: 'analytical-series',
    series: [
      { name: 'Observed', points: points('observed', values), style: 'line' },
      ...(bars === undefined ? [] : [{ name: 'Volume', points: points('volume', bars), style: 'bar' as const }]),
      ...(comparison === undefined ? [] : [{ name: 'Reference', points: points('reference', comparison), style: 'line' as const }]),
    ],
  }
}

function variogramResult(experimental: readonly number[], model: readonly number[]): VariogramAnalysisResult {
  const sourceIds = experimental.map((_, index) => `overview:variogram:lag:${index}`)
  return {
    experimental: experimental.map((semivariance, index) => ({ lag: index * 24, semivariance, sourceObservationIds: [sourceIds[index]!] })),
    kind: 'variogram',
    model: model.map((semivariance, index) => ({ lag: index * 24, semivariance, sourceObservationIds: [sourceIds[index]!] })),
  }
}

const technicalPlots = [
  {
    title: 'Logging progression',
    subtitle: 'Metres logged by active shift',
    status: '4,862 m total',
    result: analyticalSeries('logging', [42, 48, 51, 58, 64, 69, 76, 82, 89, 94, 101, 108], [18, 26, 22, 33, 30, 42, 38, 46, 52, 49, 57, 62]),
    xTitle: 'Shift sequence',
    yTitle: 'Metres',
  },
  {
    title: 'Structural validation',
    subtitle: 'Accepted orientation observations',
    status: '94.6% accepted',
    result: analyticalSeries('structure', [30, 47, 39, 58, 51, 72, 68, 84, 77, 91, 88, 96], undefined, [27, 34, 41, 48, 55, 62, 69, 76, 83, 90, 97, 104]),
    xTitle: 'Observation batch',
    yTitle: 'Accepted (%)',
  },
  {
    title: 'Assay continuity',
    subtitle: 'Au ppm moving mean · 10 m window',
    status: '3,612 samples',
    result: analyticalSeries('assay', [18, 22, 38, 28, 54, 71, 49, 43, 66, 61, 76, 81], [16, 18, 31, 24, 47, 61, 42, 37, 56, 52, 64, 70]),
    xTitle: 'Distance (10 m windows)',
    yTitle: 'Au moving mean',
  },
  {
    title: 'Directional variogram',
    subtitle: 'J2 north-west set · normal score',
    status: 'Range 186 m',
    result: variogramResult([8, 23, 47, 66, 79, 87, 92, 96, 98, 99, 100, 100], [12, 31, 51, 67, 79, 87, 92, 95, 97, 98, 99, 100]),
    xTitle: 'Lag (m)',
    yTitle: 'Semivariance',
  },
]

export function OverviewPage({ onNavigate }: OverviewPageProps) {
  const workspace = useDataPoolWorkspace()
  if (workspace.live) {
    if (workspace.projectsLoading || workspace.localLoading) return <div className="page overview-page"><div className="eda-state panel">Opening the local project copy…</div></div>
    if (workspace.project === null) return <div className="page overview-page"><div className="eda-state panel">No project is available for this account.</div></div>
    return <LiveOverviewPage draft={workspace.localDrillholeDraft} onNavigate={onNavigate} onRefresh={workspace.refreshLocalProject} project={workspace.project} refreshing={workspace.localRefreshing} snapshot={workspace.localSnapshot} />
  }
  return <DemoOverviewPage onNavigate={onNavigate} />
}

function DemoOverviewPage({ onNavigate }: OverviewPageProps) {
  return (
    <div className="page overview-page">
      <section className="supervisor-status-strip" aria-label="Project summary">
        {projectMetrics.map((metric, index) => (
          <article className="supervisor-status-cell" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
            <em className={index === 2 ? 'trend-neutral' : 'trend-up'}>{metric.trend}</em>
          </article>
        ))}
      </section>

      <div className="supervisor-workbench">
        <section className="panel plot-matrix-panel">
          <div className="panel-heading workbench-heading">
            <div><p className="eyebrow">Validation workspace</p><h2>Project analytical trends</h2></div>
            <div className="workbench-heading-actions">
              <span><Clock3 size={13} /> Snapshot 08:42</span>
              <button className="button button-small button-secondary" type="button"><SlidersHorizontal size={14} /> Plot settings</button>
            </div>
          </div>
          <div className="technical-plot-grid">
            {technicalPlots.map((plot) => <TechnicalPlot key={plot.title} {...plot} />)}
          </div>
        </section>

        <aside className="overview-inspector-column">
          <section className="panel diagnostics-panel">
            <div className="panel-heading compact-heading"><div><p className="eyebrow">Run diagnostics</p><h2>Validation summary</h2></div></div>
            <div className="diagnostic-list">
              <div><span><Check size={14} /> Collar coordinates</span><strong>18 / 18</strong></div>
              <div><span><Check size={14} /> Survey traces</span><strong>17 / 18</strong></div>
              <div className="has-warning"><span><CircleAlert size={14} /> Orientation inputs</span><strong>42 flagged</strong></div>
              <div><span><Check size={14} /> Assay intervals</span><strong>3,612</strong></div>
            </div>
            <button className="card-link" onClick={() => onNavigate('structure')} type="button">Open validation workbench <ArrowRight size={14} /></button>
          </section>

          <section className="panel run-log-panel">
            <div className="panel-heading compact-heading"><div><p className="eyebrow">Run log</p><h2>Processing activity</h2></div></div>
            <div className="activity-list">
              {activities.slice(0, 3).map((activity) => (
                <div className="activity-item" key={activity.title}>
                  <span className={`activity-icon kind-${activity.kind}`}>
                    {activity.kind === 'alert' ? <CircleAlert size={14} /> : <RefreshCw size={14} />}
                  </span>
                  <div><strong>{activity.title}</strong><span>{activity.meta}</span></div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="panel datasets-panel supervisor-datasets-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Database</p><h2>Project datasets</h2></div>
          <button className="button button-small button-ghost" type="button"><RefreshCw size={14} /> Refresh</button>
        </div>
        <div className="dataset-table">
          <div className="dataset-row dataset-header">
            <span>Dataset</span><span>Support</span><span>Records</span><span>Quality</span><span>Updated</span>
          </div>
          {datasets.map((dataset) => (
            <button className="dataset-row" key={dataset.name} onClick={() => onNavigate('data-pool')} type="button">
              <span className="dataset-name-cell">
                <i style={{ backgroundColor: dataset.color }} />
                <span><strong>{dataset.name}</strong><small>{dataset.source}</small></span>
              </span>
              <span><span className="support-tag">{dataset.kind}</span></span>
              <span className="tabular">{dataset.records}</span>
              <span className="quality-cell"><span className="quality-track"><i style={{ width: `${dataset.quality}%` }} /></span>{dataset.quality}%</span>
              <span className="muted-cell">{dataset.freshness}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function LiveOverviewPage({ draft, onNavigate, onRefresh, project, refreshing, snapshot }: {
  draft: LocalDrillholeDraft | null
  onNavigate: (section: SectionId) => void
  onRefresh: () => Promise<void>
  project: ProjectSummary
  refreshing: boolean
  snapshot: LocalProjectSnapshot | null
}) {
  const drillholes = effectiveDrillholes(snapshot, draft)
  const liveDatasets = snapshot?.datasets ?? []
  const projection = snapshot?.projection ?? []
  const variables = snapshot?.variables ?? []
  const observationCount = projection.reduce((sum, item) => sum + item.observationCount, 0)
  const sourceCount = projection.reduce((sum, item) => sum + item.sourceRowCount, 0)
  const issues = projection.reduce((sum, item) => sum + Object.values(item.issueSummary).reduce((subtotal, count) => subtotal + count, 0), 0)
  const withCollar = drillholes.filter((hole) => hole.collar !== null).length
  const surveyed = drillholes.filter((hole) => hole.surveyStationCount > 0).length

  return (
    <div className="page overview-page">
      <section aria-label="Project summary" className="supervisor-status-strip">
        <article className="supervisor-status-cell"><span>Drillholes</span><strong>{drillholes.length.toLocaleString()}</strong><small>{withCollar} collars · {surveyed} surveyed</small><em className="trend-neutral">Live</em></article>
        <article className="supervisor-status-cell"><span>Datasets</span><strong>{liveDatasets.length.toLocaleString()}</strong><small>{variables.length} registered variables</small><em className="trend-neutral">Database</em></article>
        <article className="supervisor-status-cell"><span>Observations</span><strong>{observationCount.toLocaleString()}</strong><small>{sourceCount.toLocaleString()} source rows</small><em className="trend-up">Accepted</em></article>
        <article className="supervisor-status-cell"><span>Projection issues</span><strong>{issues.toLocaleString()}</strong><small>{projection.filter((item) => item.lastStatus !== 'ok').length} failed sources</small><em className={issues > 0 ? 'trend-neutral' : 'trend-up'}>{issues > 0 ? 'Review' : 'Current'}</em></article>
      </section>

      <div className="supervisor-workbench">
        <section className="panel plot-matrix-panel">
          <div className="panel-heading workbench-heading"><div><p className="eyebrow">Local project copy</p><h2>{project.name}</h2></div><button className="button button-small button-secondary" disabled={refreshing} onClick={() => void onRefresh()} type="button"><RefreshCw className={refreshing ? 'spin' : ''} size={14} /> Refresh local copy</button></div>
          {snapshot === null ? <p className="pool-live-note">No local snapshot yet. Refresh once before running project features.</p> : <p className="pool-live-note">Snapshot saved {new Date(snapshot.refreshedAt).toLocaleString()}.</p>}
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
              <div><span><Check size={14} /> Accepted observations</span><strong>{observationCount.toLocaleString()}</strong></div>
            </div>
            <button className="card-link" onClick={() => onNavigate('data-pool')} type="button">Open Database <ArrowRight size={14} /></button>
          </section>
        </aside>
      </div>

      <section className="panel datasets-panel supervisor-datasets-panel">
        <div className="panel-heading"><div><p className="eyebrow">Database</p><h2>Project datasets</h2></div></div>
        <div className="dataset-table">
          <div className="dataset-row dataset-header"><span>Dataset</span><span>Support</span><span>Version</span><span>Status</span><span>Updated</span></div>
          {liveDatasets.map((dataset) => <button className="dataset-row" key={dataset.id} onClick={() => onNavigate('data-pool')} type="button"><span className="dataset-name-cell"><i /><span><strong>{dataset.name}</strong><small>{dataset.producerName}</small></span></span><span><span className="support-tag">{dataset.spatialSupport}</span></span><span className="tabular">v{dataset.currentVersion}</span><span>{dataset.status}</span><span className="muted-cell">{new Date(dataset.updatedAt).toLocaleString()}</span></button>)}
          {liveDatasets.length === 0 ? <p className="pool-live-note">No datasets are registered for this project yet.</p> : null}
        </div>
      </section>
    </div>
  )
}
