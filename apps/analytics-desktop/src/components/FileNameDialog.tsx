import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props { defaultName: string; detail: string; onCancel: () => void; onConfirm: (name: string) => void; title: string }

export function FileNameDialog({ defaultName, detail, onCancel, onConfirm, title }: Props) {
  const [name, setName] = useState(defaultName)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.select() }, [])
  // Portal: a parent with backdrop-filter (the Save bar) would otherwise trap the fixed backdrop inside itself.
  return createPortal(<div className="filename-backdrop" onClick={onCancel} role="presentation">
    <form className="panel filename-dialog" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (name.trim()) onConfirm(name.trim()) }} role="dialog" aria-modal="true" aria-labelledby="filename-title">
      <h3 id="filename-title">{title}</h3>
      <label><span>File name</span><input onChange={(e) => setName(e.target.value)} ref={input} value={name} /></label>
      <p>{detail}</p>
      <div className="filename-actions"><button className="button button-secondary" onClick={onCancel} type="button">Cancel</button><button className="button button-accent" disabled={name.trim() === ''} type="submit">Save</button></div>
    </form>
  </div>, document.body)
}
