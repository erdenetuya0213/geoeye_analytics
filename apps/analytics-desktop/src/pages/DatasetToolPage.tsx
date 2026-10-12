import { RowSelectionCheckbox } from '../components/RowSelectionCheckbox.js'
import { toggleRowSelection, toggleVisibleSelection } from '../data/rowSelection.js'
import type { ObservationValue, TabularImportInput, TabularImportResult, VariableDefinition } from '@geoeye/datapool-client'
import { AlertCircle, CheckCircle2, Pencil, RefreshCw, Save, Search, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { usePersistentState } from '../state/persistentState.js'
import { effectiveDrillholes, type LocalDrillholeDraft, type LocalProjectSnapshot, type LocalTabularDraft } from '../data/localProjectDb.js'
import { parseTabularCsv } from '../data/tabularCsvImport.js'
import { readImportSource } from '../data/importSource.js'
import type { SectionId } from '../types.js'

export type DatasetSection = Extract<SectionId, 'laboratory' | 'xrf' | 'spectral'>

interface DatasetToolConfig {
  columns: readonly string[]
  rows: readonly (readonly string[])[]
  searchLabel: string
}

const configs: Record<DatasetSection, DatasetToolConfig> = {
  laboratory: {
    searchLabel: 'laboratory samples',
    columns: ['Sample ID', 'Hole ID', 'From', 'To', 'Au g/t'],
    rows: [],
  },
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

export function DatasetToolWorkbench({ canWrite = true, config, importDraft, notice, noticeIsError = false, onChangeRows, onImport, onPublish, onRefresh, publishing = false, refreshing = false, section }: {
  canWrite?: boolean
  config: DatasetToolConfig
  importDraft?: LocalTabularDraft | undefined
  notice?: string | null
  noticeIsError?: boolean
  onChangeRows?: (rows: readonly (readonly string[])[]) => Promise<void>
  onImport?: (file: File) => Promise<void>
  onPublish?: () => Promise<void>
  onRefresh?: () => void
  publishing?: boolean
  refreshing?: boolean
  section: DatasetSection
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
      <div className="filter-bar drillhole-control-bar dataset-control-bar">
        <label className="table-search"><Search size={16} /><input aria-label={`Search ${config.searchLabel}`} onChange={event => setQuery(event.target.value)} placeholder={`Search ${config.searchLabel}…`} value={query} /></label>
        <label className="dataset-select-all"><RowSelectionCheckbox checked={all} mixed={some && !all} disabled={saving || visible.length === 0} label={`Select all shown ${config.searchLabel}`} onChange={() => setSelected(current => toggleVisibleSelection(current, visible))} /> Select all</label>
        <span className="result-count">{filteredRows.length} shown</span>
        {selected.size > 0 ? <><span className="result-count">{selected.size} selected</span><button className="button button-secondary" disabled={saving || !onChangeRows} onClick={() => { setError(null); setDeleteIndexes([...selected]) }} type="button"><Trash2 size={15} /> Delete selected</button><button className="button button-secondary" disabled={saving} onClick={() => setSelected(new Set())} type="button">Clear selection</button></> : null}
        {notice == null ? null : <span className={`strength-save-notice ${noticeIsError ? 'is-error' : ''}`} role={noticeIsError ? 'alert' : 'status'}>{noticeIsError ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />} {notice}</span>}
        <button className="button button-secondary" disabled={refreshing || saving} onClick={onRefresh} type="button"><RefreshCw className={refreshing ? 'spin' : ''} size={16} /> Refresh local copy</button>
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
          {filteredRows.length === 0 ? <div className="strength-empty"><strong>No matching records</strong><span>Import your CSV or change the search.</span></div> : null}
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

function supportsSection(section: DatasetSection, definition: VariableDefinition, sourceLabel: string): boolean {
  const haystack = `${definition.key} ${definition.displayName} ${sourceLabel}`.toLowerCase()
  if (section === 'laboratory') return /assay|laborator|geochem|sample/.test(haystack)
  if (section === 'xrf') return /(^|[. _-])xrf|fluorescence/.test(haystack)
  return /spectral|spectrum|specim|mineral/.test(haystack)
}

function displayObservationValue(observation: ObservationValue, _definition: VariableDefinition | undefined): string {
  const value = observation.numericValue
    ?? observation.categoryValue
    ?? observation.textValue
    ?? observation.booleanValue
    ?? observation.datetimeValue
  if (value === null) return '—'
  return String(value)
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
      const variables = snapshot?.variables ?? []
      const datasets = snapshot?.datasets ?? []
      const holes = effectiveDrillholes(snapshot, drillholeDraft)
      const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]))
      const selectedVariables = variables.filter((variable) => datasets.some((dataset) => (
        supportsSection(section, variable, `${dataset.name} ${dataset.producerName} ${dataset.producerType}`)
      )))
      if (selectedVariables.length === 0) return { ...configs[section], rows: [] }
      const selectedKeys = new Set(selectedVariables.map((variable) => variable.key))
      const observations = (snapshot?.observations ?? []).filter((observation) => selectedKeys.has(observation.variableKey))
      const holeNames = new Map(holes.map(hole => [hole.id, hole.name]))
      const observed = observations.filter(observation => {
        const dataset = datasetById.get(observation.datasetId)
        const definition = selectedVariables.find(variable => variable.key === observation.variableKey)
        return dataset !== undefined && definition !== undefined && supportsSection(section, definition, `${dataset.name} ${dataset.producerName} ${dataset.producerType}`)
      })
      const observedKeys = new Set(observed.map(observation => observation.variableKey))
      const fields = selectedVariables.filter(variable => observedKeys.has(variable.key))
      const labels = new Set(['Source record', 'Hole ID', 'From', 'To'])
      const columns = ['Source record', 'Hole ID', 'From', 'To', ...fields.map(variable => {
        const original = typeof variable.metadata?.sourceColumn === 'string' ? variable.metadata.sourceColumn : variable.displayName
        const label = labels.has(original) ? `${original} [${variable.key}]` : original
        labels.add(label)
        return label
      })]
      const rows = new Map<string, string[]>()
      for (const observation of observed) {
        const key = JSON.stringify([observation.datasetId, observation.sourceId, observation.holeId, observation.depthFrom, observation.depthTo])
        const row = rows.get(key) ?? [observation.sourceId, observation.holeId === null ? '' : holeNames.get(observation.holeId) ?? observation.holeId,
          observation.depthFrom === null ? '' : String(observation.depthFrom), observation.depthTo === null ? observation.depthFrom === null ? '' : String(observation.depthFrom) : String(observation.depthTo), ...fields.map(() => '')]
        const index = fields.findIndex(variable => variable.key === observation.variableKey)
        row[index + 4] = displayObservationValue(observation, undefined)
        rows.set(key, row)
      }
      return { columns, rows: [...rows.values()], searchLabel: configs[section].searchLabel }
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
