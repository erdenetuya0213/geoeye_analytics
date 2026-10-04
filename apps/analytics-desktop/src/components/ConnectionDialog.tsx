import { DataPoolError } from '@geoeye/datapool-client'
import { LoaderCircle, PlugZap, Server, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { checkDataPoolConnection, createDataPoolClient } from '../data/dataPoolConnection.js'
import { desktopBridge } from '../desktop/bridge.js'
import type { ConnectionSettings, ConnectionState } from '../types.js'

export type ConnectionDialogMode = 'connection' | 'sign-in'
interface ConnectionDialogProps {
  initialSettings: ConnectionSettings
  mode?: ConnectionDialogMode
  onClose: () => void
  onSave: (settings: ConnectionSettings, state: ConnectionState) => void
  required?: boolean
}

export function connectionErrorMessage(error: unknown): string {
  if (error instanceof DataPoolError) {
    if (error.status === 401 || error.status === 403) return 'The configured Database access is no longer valid. Ask your administrator to renew it. Your offline activation is unchanged.'
    if (error.status === 404) return 'The configured server does not expose the Analytics Database API. Ask your administrator to check the API address.'
  }
  return 'The configured Database API is unavailable. Start the local staging API or check your network, then retry. You can continue working offline.'
}

/** Connection uses administrator-provisioned access, never another password prompt. */
export function ConnectionDialog({ initialSettings, onClose, onSave, required = false }: ConnectionDialogProps) {
  const [settings, setSettings] = useState(initialSettings)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const configured = settings.managed === true || settings.token !== ''

  useEffect(() => {
    mounted.current = true
    const bridge = desktopBridge()
    if (bridge === undefined) { setLoading(false); return }
    void bridge.databaseConfiguration().then((configuration) => {
      if (!mounted.current || configuration === null) return
      setEmail(configuration.email)
      setSettings({ version: 1, endpoint: configuration.endpoint, accountId: configuration.accountId, managed: true, token: '' })
    }).catch((failure: unknown) => {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'The saved Database configuration could not be opened.')
    }).finally(() => { if (mounted.current) setLoading(false) })
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (required) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [busy, onClose, required])

  const connect = async () => {
    if (busy || loading || !configured) return
    setBusy(true)
    setError('')
    try {
      const [session] = await Promise.all([
        createDataPoolClient(settings).session(),
        checkDataPoolConnection(settings),
      ])
      if (session === null) throw new Error('The configured API must identify an authorized user.')
      if (!mounted.current) return
      onSave({ ...settings, accountId: session.user.id }, 'connected')
    } catch (failure) {
      if (mounted.current) setError(connectionErrorMessage(failure))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={required || busy ? undefined : onClose}>
      <section aria-busy={loading || busy} aria-labelledby="connection-title" aria-modal="true" className="connection-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="dialog-header">
          <div className="dialog-icon"><PlugZap size={21} /></div>
          <div><p className="eyebrow">Database</p><h2 id="connection-title">Configured connection</h2></div>
          {required ? null : <button aria-label="Close connection" className="icon-button" disabled={busy} onClick={onClose} type="button"><X size={19} /></button>}
        </div>
        <div className="dialog-body">
          <div className="local-node-card"><div className="node-icon"><Server size={19} /></div><div><strong>No additional sign-in required</strong><span>Analytics uses the API access configured for this Windows user. GeoEye Field authentication stays unchanged.</span></div></div>
          <div className="form-field"><span>API server</span><strong>{settings.endpoint || 'Not configured on this computer'}</strong></div>
          {email ? <div className="form-field"><span>Authorized account</span><strong>{email}</strong></div> : null}
          <p>Connect loads only the projects this account is permitted to access. Choose a local workspace folder to keep synchronized data and analysis results on this computer.</p>
          {!loading && !configured ? <div className="connection-result result-unavailable" role="status">An administrator must provision this computer’s API connection once. Do not enter database passwords or an activation key here.</div> : null}
          {error ? <div className="connection-result result-unavailable" role="alert"><XCircle size={17} /><span>{error}</span></div> : null}
        </div>
        <div className="dialog-footer"><span>{loading ? 'Reading protected configuration…' : 'Credentials stay in Windows-protected storage'}</span><div className="dialog-footer-actions">
          {required ? null : <button className="button button-ghost" disabled={busy} onClick={onClose} type="button">Close</button>}
          <button className="button button-primary" disabled={busy || loading || !configured} onClick={() => void connect()} type="button">{busy ? <LoaderCircle className="spin" size={15} /> : <PlugZap size={15} />} {busy ? 'Connecting…' : 'Connect'}</button>
        </div></div>
      </section>
    </div>
  )
}
