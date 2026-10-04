import { DataPoolClient, DataPoolError } from '@geoeye/datapool-client'
import { LoaderCircle, LogIn, PlugZap, Server, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { demoWorkspaceAllowed } from '../data/demoPolicy.js'
import type { ConnectionSettings, ConnectionState } from '../types.js'

export type ConnectionDialogMode = 'connection' | 'sign-in'

interface ConnectionDialogProps {
  initialSettings: ConnectionSettings
  mode?: ConnectionDialogMode
  onClose: () => void
  onSave: (settings: ConnectionSettings, state: ConnectionState) => void
  /** Sign-in is the only way forward: no close button and no demo workspace. */
  required?: boolean
}

export function signInErrorMessage(error: unknown): string {
  if (error instanceof DataPoolError) {
    if (error.status === 401) return 'The email or password is incorrect.'
    if (error.status === 403) return 'Set a new password in GeoEye Field first, then sign in here.'
    if (error.status === 429) return 'Too many attempts. Try again in 15 minutes.'
    if (error.status === 404) return 'This server does not offer account sign-in.'
    return 'The Database could not complete the sign-in. Try again.'
  }
  return 'The Database could not be reached. Check the server address and your connection.'
}

/** Sign-in with a GeoEye account. The same accounts are used by GeoEye Field. */
export function ConnectionDialog({ initialSettings, mode = 'sign-in', onClose, onSave, required = false }: ConnectionDialogProps) {
  const [endpoint, setEndpoint] = useState(initialSettings.endpoint)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const connectionMode = mode === 'connection'

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (required) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, required])

  const signIn = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await new DataPoolClient({ endpoint }).login({ email, password })
      if (!mounted.current) return
      onSave({ version: 1, endpoint, token: result.accessToken }, 'connected')
    } catch (failure) {
      if (!mounted.current) return
      setError(signInErrorMessage(failure))
      setPassword('')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <div className={`dialog-backdrop ${required ? 'is-sign-in-gate' : ''}`} role="presentation" onMouseDown={required ? undefined : onClose}>
      <form
        aria-busy={busy}
        aria-labelledby="connection-title"
        aria-modal="true"
        className="connection-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void signIn(event)}
        role="dialog"
      >
        <div className="dialog-header">
          <div className="dialog-icon">{connectionMode ? <PlugZap size={21} /> : <LogIn size={21} />}</div>
          <div>
            <p className="eyebrow">{connectionMode ? 'Database' : 'GeoEye Analytics'}</p>
            <h2 id="connection-title">{connectionMode ? 'Connection' : 'Sign in'}</h2>
          </div>
          {required ? null : (
            <button aria-label={connectionMode ? 'Close connection' : 'Close sign-in'} className="icon-button" onClick={onClose} type="button">
              <X size={19} />
            </button>
          )}
        </div>

        <div className="dialog-body">
          <div className="local-node-card">
            <div className="node-icon"><Server size={19} /></div>
            <div>
              <strong>{connectionMode ? 'Connect to the Database' : 'Use your GeoEye account'}</strong>
              <span>{connectionMode ? 'Use your GeoEye account to open live project data' : 'The same email and password as GeoEye Field'}</span>
            </div>
          </div>

          <label className="form-field">
            <span>Email</span>
            <input autoComplete="username" autoFocus onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          <label className="form-field">
            <span>Server <em>change only if told to</em></span>
            <input onChange={(event) => setEndpoint(event.target.value)} required value={endpoint} />
          </label>

          {error === '' ? null : (
            <div className="connection-result result-unavailable" role="alert">
              <XCircle size={17} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="dialog-footer">
          {demoWorkspaceAllowed && !required ? (
            <button className="button button-ghost" onClick={() => onSave({ version: 1, endpoint, token: '' }, 'demo')} type="button">
              Use demo workspace
            </button>
          ) : <span />}
          <div className="dialog-footer-actions">
            {required ? null : (
              <button className="button button-ghost" onClick={onClose} type="button">
                Cancel
              </button>
            )}
            <button className="button button-primary" disabled={busy} type="submit">
              {busy ? <LoaderCircle className="spin" size={15} /> : null} {connectionMode ? 'Connect' : 'Sign in'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
