import { Filter, Gem, Layers3, Palette, RefreshCw, Search, Shield, Waypoints } from 'lucide-react'
import type { ComponentType } from 'react'
import { useMemo } from 'react'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { usePersistentState } from '../state/persistentState.js'
import { LiveLoggingPage } from './LiveLoggingPage.js'

interface LoggingSubmission {
  borehole: string
  campaign: string
  coverage: string
  id: string
  submitted: string
  template: LoggingTemplate
  version: string
}

type LoggingTemplate = 'Lithology' | 'Alteration' | 'Mineralisation' | 'Structure' | 'Geotechnical'

interface TemplateView {
  icon: ComponentType<{ size?: number }>
  label: LoggingTemplate
}

const submissions: readonly LoggingSubmission[] = [
  { id: 'LOG-018-LIT', campaign: 'RC-26-01', borehole: 'GOR-DD-018', template: 'Lithology', coverage: '0.0–412.6 m', version: 'v6.2', submitted: '8 min ago' },
  { id: 'LOG-017-LIT', campaign: 'RC-26-01', borehole: 'GOR-DD-017', template: 'Lithology', coverage: '0.0–368.2 m', version: 'v6.2', submitted: '2 hr ago' },
  { id: 'LOG-018-ALT', campaign: 'RC-26-01', borehole: 'GOR-DD-018', template: 'Alteration', coverage: '0.0–412.6 m', version: 'v4.1', submitted: '9 min ago' },
  { id: 'LOG-017-ALT', campaign: 'RC-26-01', borehole: 'GOR-DD-017', template: 'Alteration', coverage: '0.0–351.4 m', version: 'v4.1', submitted: '2 hr ago' },
  { id: 'LOG-018-MIN', campaign: 'RC-26-01', borehole: 'GOR-DD-018', template: 'Mineralisation', coverage: '0.0–412.6 m', version: 'v5.0', submitted: '11 min ago' },
  { id: 'LOG-017-MIN', campaign: 'RC-26-01', borehole: 'GOR-DD-017', template: 'Mineralisation', coverage: '0.0–368.2 m', version: 'v5.0', submitted: '2 hr ago' },
  { id: 'LOG-018-STR', campaign: 'RC-26-01', borehole: 'GOR-DD-018', template: 'Structure', coverage: '0.0–412.6 m', version: 'v6.0', submitted: '12 min ago' },
  { id: 'LOG-017-STR', campaign: 'RC-26-01', borehole: 'GOR-DD-017', template: 'Structure', coverage: '0.0–368.2 m', version: 'v6.0', submitted: '2 hr ago' },
  { id: 'LOG-018-GEO', campaign: 'RC-26-01', borehole: 'GOR-DD-018', template: 'Geotechnical', coverage: '0.0–412.6 m', version: 'v3.4', submitted: '14 min ago' },
  { id: 'LOG-017-GEO', campaign: 'RC-26-01', borehole: 'GOR-DD-017', template: 'Geotechnical', coverage: '0.0–368.2 m', version: 'v3.4', submitted: '2 hr ago' },
] as const

const templateViews: readonly TemplateView[] = [
  { label: 'Lithology', icon: Layers3 },
  { label: 'Alteration', icon: Palette },
  { label: 'Mineralisation', icon: Gem },
  { label: 'Structure', icon: Waypoints },
  { label: 'Geotechnical', icon: Shield },
]

export function LoggingPage() {
  const workspace = useDataPoolWorkspace()
  if (workspace.live && workspace.client !== null && workspace.project !== null) {
    return <LiveLoggingPage client={workspace.client} project={workspace.project} scope={workspace.scope} />
  }
  return <DemoLoggingPage />
}

function DemoLoggingPage() {
  const [activeTemplate, setActiveTemplate] = usePersistentState<LoggingTemplate>('logging.activeTemplate', 'Lithology')
  const [selectedId, setSelectedId] = usePersistentState<string>('logging.selectedId', 'LOG-018-LIT')
  const [query, setQuery] = usePersistentState('logging.query', '')

  const filtered = useMemo(() => submissions.filter((item) => (
    item.template === activeTemplate
    && `${item.borehole} ${item.campaign} ${item.id}`.toLowerCase().includes(query.toLowerCase())
  )), [activeTemplate, query])
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0]

  const changeTemplate = (template: LoggingTemplate) => {
    setActiveTemplate(template)
    setSelectedId(submissions.find((item) => item.template === template)?.id ?? '')
  }

  return (
    <div className="page logging-page">
      <h1 className="sr-only">Logging templates</h1>

      <nav aria-label="Logging templates" className="drillhole-view-tabs logging-template-tabs">
        {templateViews.map((item) => {
          const Icon = item.icon
          const count = submissions.filter((submission) => submission.template === item.label).length
          return (
            <button aria-pressed={activeTemplate === item.label} className={activeTemplate === item.label ? 'is-active' : ''} key={item.label} onClick={() => changeTemplate(item.label)} type="button">
              <Icon size={17} /><span><strong>{item.label}</strong><small>{count} submissions</small></span>
            </button>
          )
        })}
      </nav>

      <div className="filter-bar drillhole-control-bar logging-control-bar">
        <label className="table-search"><Search size={16} /><input aria-label="Search logging submissions" onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${activeTemplate.toLowerCase()}…`} value={query} /></label>
        <button className="filter-button" type="button"><Filter size={15} /> Campaign: RC-26-01</button>
        <span className="result-count">{filtered.length} shown</span>
        <button className="button button-secondary" type="button"><RefreshCw size={16} /> Sync Field</button>
      </div>

      <div className="drillhole-layout logging-layout">
        <section className="panel drillhole-table-panel">
          <div className="logging-simple-table">
            <div className="logging-simple-row logging-simple-header"><span>Borehole</span><span>Coverage</span><span>Schema</span><span>Submitted</span><span>Submission</span></div>
            {filtered.map((item) => (
              <button className={`logging-simple-row ${item.id === selected?.id ? 'is-selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)} type="button">
                <span className="hole-id"><i />{item.borehole}</span>
                <span>{item.coverage}</span>
                <span className="mono-value">{item.version}</span>
                <span>{item.submitted}</span>
                <span className="mono-value">{item.id}</span>
              </button>
            ))}
          </div>
        </section>

        {selected ? (
          <aside className="panel logging-record-panel">
            <div className="hole-detail-heading"><div><p className="eyebrow">Selected submission</p><h2>{selected.borehole}</h2></div><span className="record-pill">{selected.template}</span></div>
            <dl className="logging-record-details">
              <div><dt>Campaign</dt><dd>{selected.campaign}</dd></div>
              <div><dt>Coverage</dt><dd>{selected.coverage}</dd></div>
              <div><dt>Schema</dt><dd>{selected.version}</dd></div>
              <div><dt>Submitted</dt><dd>{selected.submitted}</dd></div>
              <div><dt>Submission</dt><dd className="mono-value">{selected.id}</dd></div>
            </dl>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
