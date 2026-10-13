import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { EdaVariableDefinition } from '../data/edaTypes.js'

interface VariablePickerProps {
  variables: readonly EdaVariableDefinition[]
  selectedKeys: readonly string[]
  onToggle: (key: string) => void
  ariaLabel: string
  /** Trigger caption; the summary replaces the "<n> selected" text when given. */
  label?: string
  summary?: string
  minSelected?: number
  maxSelected?: number
  children?: ReactNode
}

export function VariablePicker({ variables, selectedKeys, onToggle, ariaLabel, label = 'Variables', summary, minSelected = 0, maxSelected, children }: VariablePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const selectedCount = variables.filter((item) => selectedKeys.includes(item.key)).length
  const visible = variables.filter((item) => `${item.shortLabel} ${item.label} ${item.unit}`.toLowerCase().includes(query.trim().toLowerCase()))

  useEffect(() => {
    if (!open) return
    search.current?.focus()
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return <div className="feature-picker" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <button aria-label={ariaLabel} aria-expanded={open} aria-controls={panelId} className="feature-picker-trigger" ref={trigger} onClick={() => { setOpen(!open); setQuery('') }} type="button">
      <span>{label}</span><strong>{summary ?? (selectedCount === 1 ? variables.find((item) => selectedKeys.includes(item.key))?.shortLabel : `${selectedCount} selected`)}</strong><ChevronDown size={14} />
    </button>
    {open ? <div className="feature-picker-panel" id={panelId}>
      <label className="feature-picker-search"><Search size={15} /><input aria-label="Search variables" placeholder="Search features…" ref={search} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="feature-picker-status">{selectedCount} selected{maxSelected ? ` · Choose 2–${maxSelected}` : ' · Choose one or more'}</div>
      <div className="feature-picker-options">
        {visible.map((item) => {
          const checked = selectedKeys.includes(item.key)
          const disabled = checked ? selectedCount <= minSelected : maxSelected !== undefined && selectedCount >= maxSelected
          return <label className={`feature-picker-option${checked ? ' is-selected' : ''}`} key={item.key}>
            <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(item.key)} />
            <span><strong>{item.shortLabel}</strong><small>{item.label}{item.unit ? ` · ${item.unit}` : ''}</small></span>
            {item.origin === 'derived' ? <em>Derived</em> : null}
          </label>
        })}
        {visible.length === 0 ? <p className="feature-picker-empty">No features match “{query}”.</p> : null}
        {children}
      </div>
      <div className="feature-picker-footer"><span>{maxSelected && selectedCount >= maxSelected ? 'Limit reached. Deselect a feature to add another.' : 'Click a row to toggle a feature.'}</span><button onClick={() => { setOpen(false); trigger.current?.focus() }} type="button">Done</button></div>
    </div> : null}
  </div>
}
