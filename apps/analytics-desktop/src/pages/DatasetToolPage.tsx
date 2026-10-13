import { RowSelectionCheckbox } from '../components/RowSelectionCheckbox.js'
import { toggleRowSelection, toggleVisibleSelection } from '../data/rowSelection.js'
import type { TabularImportInput, TabularImportResult } from '@geoeye/datapool-client'
import { AlertCircle, CheckCircle2, Pencil, RefreshCw, Save, Search, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { usePersistentState } from '../state/persistentState.js'
import { databaseRows, type DatasetSection } from '../data/databaseRows.js'
import type { LocalDrillholeDraft, LocalProjectSnapshot, LocalTabularDraft } from '../data/localProjectDb.js'
import { parseTabularCsv } from '../data/tabularCsvImport.js'
import { readImportSource } from '../data/importSource.js'
export type { DatasetSection }

interface DatasetToolConfig {
  columns: readonly string[]
  rows: readonly (readonly string[])[]
  searchLabel: string
}

const configs: Record<DatasetSection, DatasetToolConfig> = {
  xrf: {
    searchLabel: 'XRF readings',
    columns: ['Reading', 'Hole ID', 'Depth', 'Cu ppm', 'Instrument'],
    rows: [],
  },
  spectral: {
    searchLabel: 'spectral scans',
    columns: ['Scan ID', 'Hole ID', 'Depth', 'Mineral', 'Score'],
    rows: [],
  },
}

export function DatasetToolPage({ section }: { section: DatasetSection }) {
  const workspace = useDataPoolWorkspace()
  if (!workspace.live) return <div className="page dataset-tool-page"><div className="eda-state panel">No local project data is open.</div></div>
  if (workspace.projectsLoading || workspace.localLoading) return <div className="page dataset-tool-page"><div className="eda-state panel">Opening the local project copy…</div></div>
  if (workspace.project === null) return <div className="page dataset-tool-page"><div className="eda-state panel">No project is available for this account.</div></div>
  return <LiveDatasetToolPage
    canWrite={workspace.connected && workspace.project.canWrite}
    drillholeDraft={workspace.localDrillholeDraft}
    importDraft={workspace.localTabularDrafts[section]}
    onPublish={() => workspace.publishLocalTabularImport(section)}
    onRefresh={workspace.refreshLocalProject}
    onSaveLocal={workspace.saveTabularImportLocally}
    refreshing={workspace.localRefreshing}
    section={section}
    snapshot={workspace.localSnapshot}
  />
}

export function DatasetToolWorkbench({ canWrite = true, config, emptyHint = 'Import your CSV or change the search.', header, importDraft, notice, noticeIsError = false, onChangeRows, onImport, onPublish, onRefresh, publishing = false, refreshing = false, section }: {
  canWrite?: boolean
  config: DatasetToolConfig
  emptyHint?: string
  /** Rendered above the toolbar, e.g. a summary or tabs. */
  header?: ReactNode
  importDraft?: LocalTabularDraft | undefined
  notice?: string | null
  noticeIsError?: boolean
  onChangeRows?: (rows: readonly (readonly string[])[]) => Promise<void>
  onImport?: (file: File) => Promise<void>
  onPublish?: () => Promise<void>
  onRefresh?: () => void
  publishing?: boolean
  refreshing?: boolean
  section: string
}) {
  const [query, setQuery] = usePersistentState(`datasetTool.${section}.query`, '')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [editValues, setEditValues] = useState<string[]>([])
  const [deleteIndexes, setDeleteIndexes] = useState<number[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setSelected(new Set()); setEditIndex(null); setDeleteIndexes(null) }, [config.rows])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const filteredRows = useMemo(() => config.rows.map((cells, index) => ({ cells, index })).filter(({ cells }) => cells.some(cell => cell.toLowerCase().includes(query.toLowerCase()))), [config.rows, query])
  const visible = filteredRows.map(row => row.index)
  const all = visible.length > 0 && visible.every(index => selected.has(index))
  const some = visible.some(index => selected.has(index))
  const rowStyle: CSSProperties = {
    gridTemplateColumns: `32px repeat(${config.columns.length}, minmax(110px, 1fr)) 80px`,
    minWidth: `${Math.max(600, config.columns.length * 122 + 112)}px`,
  }
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file !== undefined) void onImport?.(file)
  }
  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (editIndex === null || !onChangeRows) return
    setSaving(true); setError(null)
    try {
      await onChangeRows(config.rows.map((row, index) => index === editIndex ? editValues : row))
      setEditIndex(null); setSelected(new Set())
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The row could not be saved.') }
    finally { setSaving(false) }
  }
  const confirmDelete = async () => {
    if (!deleteIndexes || !onChangeRows) return
    setSaving(true); setError(null)
    try {
      const ids = new Set(deleteIndexes)
      await onChangeRows(config.rows.filter((_, index) => !ids.has(index)))
      setDeleteIndexes(null); setSelected(new Set())
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The rows could not be deleted.') }
    finally { setSaving(false) }
  }

  return (
    <div className="page dataset-tool-page">
      <h1 className="sr-only">{config.searchLabel}</h1>
      {header}
      <div className="filter-bar drillhole-control-bar dataset-control-bar">
        <label className="table-search"><Search size={16} /><input aria-label={`Search ${config.searchLabel}`} onChange={event => setQuery(event.target.value)} placeholder={`Search ${config.searchLabel}…`} value={query} /></label>
        <label className="dataset-select-all"><RowSelectionCheckbox checked={all} mixed={some && !all} disabled={saving || visible.length === 0} label={`Select all shown ${config.searchLabel}`} onChange={() => setSelected(current => toggleVisibleSelection(current, visible))} /> Select all</label>
        <span className="result-count">{filteredRows.length} shown</span>
        {selected.size > 0 ? <><span className="result-count">{selected.size} selected</span><button className="button button-secondary" disabled={saving || !onChangeRows} onClick={() => { setError(null); setDeleteIndexes([...selected]) }} type="button"><Trash2 size={15} /> Delete selected</button><button className="button button-secondary" disabled={saving} onClick={() => setSelected(new Set())} type="button">Clear selection</button></> : null}
        {notice == null ? null : <span className={`strength-save-notice ${noticeIsError ? 'is-error' : ''}`} role={noticeIsError ? 'alert' : 'status'}>{noticeIsError ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />} {notice}</span>}
        {onRefresh ? <button className="button button-secondary" disabled={refreshing || saving} onClick={onRefresh} type="button"><RefreshCw className={refreshing ? 'spin' : ''} size={16} /> Refresh local copy</button> : null}
        <input accept=".csv,text/csv" aria-label={`Choose a ${section} CSV file`} className="sr-only" onChange={handleFile} ref={fileInputRef} type="file" />
        <button className="button button-secondary" disabled={saving} onClick={() => fileInputRef.current?.click()} type="button"><Upload size={16} /> Import CSV</button>
        {onPublish ? <button className="button button-primary" disabled={publishing || saving || !canWrite || importDraft?.dirty !== true} onClick={() => void onPublish()} title={!canWrite ? 'Connect with write access to save to the Database' : 'Save local changes to the Database'} type="button"><Save size={16} /> {publishing ? 'Saving…' : 'Save to Database'}</button> : null}
      </div>
      <section className="panel dataset-records-panel">
        <div className="dataset-record-table" role="table" aria-label={config.searchLabel}>
          <div className="dataset-record-row dataset-record-header" role="row" style={rowStyle}>
            <span className="dataset-row-checkbox"></span>{config.columns.map(column => <span key={column}>{column}</span>)}<span>Actions</span>
          </div>
          {filteredRows.map(({ cells, index }) => <div className={`dataset-record-row ${selected.has(index) ? 'is-selected' : ''}`} role="row" key={index} style={rowStyle}>
            <span className="dataset-row-checkbox"><RowSelectionCheckbox checked={selected.has(index)} disabled={saving} label={`Select ${section} row ${index + 1}`} onChange={() => setSelected(current => toggleRowSelection(current, index))} /></span>
            {cells.map((cell, column) => <span className={column === 0 ? 'dataset-record-key' : ''} title={cell} key={column}>{cell}</span>)}
            <span className="strength-row-actions"><button className="icon-button" aria-label={`Edit ${section} row ${index + 1}`} title="Edit" disabled={saving || !onChangeRows} onClick={() => { setEditIndex(index); setEditValues([...cells]); setError(null) }} type="button"><Pencil size={15} /></button><button className="icon-button" aria-label={`Delete ${section} row ${index + 1}`} title="Delete" disabled={saving || !onChangeRows} onClick={() => { setError(null); setDeleteIndexes([index]) }} type="button"><Trash2 size={15} /></button></span>
          </div>)}
          {filteredRows.length === 0 ? <div className="strength-empty"><strong>No matching records</strong><span>{emptyHint}</span></div> : null}
        </div>
      </section>
      {editIndex !== null ? <div className="dialog-backdrop"><form className="strength-dialog" role="dialog" aria-modal="true" aria-labelledby="dataset-edit-title" onSubmit={saveEdit}>
        <header className="strength-dialog-header"><h2 id="dataset-edit-title">Edit {section} record</h2><button className="icon-button" aria-label="Close record editor" disabled={saving} onClick={() => setEditIndex(null)} type="button"><X size={18} /></button></header>
        <div className="strength-form-grid dataset-edit-fields">{config.columns.map((column, index) => <label key={column}><span>{column}</span><input autoFocus={index === 0} value={editValues[index] ?? ''} onChange={event => setEditValues(current => current.map((cell, i) => i === index ? event.target.value : cell))} /></label>)}</div>
        {error ? <p className="strength-form-error" role="alert">{error}</p> : null}
        <footer className="strength-dialog-footer"><p>Changes update the local dataset.</p><div><button className="button button-secondary" disabled={saving} onClick={() => setEditIndex(null)} type="button">Cancel</button><button className="button button-primary" disabled={saving} type="submit">{saving ? 'Saving…' : 'Save changes'}</button></div></footer>
      </form></div> : null}
      {deleteIndexes ? <div className="dialog-backdrop"><section className="strength-dialog" role="dialog" aria-modal="true" aria-labelledby="dataset-delete-title">
        <header className="strength-dialog-header"><h2 id="dataset-delete-title">Delete {deleteIndexes.length} {section} records?</h2><button className="icon-button" aria-label="Close delete confirmation" disabled={saving} onClick={() => setDeleteIndexes(null)} type="button"><X size={18} /></button></header>
        <p className="strength-delete-description">The selected records will be removed from the local dataset.</p>
        {error ? <p className="strength-form-error" role="alert">{error}</p> : null}
        <footer className="strength-dialog-footer"><p>{deleteIndexes.length} records selected</p><div><button className="button button-secondary" disabled={saving} onClick={() => setDeleteIndexes(null)} type="button">Cancel</button><button className="button button-accent" disabled={saving} onClick={() => void confirmDelete()} type="button">{saving ? 'Deleting…' : 'Delete records'}</button></div></footer>
      </section></div> : null}
    </div>
  )
}

function LiveDatasetToolPage({ canWrite, drillholeDraft, importDraft, onPublish, onRefresh, onSaveLocal, refreshing, section, snapshot }: {
  canWrite: boolean
  drillholeDraft: LocalDrillholeDraft | null
  importDraft?: LocalTabularDraft | undefined
  onPublish: () => Promise<TabularImportResult>
  onRefresh: () => Promise<void>
  onSaveLocal: (value: TabularImportInput, files?: import('../desktop/bridge.js').ImportSourceFile[]) => Promise<void>
  refreshing: boolean
  section: DatasetSection
  snapshot: LocalProjectSnapshot | null
}) {
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const config = useMemo<DatasetToolConfig>(() => {
    if (importDraft !== undefined) return { columns: importDraft.columns, rows: importDraft.rows, searchLabel: configs[section].searchLabel }
    const derived = databaseRows(section, snapshot, drillholeDraft)
    return derived.columns.length === 0 ? { ...configs[section], rows: [] } : { ...derived, searchLabel: configs[section].searchLabel }
    }, [drillholeDraft, importDraft, section, snapshot])

  const importFile = async (file: File) => {
    try {
      const source = await readImportSource(file)
      const parsed = parseTabularCsv(source.contents, file.name, section)
      await onSaveLocal(parsed, [source])
      setNoticeIsError(false)
      setNotice(`${parsed.rows.length.toLocaleString()} rows imported locally; Database unchanged`)
    } catch (error) {
      setNoticeIsError(true)
      setNotice(error instanceof Error ? error.message : 'The CSV could not be imported.')
    }
  }

  const saveRows = async (rows: readonly (readonly string[])[]) => {
    try {
      await onSaveLocal({ section, fileName: importDraft?.fileName ?? `${section}-local-records.csv`, columns: [...config.columns], rows: rows.map(row => [...row]) })
      setNoticeIsError(false)
      setNotice('Changes saved locally; Save to Database to publish them.')
    } catch (error) {
      setNoticeIsError(true)
      setNotice(error instanceof Error ? error.message : 'The changes could not be saved.')
      throw error
    }
  }

  const publish = async () => {
    setPublishing(true)
    try {
      const result = await onPublish()
      setNoticeIsError(false)
      const unmatched = result.unmatchedHoles.length === 0 ? '' : ` · ${result.unmatchedHoles.length} unmatched holes`
      setNotice(`Saved ${result.importedRows.toLocaleString()} rows to Database · v${result.version}${unmatched}`)
    } catch (error) {
      setNoticeIsError(true)
      setNotice(error instanceof Error ? error.message : 'The local import could not be saved to the Database.')
    } finally {
      setPublishing(false)
    }
  }

  return <DatasetToolWorkbench canWrite={canWrite} config={config} onChangeRows={saveRows} importDraft={importDraft} notice={notice ?? (importDraft?.dirty === true ? 'Local CSV changes have not been saved to the Database.' : null)} noticeIsError={noticeIsError} onImport={importFile} onPublish={publish} onRefresh={() => { void onRefresh() }} publishing={publishing} refreshing={refreshing} section={section} />
}
