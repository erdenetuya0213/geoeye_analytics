import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { EngineStatus } from '../desktop/bridge.js'
import { callEngine, engineStatus, type EngineProvider } from '../analysis/engineClient.js'

interface State { status: EngineStatus | null; providers: EngineProvider[]; error: string | null; pending: boolean }

export function EngineStatusPanel() {
  const [state, setState] = useState<State>({ status: null, providers: [], error: null, pending: true })
  const refresh = async () => {
    setState((s) => ({ ...s, pending: true }))
    const status = await engineStatus()
    if (!status.running) { setState({ status, providers: [], error: status.error, pending: false }); return }
    try { setState({ status, providers: await callEngine('engine.providers', {}), error: null, pending: false }) }
    catch (error) { setState({ status, providers: [], error: error instanceof Error ? error.message : String(error), pending: false }) }
  }
  useEffect(() => { void refresh() }, [])
  const { status, providers, error, pending } = state
  return (
    <div className="settings-content">
      <div className="settings-section-heading"><div><h3>Analytics engine</h3><p>Local Python engine used for variography, declustering and simulation.</p></div>
        <button className="scene-setting-reset" disabled={pending} onClick={() => { void refresh() }} type="button"><RefreshCw size={13} /> Refresh</button></div>
      <section className="scene-setting-group">
        <header><div><h4>{status?.running ? `Running · v${status.version} (${status.source})` : 'Not running'}</h4>{error ? <p role="alert">{error}</p> : null}</div></header>
        {providers.length > 0 ? (
          <table className="engine-providers"><thead><tr><th>Provider</th><th>Role</th><th>Status</th><th>Detail</th></tr></thead>
            <tbody>{providers.map((p) => <tr key={p.provider_id}><td>{p.display_name}{p.version ? ` ${p.version}` : ''}</td><td>{p.role}</td><td data-availability={p.availability}>{p.availability}</td><td>{p.detail}</td></tr>)}</tbody></table>
        ) : null}
      </section>
    </div>
  )
}
