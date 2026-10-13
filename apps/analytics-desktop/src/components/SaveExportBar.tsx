import { useState } from 'react'
import { Check, Save } from 'lucide-react'
import type { ExportFile } from '../desktop/bridge.js'
import { chartPng, saveExportFiles } from '../data/exportBundle.js'
import { useChartRegistry } from '../state/ChartRegistryContext.js'
import { useExportTarget } from '../state/ExportContext.js'
import { ExportDialog } from './ExportDialog.js'

export interface ExportTable { name: string; csv: () => string }
interface Props { disabled?: boolean; lineage?: () => unknown; summary: string; tables: ExportTable[] }

const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]+/g, ' ')

/** Page-level Save: every chart on screen (transparent PNG) + tables (CSV) + lineage (JSON) → <project>/export/<Feature>/, each file named before saving. */
export function SaveExportBar({ disabled = false, lineage, summary, tables }: Props) {
  const registry = useChartRegistry()
  const target = useExportTarget()
  const [pending, setPending] = useState<ExportFile[] | null>(null)
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'done' | 'error'; text: string }>({ kind: 'idle', text: '' })
  // Snapshot the screen when Save is pressed, then let the user name each file.
  const open = () => setPending([
    ...(registry?.snapshot() ?? []).map(({ chart, name }) => ({ dataUrl: chartPng(chart), kind: 'png' as const, name })),
    ...tables.map((table) => ({ contents: table.csv(), kind: 'csv' as const, name: label(table.name) })),
    ...(lineage ? [{ contents: JSON.stringify(lineage(), null, 2), kind: 'json' as const, name: 'Lineage' }] : []),
  ])
  const save = async (files: ExportFile[], names: string[]) => {
    setPending(null); setState({ kind: 'busy', text: 'Saving…' })
    try {
      const result = await saveExportFiles(target, files.map((file, index) => ({ ...file, name: names[index] ?? file.name })))
      setState({ kind: 'done', text: `${result.paths.length} files → ${result.directory}` })
    } catch (error) { setState({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) }
  }
  return <footer className={`domain-candidate-actions save-export-bar ${state.kind === 'done' ? 'is-saved' : ''}`}>
    <div><span className="domain-action-selection"><i /><strong>{summary}</strong>{state.text ? <small role="status">{state.text}</small> : null}</span></div>
    <button className="button button-accent" disabled={disabled || state.kind === 'busy'} onClick={open} title={`Save to ${target.folder}/export`} type="button">{state.kind === 'done' ? <Check size={14} /> : <Save size={14} />} Save</button>
    {pending !== null ? <ExportDialog items={pending} onCancel={() => setPending(null)} onConfirm={(names) => { void save(pending, names) }} target={target} title={`Save to ${target.folder}/export`} /> : null}
  </footer>
}
