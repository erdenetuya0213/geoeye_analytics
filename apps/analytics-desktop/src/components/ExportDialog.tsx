import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ExportFile } from '../desktop/bridge.js'
import { suggestExportNames } from '../data/exportBundle.js'
import type { ExportTarget } from '../state/ExportContext.js'

export interface ExportItem { name: string; kind: ExportFile['kind'] }
interface Props { items: ExportItem[]; onCancel: () => void; onConfirm: (names: string[]) => void; target: ExportTarget; title: string }

/** Name every file before it is saved; each starts as "<graph name> <next free number>". */
export function ExportDialog({ items, onCancel, onConfirm, target, title }: Props) {
  const [names, setNames] = useState<string[] | null>(null)
  const [directory, setDirectory] = useState(`${target.folder}/export`)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    suggestExportNames(target, items)
      .then((result) => { if (live) { setNames(result.names); setDirectory(result.directory) } })
      .catch((reason: unknown) => { if (live) { setNames(items.map((item) => item.name)); setError(reason instanceof Error ? reason.message : String(reason)) } })
    return () => { live = false }
  }, [])
  const ready = names !== null && names.every((name) => name.trim() !== '')
  // Portal: a parent with backdrop-filter (the Save bar) would otherwise trap the fixed backdrop inside itself.
  return createPortal(<div className="filename-backdrop" onClick={onCancel} role="presentation">
    <form aria-labelledby="export-dialog-title" aria-modal="true" className="panel filename-dialog export-dialog" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (ready) onConfirm(names.map((name) => name.trim())) }} role="dialog">
      <h3 id="export-dialog-title">{title}</h3>
      <div className="export-name-list">
        {names === null ? <p>Naming…</p> : items.map((item, index) => <label key={index}><span className="sr-only">File name {index + 1}</span>
          <input autoFocus={index === 0} onChange={(event) => setNames(names.map((name, i) => i === index ? event.target.value : name))} onFocus={(event) => event.target.select()} value={names[index] ?? ''} /><em>.{item.kind}</em>
        </label>)}
      </div>
      <p>{error || `Saved to ${directory}`}</p>
      <div className="filename-actions"><button className="button button-secondary" onClick={onCancel} type="button">Cancel</button><button className="button button-accent" disabled={!ready} type="submit">Save</button></div>
    </form>
  </div>, document.body)
}
