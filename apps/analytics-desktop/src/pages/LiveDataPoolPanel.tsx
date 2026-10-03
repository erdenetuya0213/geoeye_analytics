import type { DataPoolClient, ProjectSummary } from '@geoeye/datapool-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleAlert, RefreshCw } from 'lucide-react'

interface LiveDataPoolPanelProps {
  client: DataPoolClient
  project: ProjectSummary
  scope: string
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
export function LiveDataPoolPanel({ client, project, scope }: LiveDataPoolPanelProps) {
  const queryClient = useQueryClient()
  const baseKey = ['datapool', scope, project.id] as const

  const datasets = useQuery({
    queryKey: [...baseKey, 'datasets'],
    queryFn: () => client.datasets(project.id),
  })
  const projection = useQuery({
    queryKey: [...baseKey, 'projection'],
    queryFn: () => client.projectionStatus(project.id),
  })
  const drillholes = useQuery({
    queryKey: [...baseKey, 'drillholes'],
    queryFn: () => client.drillholes(project.id),
  })

  const sync = useMutation({
    mutationFn: () => client.runProjection(project.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: baseKey }),
  })

  const holes = drillholes.data ?? []
  const withCollar = holes.filter((hole) => hole.collar !== null).length
  const surveyed = holes.filter((hole) => hole.surveyStationCount > 0).length
  const statuses = projection.data ?? []
  const observationsByDataset = new Map(statuses.flatMap((status) =>
    status.datasetId === null ? [] : [[status.datasetId, status.observationCount] as const],
  ))
  const failedSync = sync.data?.sources.filter((source) => source.outcome === 'failed') ?? []
  const loadFailed = datasets.isError || projection.isError || drillholes.isError

  return (
    <>
      <section className="panel pool-sources-panel">
        <div className="panel-heading pool-console-heading">
          <div><p className="eyebrow">Field feed</p><h2>{project.name}</h2></div>
          <div className="pool-console-actions">
            <span className="record-pill">{holes.length} drillholes · {withCollar} with collar · {surveyed} surveyed</span>
            <button className="button button-secondary" disabled={sync.isPending || !project.canWrite} onClick={() => sync.mutate()} title={project.canWrite ? undefined : 'Your role on this project is read-only'} type="button">
              <RefreshCw className={sync.isPending ? 'spin' : ''} size={14} /> Sync from Field
            </button>
          </div>
        </div>
        {loadFailed ? (
          <p className="pool-live-note is-error" role="alert"><CircleAlert size={14} /> The Data Pool did not return this project. Check the connection and try again.</p>
        ) : null}
        {sync.isError || failedSync.length > 0 ? (
          <p className="pool-live-note is-error" role="alert">
            <CircleAlert size={14} /> Sync failed{failedSync.length > 0 ? `: ${failedSync.map((source) => source.message ?? source.sourceEntityType).join('; ')}` : '.'}
          </p>
        ) : null}
        <div className="pool-activity-table">
          <div className="pool-activity-row pool-activity-header"><span>Source</span><span>Field rows</span><span>Observations</span><span>Last sync</span><span>Status</span></div>
          {statuses.length === 0 && !projection.isPending ? (
            <p className="pool-live-note">Nothing has been projected for this project yet. Choose Sync from Field to build the analytical read model.</p>
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
          <span className="record-pill">{(datasets.data ?? []).length} registered</span>
        </div>
        <div className="pool-activity-table">
          <div className="pool-activity-row pool-activity-header"><span>Producer</span><span>Dataset</span><span>Records</span><span>Updated</span><span>Status</span></div>
          {(datasets.data ?? []).length === 0 && !datasets.isPending ? (
            <p className="pool-live-note">No datasets are registered for this project.</p>
          ) : null}
          {(datasets.data ?? []).map((dataset) => (
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
