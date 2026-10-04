import { LogOut, X } from 'lucide-react'
import { useEffect } from 'react'

interface SignOutDialogProps {
  onCancel: () => void
  onConfirm: () => void
}

export function SignOutDialog({ onCancel, onConfirm }: SignOutDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}
      role="presentation"
    >
      <section
        aria-describedby="sign-out-description"
        aria-labelledby="sign-out-title"
        aria-modal="true"
        className="connection-dialog sign-out-dialog"
        role="alertdialog"
      >
        <div className="dialog-header">
          <div className="dialog-icon sign-out-dialog-icon"><LogOut aria-hidden="true" size={21} /></div>
          <div>
            <p className="eyebrow">Account</p>
            <h2 id="sign-out-title">Sign out?</h2>
          </div>
          <button aria-label="Cancel sign out" className="icon-button" onClick={onCancel} type="button">
            <X aria-hidden="true" size={19} />
          </button>
        </div>

        <div className="dialog-body sign-out-dialog-body">
          <p id="sign-out-description">You will need to enter your email and activation key to access this workspace again. Your local project files stay on this computer.</p>
        </div>

        <div className="dialog-footer">
          <span />
          <div className="dialog-footer-actions">
            <button autoFocus className="button button-ghost" onClick={onCancel} type="button">Cancel</button>
            <button className="button button-danger" onClick={onConfirm} type="button">Sign out</button>
          </div>
        </div>
      </section>
    </div>
  )
}
