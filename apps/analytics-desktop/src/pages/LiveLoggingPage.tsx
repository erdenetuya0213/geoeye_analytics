import type { FieldLoggingOverview, FieldLoggingSubmission, ProjectSummary } from '@geoeye/datapool-client'
import { CircleAlert, Gem, Layers3, Palette, RefreshCw, Search, Shield, Waypoints } from 'lucide-react'
import { useDeferredValue } from 'react'
import { usePersistentState } from '../state/persistentState.js'

interface LiveLoggingPageProps {
  onRefresh: () => Promise<void>
  overview: FieldLoggingOverview | null
  project: ProjectSummary
  refreshing: boolean
}

const templateIcons = [Layers3, Palette, Gem, Waypoints, Shield] as const

function coverage(submission: FieldLoggingSubmission): string {
  if (submission.depthFrom === null && submission.depthTo === null) return 'No depth interval'
  const from = submission.depthFrom ?? submission.depthTo ?? 0
  const to = submission.depthTo ?? submission.depthFrom ?? 0
  return `${from.toFixed(1)}–${to.toFixed(1)} m`
}

function relativeTime(value: string | null): string {
  if (value === null) return 'Unknown'
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return `${Math.round(hours / 24)} d ago`
}

function filledRecordCount(submission: FieldLoggingSubmission): number {
  return submission.selectedRowCount + submission.intervalCount + submission.structureCount
}

export function LiveLoggingPage({ onRefresh, overview, project, refreshing }: LiveLoggingPageProps) {
  const [activeTemplateId, setActiveTemplateId] = usePersistentState<string | null>('liveLogging.activeTemplateId', null, { scope: project.id })
  const [selectedKey, setSelectedKey] = usePersistentState<string | null>('liveLogging.selectedKey', null, { scope: project.id })
  const [query, setQuery] = usePersistentState('liveLogging.query', '', { scope: project.id })
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const templates = overview?.templates ?? []
  const submissions = overview?.submissions ?? []
  const activeTemplate = templates.find((template) => template.id === activeTemplateId) ?? templates[0] ?? null
  const filtered = submissions.filter((submission) => (
    submission.templateId === activeTemplate?.id
    && `${submission.holeName} ${submission.templateName}`.toLowerCase().includes(deferredQuery)
  ))
  const keyFor = (submission: FieldLoggingSubmission) => `${submission.holeId}:${submission.templateId}`
  const selected = filtered.find((submission) => keyFor(submission) === selectedKey) ?? filtered[0] ?? null

  const changeTemplate = (templateId: string) => {
    setActiveTemplateId(templateId)
    setSelectedKey(null)
  }

  return (
    <div className="page logging-page">
      <h1 className="sr-only">Field logging</h1>

      <nav aria-label="Logging templates" className="drillhole-view-tabs logging-template-tabs">
        {templates.map((template, index) => {
          const Icon = templateIcons[index % templateIcons.length] ?? Layers3
          const count = submissions.filter((submission) => submission.templateId === template.id).length
          return (
            <button aria-pressed={activeTemplate?.id === template.id} className={activeTemplate?.id === template.id ? 'is-active' : ''} key={template.id} onClick={() => changeTemplate(template.id)} type="button">
              <Icon size={17} /><span><strong>{template.name}</strong><small>{count} filled {count === 1 ? 'hole' : 'holes'} · v{template.version}</small></span>
            </button>
          )
        })}
      </nav>

      <div className="filter-bar drillhole-control-bar logging-control-bar">
        <label className="table-search"><Search size={16} /><input aria-label="Search logged holes" onChange={(event) => setQuery(event.target.value)} placeholder="Search logged holes…" value={query} /></label>
        <span className="result-count">{filtered.length} shown</span>
        <button className="button button-secondary" disabled={refreshing} onClick={() => void onRefresh()} type="button"><RefreshCw className={refreshing ? 'spin' : ''} size={16} /> Refresh local copy</button>
      </div>

      <div className="drillhole-layout logging-layout">
        <section className="panel drillhole-table-panel">
          <div className="logging-simple-table">
            <div className="logging-simple-row logging-simple-header"><span>Borehole</span><span>Coverage</span><span>Schema</span><span>Updated</span><span>Filled records</span></div>
            {overview === null ? <p className="pool-live-note"><CircleAlert size={14} /> No local Field logging snapshot yet. Choose Refresh local copy.</p> : null}
            {overview !== null && templates.length === 0 ? <p className="pool-live-note">{project.name} has no active logging templates.</p> : null}
            {overview !== null && activeTemplate !== null && filtered.length === 0 ? <p className="pool-live-note">No holes contain filled {activeTemplate.name} data.</p> : null}
            {filtered.map((submission) => {
              const submissionKey = keyFor(submission)
              return (
                <button className={`logging-simple-row ${submissionKey === (selected === null ? null : keyFor(selected)) ? 'is-selected' : ''}`} key={submissionKey} onClick={() => setSelectedKey(submissionKey)} type="button">
                  <span className="hole-id"><i />{submission.holeName}</span>
                  <span>{coverage(submission)}</span>
                  <span className="mono-value">v{submission.templateVersion}</span>
                  <span>{relativeTime(submission.updatedAt)}</span>
                  <span className="mono-value">{filledRecordCount(submission).toLocaleString('en-US')}</span>
                </button>
              )
            })}
          </div>
        </section>

        {selected === null ? (
          <aside className="panel logging-record-panel"><p className="pool-live-note">Select a filled template record.</p></aside>
        ) : (
          <aside className="panel logging-record-panel">
            <div className="hole-detail-heading"><div><p className="eyebrow">Selected logged hole</p><h2>{selected.holeName}</h2></div></div>
            <dl className="logging-record-details">
              <div><dt>Coverage</dt><dd>{coverage(selected)}</dd></div>
              <div><dt>Template schema</dt><dd>v{selected.templateVersion}</dd></div>
              <div><dt>Filled rows</dt><dd>{selected.selectedRowCount.toLocaleString('en-US')}</dd></div>
              <div><dt>Intervals</dt><dd>{selected.intervalCount.toLocaleString('en-US')}</dd></div>
              <div><dt>Structures</dt><dd>{selected.structureCount.toLocaleString('en-US')}</dd></div>
              <div><dt>Generated logs</dt><dd>{selected.generatedLogCount.toLocaleString('en-US')}</dd></div>
              <div><dt>Last updated</dt><dd>{relativeTime(selected.updatedAt)}</dd></div>
            </dl>
          </aside>
        )}
      </div>
    </div>
  )
}
