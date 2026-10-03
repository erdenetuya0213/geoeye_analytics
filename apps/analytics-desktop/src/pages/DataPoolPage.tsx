import { ArrowRight, Check, Clock3, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState, type ComponentType } from 'react'
import {
  AssayIcon,
  FieldLoggingIcon,
  SpectralIcon,
  XrfIcon,
} from '../components/GeoEyeIcons.js'
import { checkDataPoolConnection } from '../data/dataPoolConnection.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import type { ConnectionSettings, ConnectionState } from '../types.js'
import { LiveDataPoolPanel } from './LiveDataPoolPanel.js'

interface DataPoolPageProps {
  connectionSettings: ConnectionSettings
  connectionState: ConnectionState
}

interface PoolSource {
  datasets: string
  freshness: string
  icon: ComponentType<{ className?: string; size?: number }>
  id: string
  label: string
  records: string
  type: string
}

const sources: readonly PoolSource[] = [
  { id: 'field', label: 'GeoEye Field', type: 'Logging sync', datasets: '5 templates', records: '90 submissions', freshness: '8 min ago', icon: FieldLoggingIcon },
  { id: 'lab', label: 'Laboratory', type: 'Assay import', datasets: '1 dataset', records: '3,612 records', freshness: 'Yesterday', icon: AssayIcon },
  { id: 'xrf', label: 'Portable XRF', type: 'Instrument import', datasets: '1 dataset', records: '1,946 records', freshness: 'Yesterday', icon: XrfIcon },
  { id: 'spectral', label: 'Core scanner', type: 'Spectral import', datasets: '1 dataset', records: '8,420 records', freshness: '2 days ago', icon: SpectralIcon },
]

const activity = [
  { source: 'GeoEye Field', event: 'Logging template set accepted', detail: 'GOR-DD-018 · 5 templates', time: '8 min' },
  { source: 'GeoEye Field', event: 'Lithology submission revised', detail: 'GOR-DD-017 · v6.2', time: '2 hr' },
  { source: 'Laboratory', event: 'Assay batch integrated', detail: 'ALS-24018 · 612 samples', time: '1 day' },
  { source: 'Portable XRF', event: 'Instrument file validated', detail: 'XRF-0912 · 284 readings', time: '1 day' },
] as const

export function DataPoolPage({ connectionSettings, connectionState }: DataPoolPageProps) {
  const connected = connectionState === 'connected'
  const workspace = useDataPoolWorkspace()
  const [variableCount, setVariableCount] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refreshRegistry = useCallback(async () => {
    if (!connected) return
    setRefreshing(true)
    try {
      setVariableCount(await checkDataPoolConnection(connectionSettings))
    } catch {
      setVariableCount(null)
    } finally {
      setRefreshing(false)
    }
  }, [connected, connectionSettings])

  useEffect(() => { void refreshRegistry() }, [refreshRegistry])

  if (workspace.live && workspace.client !== null) {
    return (
      <div className="page data-pool-page data-pool-console">
        <h1 className="sr-only">Data Pool</h1>
        <p className="pool-live-banner">
          <span className="pool-connection-state is-connected"><i />Data Pool connected{variableCount === null ? '' : ` · ${variableCount} variables`}</span>
          {workspace.projectsError !== null ? <span role="alert">{workspace.projectsError}</span> : null}
        </p>
        {workspace.project === null ? (
          <section className="panel pool-sources-panel">
            <p className="pool-live-note">
              {workspace.projectsLoading
                ? 'Loading projects from the Data Pool…'
                : 'This Data Pool has no projects yet. Projects appear here once GeoEye Field creates them.'}
            </p>
          </section>
        ) : (
          <LiveDataPoolPanel client={workspace.client} project={workspace.project} scope={workspace.scope} />
        )}
      </div>
    )
  }

  return (
    <div className="page data-pool-page data-pool-console">
      <h1 className="sr-only">Data Pool</h1>

      <section className="panel pool-sources-panel">
        <div className="panel-heading pool-console-heading">
          <div><p className="eyebrow">Sources</p><h2>Data connections</h2></div>
          <div className="pool-console-actions">
            <span className={`pool-connection-state ${connected ? 'is-connected' : ''}`}><i />{connected ? `Cloud connected${variableCount === null ? '' : ` · ${variableCount} variables`}` : 'Demo snapshot'}</span>
            <button className="button button-secondary" disabled={!connected || refreshing} onClick={() => void refreshRegistry()} type="button"><RefreshCw className={refreshing ? 'spin' : ''} size={14} /> Refresh</button>
          </div>
        </div>
        <div className="pool-source-grid">
          {sources.map((source) => {
            const SourceIcon = source.icon
            return (
              <button className="pool-source-card" key={source.id} type="button">
                <span className={`pool-source-icon source-${source.id}`}><SourceIcon className="geo-icon" size={24} /></span>
                <span className="pool-source-name"><small>{source.type}</small><strong>{source.label}</strong></span>
                <span className="pool-source-stat pool-source-scope"><small>Scope</small><strong>{source.datasets}</strong></span>
                <span className="pool-source-stat pool-source-volume"><small>Volume</small><strong>{source.records}</strong></span>
                <span className="pool-source-freshness"><Check size={14} /><span><small>Last accepted</small><strong>{source.freshness}</strong></span></span>
                <ArrowRight size={16} />
              </button>
            )
          })}
        </div>
      </section>

      <section className="panel pool-activity-panel">
        <div className="panel-heading pool-console-heading">
          <div><p className="eyebrow">Activity</p><h2>Recent ingestion</h2></div>
          <span className="record-pill">4 accepted</span>
        </div>
        <div className="pool-activity-table">
          <div className="pool-activity-row pool-activity-header"><span>Source</span><span>Event</span><span>Payload</span><span>Received</span><span>Status</span></div>
          {activity.map((item) => (
            <button className="pool-activity-row" key={`${item.source}-${item.event}`} type="button">
              <span><strong>{item.source}</strong></span>
              <span>{item.event}</span>
              <span className="mono-value">{item.detail}</span>
              <span><Clock3 size={13} /> {item.time}</span>
              <span className="pool-accepted"><Check size={13} /> Accepted</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
