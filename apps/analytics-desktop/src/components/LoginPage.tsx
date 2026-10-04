import { ArrowRight, CalendarClock, HardDrive, KeyRound, LoaderCircle, ShieldCheck, WifiOff, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { desktopBridge, type OfflineLicense } from '../desktop/bridge.js'

interface LoginPageProps {
  onActivated: (license: OfflineLicense) => void
  initialError?: string | null
}

/** Email-bound signed keys are checked in Electron, without contacting a server. */
export function LoginPage({ onActivated, initialError }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError ?? '')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const bridge = desktopBridge()
      if (bridge === undefined) throw new Error('Open the GeoEye Analytics Windows app to activate offline.')
      const result = await bridge.activateOffline({ email: email.trim(), key: key.trim() })
      if (!mounted.current) return
      if (result.license === null) { setError(result.error ?? 'The activation key could not be verified.'); return }
      setKey('')
      onActivated(result.license)
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Activation could not be verified. Try again.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-label="GeoEye Analytics local workspace">
        <div className="login-story-grid" />
        <header className="login-brand">
          <img alt="" className="login-brand-mark" src="./astro-geo-home.png" />
          <div><strong>GeoEye</strong><span>Analytics</span></div>
        </header>
        <div className="login-story-content">
          <p className="login-kicker">Windows desktop workspace</p>
          <h1>Your geological workspace,<br />available offline.</h1>
          <p className="login-story-copy">Use your email and activation key to open GeoEye Analytics. Your project files, analyses, and exports stay on this computer.</p>
          <ul className="login-benefits">
            <li><span className="login-benefit-icon"><WifiOff size={19} /></span><span><strong>No internet required</strong><small>Sign in and work wherever your project takes you.</small></span></li>
            <li><span className="login-benefit-icon"><HardDrive size={19} /></span><span><strong>Local project files</strong><small>You choose the folder for your data and results.</small></span></li>
            <li><span className="login-benefit-icon"><CalendarClock size={19} /></span><span><strong>Access until your expiry date</strong><small>Renew your key to continue when your license ends.</small></span></li>
          </ul>
        </div>
        <footer className="login-story-footer"><span className="login-local-status"><span /> Offline activation</span><span>GeoEye Analytics for Windows</span></footer>
      </section>
      <section className="login-form-panel" aria-label="Offline sign in">
        <div className="login-card">
          <div className="login-card-heading">
            <span className="login-card-icon"><KeyRound size={22} /></span>
            <div><p className="login-kicker">Your GeoEye license</p><h2 id="login-title">Sign in offline</h2></div>
          </div>
          <p className="login-card-intro">Enter the email address and activation key provided with your license.</p>
          <form aria-busy={busy} aria-labelledby="login-title" className="login-form" onSubmit={(event) => void signIn(event)}>
            <label className="login-field">
              <span>Email address</span>
              <input autoComplete="email" autoFocus disabled={busy} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required type="email" maxLength={320} value={email} />
            </label>
            <label className="login-field">
              <span>Activation key</span>
              <textarea aria-describedby="activation-help" autoComplete="off" autoCapitalize="none" disabled={busy} onChange={(event) => setKey(event.target.value)} placeholder="Paste your activation key" required spellCheck={false} maxLength={8192} rows={5} value={key} />
              <small id="activation-help">The key must match your email and be within its validity period.</small>
            </label>
            {error === '' ? null : <div className="login-error" role="alert"><XCircle size={18} /><span>{error}</span></div>}
            <button className="login-submit" disabled={busy} type="submit">
              {busy ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}
              <span>{busy ? 'Checking activation…' : 'Sign in offline'}</span>
              {busy ? null : <ArrowRight size={18} />}
            </button>
          </form>
          <p className="login-privacy-note"><ShieldCheck size={15} />Your key is verified on this computer and saved with Windows protection until you sign out or it expires.</p>
        </div>
      </section>
    </main>
  )
}
