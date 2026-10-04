import type { ProjectSummary } from '@geoeye/datapool-client'
import { Check, CircleAlert, RefreshCw } from 'lucide-react'
import { effectiveDrillholes, type LocalDrillholeDraft, type LocalProjectSnapshot } from '../data/localProjectDb.js'

interface LiveDataPoolPanelProps {
  connected?: boolean
  draft: LocalDrillholeDraft | null
  error: string | null
  onRefresh: () => Promise<void>
  project: ProjectSummary
  refreshing: boolean
  snapshot: LocalProjectSnapshot | null
}

const sourceLabels: Record<string, string> = {
  'field.logging_structure': 'Field structural logging',
  'field.core_row': 'Field RQD',
}

const issueLabels: Record<string, string> = {
  unaccepted_source: 'not yet accepted in Field',
  invalid_value: 'unreadable value',
  invalid_depth: 'invalid depth',
  missing_value: 'no value',
  invalid_selections_json: 'unreadable selections',
  unknown_variable: 'unknown variable',
  invalid_binding: 'invalid binding',
  duplicate_binding: 'duplicate binding',
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return `${Math.round(hours / 24)} d ago`
}

function issueText(summary: Record<string, number>): string {
  const parts = Object.entries(summary)
    .filter(([, count]) => count > 0)
    .map(([code, count]) => `${count.toLocaleString('en-US')} ${issueLabels[code] ?? code}`)
  return parts.length === 0 ? 'No issues' : parts.join(' · ')
}

/** Live view of what the Data Pool holds for the active project. */
export function LiveDataPoolPanel({ connected = true, draft, error, onRefresh, project, refreshing, snapshot }: LiveDataPoolPanelProps) {
  const datasets = snapshot?.datasets ?? []
  const holes = effectiveDrillholes(snapshot, draft)
  const withCollar = holes.filter((hole) => hole.collar !== null).length
  const surveyed = holes.filter((hole) => hole.surveyStationCount > 0).length
  const statuses = snapshot?.projection ?? []
  const observationsByDataset = new Map(statuses.flatMap((status) =>
    status.datasetId === null ? [] : [[status.datasetId, status.observationCount] as const],
  ))

  return (
    <>
      <section className="panel pool-sources-panel">
        <div className="panel-heading pool-console-heading">
          <div><p className="eyebrow">{connected ? 'Field feed' : 'Local workspace'}</p><h2>{project.name}</h2></div>
          <div className="pool-console-actions">
            <span className="record-pill">{holes.length} drillholes · {withCollar} with collar · {surveyed} surveyed</span>
            <button className="button button-secondary" disabled={!connected || refreshing} onClick={() => void onRefresh()} title={connected ? undefined : 'Connect to the Database to refresh'} type="button">
              <RefreshCw className={refreshing ? 'spin' : ''} size={14} /> Refresh local copy
            </button>
          </div>
        </div>
        {error !== null ? <p className="pool-live-note is-error" role="alert"><CircleAlert size={14} /> {error}</p> : null}
        {snapshot !== null ? <p className="pool-live-note">Local snapshot saved {new Date(snapshot.refreshedAt).toLocaleString()}. All analytical features read this copy.</p> : <p className="pool-live-note">No local project snapshot yet. Refresh once to make the project available offline.</p>}
        <div className="pool-activity-table">
          <div className="pool-activity-row pool-activity-header"><span>Source</span><span>Field rows</span><span>Observations</span><span>Last sync</span><span>Status</span></div>
          {statuses.length === 0 ? (
            <p className="pool-live-note">No projection status is stored in the local snapshot.</p>
          ) : null}
          {statuses.map((status) => (
            <div className="pool-activity-row" key={status.sourceEntityType} title={status.lastError ?? issueText(status.issueSummary)}>
              <span><strong>{sourceLabels[status.sourceEntityType] ?? status.sourceEntityType}</strong></span>
              <span className="mono-value">{status.sourceRowCount.toLocaleString('en-US')}</span>
              <span>{status.observationCount.toLocaleString('en-US')} · {issueText(status.issueSummary)}</span>
              <span>{relativeTime(status.lastRunAt)}</span>
              {status.lastStatus === 'ok'
                ? <span className="pool-accepted"><Check size={13} /> Current</span>
                : <span className="validation-label needs-review"><CircleAlert size={13} /> Failed</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="panel pool-activity-panel">
        <div className="panel-heading pool-console-heading">
          <div><p className="eyebrow">Registry</p><h2>Datasets</h2></div>
          <span className="record-pill">{datasets.length} registered</span>
        </div>
        <div className="pool-activity-table">
          <div className="pool-activity-row pool-activity-header"><span>Producer</span><span>Dataset</span><span>Records</span><span>Updated</span><span>Status</span></div>
          {datasets.length === 0 ? (
            <p className="pool-live-note">No datasets are registered for this project.</p>
          ) : null}
          {datasets.map((dataset) => (
            <div className="pool-activity-row" key={dataset.id}>
              <span><strong>{dataset.producerName}</strong></span>
              <span>{dataset.name}</span>
              <span className="mono-value">
                {observationsByDataset.has(dataset.id) ? `${(observationsByDataset.get(dataset.id) ?? 0).toLocaleString('en-US')} · ` : ''}
                {dataset.spatialSupport} · v{dataset.currentVersion}
              </span>
              <span>{relativeTime(dataset.updatedAt)}</span>
              <span className="pool-accepted"><Check size={13} /> {dataset.status === 'active' ? 'Active' : 'Archived'}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
