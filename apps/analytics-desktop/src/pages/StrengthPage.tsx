import { RowSelectionCheckbox } from '../components/RowSelectionCheckbox.js'
import { toggleRowSelection, toggleVisibleSelection } from '../data/rowSelection.js'
import { editPointLoadRecord, editSchmidtRecord } from '../data/strengthRecordEdits.js'
import { strengthDatabaseDraft } from '../data/strengthDatabaseDraft.js'
import { AlertCircle, CheckCircle2, Pencil, Plus, Save, Search, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { calculatePointLoadIndex, type PointLoadTestType } from '../analysis/pointLoad.js'
import {
  createPointLoadRecord,
  readPointLoadRecords,
  writePointLoadRecords,
  type PointLoadRecord,
} from '../data/pointLoadStore.js'
import { readSchmidtRecords, writeSchmidtRecords, type SchmidtRecord } from '../data/schmidtStore.js'
import { parseStrengthCsv } from '../data/strengthCsvImport.js'
import { readImportSource } from '../data/importSource.js'
import { usePersistentState } from '../state/persistentState.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'

interface PointLoadDraft {
  depthFromM: string
  depthToM: string
  equivalentDiameterMm: string
  holeId: string
  labName: string
  peakLoadKn: string
  sampleId: string
  testedAt: string
  testType: PointLoadTestType
  validBreak: boolean
}

const testTypeLabels: Record<PointLoadTestType, string> = {
  axial: 'Axial core',
  'block-irregular': 'Block / irregular lump',
  diametral: 'Diametral core',
}

function localIsoDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function initialDraft(): PointLoadDraft {
  return {
    depthFromM: '',
    depthToM: '',
    equivalentDiameterMm: '',
    holeId: '',
    labName: '',
    peakLoadKn: '',
    sampleId: '',
    testedAt: localIsoDate(),
    testType: 'diametral',
    validBreak: true,
  }
}

function format(value: number, digits = 2): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

function recordMatches(record: PointLoadRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) return true
  return [record.sampleId, record.holeId, record.labName, testTypeLabels[record.testType], record.testedAt]
    .some((value) => value.toLowerCase().includes(normalized))
}

function schmidtRecordMatches(record: SchmidtRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) return true
  return [record.holeId, String(record.depthFromM), String(record.depthToM), String(record.reboundValue)]
    .some((value) => value.toLowerCase().includes(normalized))
}

type StrengthMethod = 'point-load' | 'schmidt'


export function StrengthPage() {
  const workspace = useDataPoolWorkspace()
  const storage = useProjectStorage()
  const [records, setRecords] = useState(() => readPointLoadRecords(storage))
  const [schmidtRecords, setSchmidtRecords] = useState(() => readSchmidtRecords(storage))
  const [activeMethod, setActiveMethod] = usePersistentState<StrengthMethod>('strength.activeMethod', 'point-load')
  const [query, setQuery] = usePersistentState('strength.query', '')
  const [showEntry, setShowEntry] = usePersistentState('strength.showEntry', false)
  const [draft, setDraft] = usePersistentState<PointLoadDraft>('strength.draft', initialDraft)
  const [formError, setFormError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [editingPointLoad, setEditingPointLoad] = useState<PointLoadRecord | null>(null)
  const [editingSchmidt, setEditingSchmidt] = useState<SchmidtRecord | null>(null)
  const [schmidtDraft, setSchmidtDraft] = useState({ holeId: '', from: '', to: '', value: '' })
  const [deleteTarget, setDeleteTarget] = useState<{ kind: StrengthMethod; id: string; label: string; ids?: string[] } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  useEffect(() => { setSelectedIds(new Set()) }, [activeMethod])
  const [savingRecord, setSavingRecord] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const databaseDraft = workspace.localTabularDrafts.strength

  useEffect(() => {
    if (!workspace.live || databaseDraft !== undefined || records.length + schmidtRecords.length === 0) return
    void workspace.saveTabularImportLocally(strengthDatabaseDraft(records, schmidtRecords)).catch(error => { setNoticeIsError(true); setSaveNotice(String(error)) })
  }, [databaseDraft, records, schmidtRecords, workspace.live, workspace.saveTabularImportLocally])

  const filteredRecords = useMemo(() => records.filter(record => recordMatches(record, query)), [query, records])
  const filteredSchmidtRecords = useMemo(
    () => schmidtRecords.filter((record) => schmidtRecordMatches(record, query)),
    [query, schmidtRecords],
  )

  const visibleIds = (activeMethod === 'point-load' ? filteredRecords : filteredSchmidtRecords).map(record => record.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))
  const someSelected = visibleIds.some(id => selectedIds.has(id))
  const meanIs50 = records.length === 0 ? null : records.reduce((sum, record) => sum + record.is50Mpa, 0) / records.length
  const meanSchmidt = schmidtRecords.length === 0
    ? null
    : schmidtRecords.reduce((sum, record) => sum + record.reboundValue, 0) / schmidtRecords.length

  const preview = useMemo(() => {
    try {
      if (editingPointLoad && Number(draft.peakLoadKn) === editingPointLoad.peakLoadKn && Number(draft.equivalentDiameterMm) === editingPointLoad.equivalentDiameterMm) return editingPointLoad
      return calculatePointLoadIndex(Number(draft.peakLoadKn), Number(draft.equivalentDiameterMm))
    } catch {
      return null
    }
  }, [draft.equivalentDiameterMm, draft.peakLoadKn, editingPointLoad])

  const closeEntry = () => {
    if (savingRecord) return
    setEditingPointLoad(null)
    setDraft(initialDraft())
    setFormError(null)
    setShowEntry(false)
  }

  const updateDraft = <Key extends keyof PointLoadDraft>(key: Key, value: PointLoadDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setFormError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const input = {
        depthFromM: Number(draft.depthFromM), depthToM: Number(draft.depthToM),
        equivalentDiameterMm: Number(draft.equivalentDiameterMm), peakLoadKn: Number(draft.peakLoadKn),
        holeId: draft.holeId, labName: draft.labName, sampleId: draft.sampleId,
        testedAt: draft.testedAt, testType: draft.testType, validBreak: draft.validBreak,
      }
      const record = editingPointLoad ? editPointLoadRecord(editingPointLoad, input) : createPointLoadRecord(input, crypto.randomUUID())
      const nextRecords = editingPointLoad ? records.map(item => item.id === record.id ? record : item) : [record, ...records]
      await persistRecords(nextRecords, schmidtRecords)
      setNoticeIsError(false)
      setSaveNotice(`${record.sampleId} ${editingPointLoad ? 'updated' : 'added'}`)
      closeEntry()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Review the point-load inputs.')
    }
  }

  const persistRecords = async (nextPointLoad: PointLoadRecord[], nextSchmidt: SchmidtRecord[]) => {
    setSavingRecord(true)
    try {
      if (!writePointLoadRecords(storage, nextPointLoad) || !writeSchmidtRecords(storage, nextSchmidt)) throw new Error('The changes could not be saved locally.')
      await storage.flush?.()
      if (workspace.live) await workspace.saveTabularImportLocally(strengthDatabaseDraft(nextPointLoad, nextSchmidt))
      setRecords(nextPointLoad)
      setSchmidtRecords(nextSchmidt)
    } catch (error) {
      writePointLoadRecords(storage, records)
      writeSchmidtRecords(storage, schmidtRecords)
      await storage.flush?.()
      throw error
    } finally { setSavingRecord(false) }
  }

  const openPointLoadEdit = (record: PointLoadRecord) => {
    setEditingPointLoad(record)
    setDraft({ holeId: record.holeId, sampleId: record.sampleId, depthFromM: String(record.depthFromM), depthToM: String(record.depthToM),
      peakLoadKn: String(record.peakLoadKn), equivalentDiameterMm: String(record.equivalentDiameterMm),
      labName: record.labName, testedAt: record.testedAt, testType: record.testType, validBreak: record.validBreak })
    setFormError(null)
    setShowEntry(true)
  }

  const saveSchmidtEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingSchmidt) return
    try {
      const updated = editSchmidtRecord(editingSchmidt, { holeId: schmidtDraft.holeId, depthFromM: Number(schmidtDraft.from), depthToM: Number(schmidtDraft.to), reboundValue: Number(schmidtDraft.value) })
      await persistRecords(records, schmidtRecords.map(record => record.id === updated.id ? updated : record))
      setEditingSchmidt(null)
      setSaveNotice('Smidth reading updated')
      setNoticeIsError(false)
    } catch (error) { setFormError(error instanceof Error ? error.message : 'The reading could not be updated.') }
  }

  const deleteRecord = async () => {
    if (!deleteTarget) return
    try {
      await persistRecords(deleteTarget.kind === 'point-load' ? records.filter(record => !(deleteTarget.ids ?? [deleteTarget.id]).includes(record.id)) : records,
        deleteTarget.kind === 'schmidt' ? schmidtRecords.filter(record => !(deleteTarget.ids ?? [deleteTarget.id]).includes(record.id)) : schmidtRecords)
      setDeleteTarget(null)
      setSelectedIds(new Set())
      setNoticeIsError(false)
      setSaveNotice(`${deleteTarget.ids?.length ?? 1} strength records deleted`)
    } catch (error) { setFormError(error instanceof Error ? error.message : 'The record could not be deleted.') }
  }

  const handleCsvImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return

    try {
      const source = await readImportSource(file)
      const result = parseStrengthCsv(source.contents, file.name)
      let newCount: number
      let persisted: boolean
      if (result.kind === 'point-load') {
        const importedIds = new Set(result.records.map(record => record.id))
        const existingIds = new Set(records.map(record => record.id))
        newCount = result.records.filter(record => !existingIds.has(record.id)).length
        const nextRecords = [...result.records, ...records.filter(record => !importedIds.has(record.id))]
        persisted = writePointLoadRecords(storage, nextRecords)
        await storage.flush?.()
        if (workspace.live) await workspace.saveTabularImportLocally(strengthDatabaseDraft(nextRecords, schmidtRecords), [source])
        setRecords(nextRecords)
        setActiveMethod('point-load')
      } else {
        const importedIds = new Set(result.records.map(record => record.id))
        const existingIds = new Set(schmidtRecords.map(record => record.id))
        newCount = result.records.filter(record => !existingIds.has(record.id)).length
        const nextRecords = [...result.records, ...schmidtRecords.filter(record => !importedIds.has(record.id))]
        persisted = writeSchmidtRecords(storage, nextRecords)
        await storage.flush?.()
        if (workspace.live) await workspace.saveTabularImportLocally(strengthDatabaseDraft(records, nextRecords), [source])
        setSchmidtRecords(nextRecords)
        setActiveMethod('schmidt')
      }
      setQuery('')
      setSelectedIds(new Set())
      const skipped = result.blankRows + result.invalidRows
      setNoticeIsError(false)
      setSaveNotice(`${result.records.length} ${result.kind === 'point-load' ? 'point-load tests' : 'Schmidt readings'} imported (${newCount} new, ${skipped} skipped)${persisted ? '' : '; local storage is unavailable'}`)
    } catch (error) {
      setNoticeIsError(true)
      setSaveNotice(error instanceof Error ? error.message : 'The CSV could not be imported.')
    }
  }

  const publishToDatabase = async () => {
    setPublishing(true)
    try {
      const result = await workspace.publishLocalTabularImport('strength')
      setNoticeIsError(false)
      const unmatched = result.unmatchedHoles.length === 0 ? '' : ` · ${result.unmatchedHoles.length} unmatched holes`
      setSaveNotice(`Saved ${result.importedRows.toLocaleString()} rows to Database · v${result.version}${unmatched}`)
    } catch (error) {
      setNoticeIsError(true)
      setSaveNotice(error instanceof Error ? error.message : 'The local Strength records could not be saved to the Database.')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="page dataset-tool-page strength-page">
      <h1 className="sr-only">Strength laboratory data</h1>

      <section aria-label="Strength data summary" className="strength-summary">
        <div><span>Strength records</span><strong>{records.length + schmidtRecords.length}</strong><small>Point-load and Schmidt results</small></div>
        <div><span>Point-load tests</span><strong>{records.length}</strong><small>Laboratory results</small></div>
        <div><span>Mean I<sub>s</sub>(50)</span><strong>{meanIs50 === null ? '—' : format(meanIs50)}</strong><small>MPa · all tests</small></div>
        <div><span>Schmidt readings</span><strong>{schmidtRecords.length}</strong><small>{meanSchmidt === null ? 'No imported readings' : `Mean rebound ${format(meanSchmidt, 1)}`}</small></div>
      </section>

      <div aria-label="Strength test method" className="strength-method-tabs" role="tablist">
        <button aria-selected={activeMethod === 'point-load'} className={activeMethod === 'point-load' ? 'is-active' : ''} onClick={() => { setActiveMethod('point-load'); setQuery('') }} role="tab" type="button">Point load <span>{records.length}</span></button>
        <button aria-selected={activeMethod === 'schmidt'} className={activeMethod === 'schmidt' ? 'is-active' : ''} onClick={() => { setActiveMethod('schmidt'); setQuery('') }} role="tab" type="button">Schmidt rebound <span>{schmidtRecords.length}</span></button>
      </div>

      <div className="filter-bar drillhole-control-bar dataset-control-bar strength-control-bar">
        <label className="table-search"><Search size={16} /><input aria-label={`Search ${activeMethod === 'point-load' ? 'point-load tests' : 'Schmidt readings'}`} onChange={(event) => setQuery(event.target.value)} placeholder={activeMethod === 'point-load' ? 'Search sample, hole, lab…' : 'Search hole, depth, value…'} value={query} /></label>
        <label className="dataset-select-all"><RowSelectionCheckbox checked={allSelected} mixed={someSelected && !allSelected} disabled={savingRecord || visibleIds.length === 0} label="Select all shown Strength records" onChange={() => setSelectedIds(current => toggleVisibleSelection(current, visibleIds))} /> Select all</label>
        {selectedIds.size > 0 ? <><span className="result-count">{selectedIds.size} selected</span><button className="button button-secondary" disabled={savingRecord} onClick={() => { setFormError(null); setDeleteTarget({ kind: activeMethod, id: [...selectedIds][0]!, ids: [...selectedIds], label: `${selectedIds.size} selected ${activeMethod === 'point-load' ? 'point-load tests' : 'Smidth readings'}` }) }} type="button"><Trash2 size={15} /> Delete selected</button><button className="button button-secondary" onClick={() => setSelectedIds(new Set())} disabled={savingRecord} type="button">Clear selection</button></> : null}
        <span className="result-count">{activeMethod === 'point-load' ? filteredRecords.length : filteredSchmidtRecords.length} shown</span>
        {saveNotice === null && databaseDraft?.dirty !== true ? null : <span className={`strength-save-notice ${noticeIsError ? 'is-error' : ''}`} role={noticeIsError ? 'alert' : 'status'}>{noticeIsError ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />} {saveNotice ?? 'Local changes have not been saved to the Database.'}</span>}
        <input accept=".csv,text/csv" aria-label="Choose a Strength CSV file" className="sr-only" onChange={handleCsvImport} ref={fileInputRef} type="file" />
        <button className="button button-secondary" onClick={() => { setSaveNotice(null); fileInputRef.current?.click() }} type="button"><Upload size={16} /> Import CSV</button>
        {workspace.live ? <button className="button button-primary" disabled={publishing || !workspace.connected || !workspace.project?.canWrite || databaseDraft?.dirty !== true} onClick={() => void publishToDatabase()} title={!workspace.connected ? 'Sign in to save to the Database' : !workspace.project?.canWrite ? 'Your role on this project is read-only' : databaseDraft?.dirty === true ? 'Send the local Strength records to the Database' : 'Import or add Strength records before saving'} type="button"><Save size={16} /> {publishing ? 'Saving…' : 'Save to Database'}</button> : null}
        {activeMethod === 'point-load' ? <button className="button button-primary" onClick={() => { setEditingPointLoad(null); setDraft(initialDraft()); setSaveNotice(null); setNoticeIsError(false); setShowEntry(true) }} type="button"><Plus size={16} /> Add point-load test</button> : null}
      </div>

      <section className="panel dataset-records-panel strength-records-panel">
        {activeMethod === 'point-load' ? (
          <div aria-label="Point-load test records" className="dataset-record-table strength-record-table" role="table">
            <div className="dataset-record-row dataset-record-header strength-record-row" role="row">
              <span className="dataset-row-checkbox"></span><span>Sample</span><span>Hole / interval</span><span>Test type</span><span>Peak load</span><span>D<sub>e</sub></span><span>I<sub>s</sub></span><span>F</span><span>I<sub>s</sub>(50)</span><span>Actions</span>
            </div>
            {filteredRecords.map((record) => (
              <div className="dataset-record-row strength-record-row" key={record.id} role="row">
                <span className="dataset-row-checkbox"><RowSelectionCheckbox checked={selectedIds.has(record.id)} disabled={savingRecord} label={`Select point-load test ${record.sampleId}`} onChange={() => setSelectedIds(current => toggleRowSelection(current, record.id))} /></span>
                <span className="dataset-record-key"><strong>{record.sampleId}</strong><small>{record.sourceFile ?? [record.labName, record.testedAt].filter(Boolean).join(' · ')}</small></span>
                <span><strong>{record.holeId}</strong><small>{format(record.depthFromM, 1)}–{format(record.depthToM, 1)} m</small></span>
                <span>{testTypeLabels[record.testType]}</span>
                <span className="mono-value">{format(record.peakLoadKn)} kN</span>
                <span className="mono-value">{format(record.equivalentDiameterMm, 1)} mm</span>
                <span className="mono-value">{format(record.isMpa)} MPa</span>
                <span className="mono-value">{format(record.correctionFactor, 3)}</span>
                <span className="mono-value strength-result">{format(record.is50Mpa)} MPa</span>
                <span className="strength-row-actions"><button aria-label={`Edit point-load test ${record.sampleId}`} className="icon-button" disabled={savingRecord} onClick={() => openPointLoadEdit(record)} title="Edit" type="button"><Pencil size={15} /></button><button aria-label={`Delete point-load test ${record.sampleId}`} className="icon-button" disabled={savingRecord} onClick={() => { setFormError(null); setDeleteTarget({ kind: 'point-load', id: record.id, label: record.sampleId }) }} title="Delete" type="button"><Trash2 size={15} /></button></span>
              </div>
            ))}
            {filteredRecords.length === 0 ? <div className="strength-empty"><Search size={20} /><strong>No matching tests</strong><span>Change the search or result filter.</span></div> : null}
          </div>
        ) : (
          <div aria-label="Smidth records" className="dataset-record-table strength-record-table schmidt-record-table" role="table">
            <div className="dataset-record-row dataset-record-header schmidt-record-row" role="row">
              <span className="dataset-row-checkbox"></span><span>Hole ID</span><span>From (m)</span><span>To (m)</span><span>Smidth value</span><span>Actions</span>
            </div>
            {filteredSchmidtRecords.map((record) => (
              <div className="dataset-record-row schmidt-record-row" key={record.id} role="row">
                <span className="dataset-row-checkbox"><RowSelectionCheckbox checked={selectedIds.has(record.id)} disabled={savingRecord} label={`Select Smidth reading ${record.holeId} ${record.depthFromM}–${record.depthToM}`} onChange={() => setSelectedIds(current => toggleRowSelection(current, record.id))} /></span>
                <span className="dataset-record-key">{record.holeId}</span>
                <span className="mono-value">{record.depthFromM}</span>
                <span className="mono-value">{record.depthToM}</span>
                <span className="mono-value strength-result">{record.reboundValue}</span>
                <span className="strength-row-actions"><button aria-label={`Edit Smidth reading ${record.holeId} ${record.depthFromM}–${record.depthToM}`} className="icon-button" disabled={savingRecord} onClick={() => { setEditingSchmidt(record); setSchmidtDraft({ holeId: record.holeId, from: String(record.depthFromM), to: String(record.depthToM), value: String(record.reboundValue) }); setFormError(null) }} title="Edit" type="button"><Pencil size={15} /></button><button aria-label={`Delete Smidth reading ${record.holeId} ${record.depthFromM}–${record.depthToM}`} className="icon-button" disabled={savingRecord} onClick={() => { setFormError(null); setDeleteTarget({ kind: 'schmidt', id: record.id, label: `${record.holeId} · ${record.depthFromM}–${record.depthToM} m` }) }} title="Delete" type="button"><Trash2 size={15} /></button></span>
              </div>
            ))}
            {filteredSchmidtRecords.length === 0 ? <div className="strength-empty"><Search size={20} /><strong>No Smidth readings</strong><span>Import a CSV with Hole ID, From, To, and Smidth value. Equivalent header names are matched automatically.</span></div> : null}
          </div>
        )}
      </section>

      {editingSchmidt ? <div className="dialog-backdrop">
        <form className="strength-dialog" role="dialog" aria-modal="true" aria-labelledby="smidth-edit-title" onSubmit={saveSchmidtEdit}>
          <header className="strength-dialog-header"><h2 id="smidth-edit-title">Edit Smidth reading</h2><button aria-label="Close Smidth editor" className="icon-button" disabled={savingRecord} onClick={() => setEditingSchmidt(null)} type="button"><X size={18} /></button></header>
          <div className="strength-form-grid">
            <label><span>Hole ID</span><input autoFocus required value={schmidtDraft.holeId} onChange={event => setSchmidtDraft(current => ({ ...current, holeId: event.target.value }))} /></label>
            <label><span>From (m)</span><input required type="number" min="0" step="any" value={schmidtDraft.from} onChange={event => setSchmidtDraft(current => ({ ...current, from: event.target.value }))} /></label>
            <label><span>To (m)</span><input required type="number" min="0" step="any" value={schmidtDraft.to} onChange={event => setSchmidtDraft(current => ({ ...current, to: event.target.value }))} /></label>
            <label><span>Smidth value</span><input required type="number" min="0" step="any" value={schmidtDraft.value} onChange={event => setSchmidtDraft(current => ({ ...current, value: event.target.value }))} /></label>
          </div>
          {formError ? <p className="strength-form-error" role="alert">{formError}</p> : null}
          <footer className="strength-dialog-footer"><p>Changes update the local Strength dataset.</p><div><button className="button button-secondary" disabled={savingRecord} onClick={() => setEditingSchmidt(null)} type="button">Cancel</button><button className="button button-primary" disabled={savingRecord} type="submit">{savingRecord ? 'Saving…' : 'Save changes'}</button></div></footer>
        </form>
      </div> : null}
      {deleteTarget ? <div className="dialog-backdrop">
        <section className="strength-dialog" role="dialog" aria-modal="true" aria-labelledby="strength-delete-title">
          <header className="strength-dialog-header"><h2 id="strength-delete-title">{deleteTarget.ids ? `Delete ${deleteTarget.ids.length} selected records?` : 'Delete strength record?'}</h2><button aria-label="Close delete confirmation" className="icon-button" disabled={savingRecord} onClick={() => setDeleteTarget(null)} type="button"><X size={18} /></button></header>
          <p className="strength-delete-description">{deleteTarget.label}</p>
          {formError ? <p className="strength-form-error" role="alert">{formError}</p> : null}
          <footer className="strength-dialog-footer"><p>This removes the record from the local Strength dataset.</p><div><button className="button button-secondary" disabled={savingRecord} onClick={() => setDeleteTarget(null)} type="button">Cancel</button><button className="button button-accent" disabled={savingRecord} onClick={() => void deleteRecord()} type="button">{savingRecord ? 'Deleting…' : 'Delete record'}</button></div></footer>
        </section>
      </div> : null}

      {showEntry ? (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEntry() }}>
          <form aria-labelledby="point-load-entry-title" aria-modal="true" className="strength-dialog" onSubmit={handleSubmit} role="dialog">
            <header className="strength-dialog-header">
              <div><p className="eyebrow">Strength · laboratory</p><h2 id="point-load-entry-title">{editingPointLoad ? 'Edit point-load test' : 'Add point-load test'}</h2></div>
              <button aria-label="Close point-load entry" className="icon-button" onClick={closeEntry} type="button"><X size={18} /></button>
            </header>

            <div className="strength-form-grid">
              <label><span>Sample ID</span><input autoFocus onChange={(event) => updateDraft('sampleId', event.target.value)} placeholder="PLT-018-086" required value={draft.sampleId} /></label>
              <label><span>Hole ID</span><input onChange={(event) => updateDraft('holeId', event.target.value)} placeholder="Drillhole ID" required value={draft.holeId} /></label>
              <label><span>From depth (m)</span><input min="0" onChange={(event) => updateDraft('depthFromM', event.target.value)} placeholder="86.0" required step="any" type="number" value={draft.depthFromM} /></label>
              <label><span>To depth (m)</span><input min="0" onChange={(event) => updateDraft('depthToM', event.target.value)} placeholder="86.2" required step="any" type="number" value={draft.depthToM} /></label>
              <label><span>Test type</span><select onChange={(event) => updateDraft('testType', event.target.value as PointLoadTestType)} value={draft.testType}>{Object.entries(testTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Test date</span><input onChange={(event) => updateDraft('testedAt', event.target.value)} required={!editingPointLoad?.sourceFile} type="date" value={draft.testedAt} /></label>
              <label><span>Peak load P (kN)</span><input min="0.001" onChange={(event) => updateDraft('peakLoadKn', event.target.value)} placeholder="7.80" required step="any" type="number" value={draft.peakLoadKn} /></label>
              <label><span>Equivalent diameter D<sub>e</sub> (mm)</span><input min="0.1" onChange={(event) => updateDraft('equivalentDiameterMm', event.target.value)} placeholder="47.6" required step="any" type="number" value={draft.equivalentDiameterMm} /></label>
              <label className="strength-lab-field"><span>Laboratory</span><input onChange={(event) => updateDraft('labName', event.target.value)} placeholder="Laboratory name" required={!editingPointLoad?.sourceFile} value={draft.labName} /></label>
            </div>

            <section aria-live="polite" className={`strength-calculation ${preview === null ? 'is-empty' : ''}`}>
              <div><span>Point-load index I<sub>s</sub></span><strong>{preview === null ? '—' : `${format(preview.isMpa)} MPa`}</strong></div>
              <div><span>Size factor F</span><strong>{preview === null ? '—' : format(preview.correctionFactor, 3)}</strong></div>
              <div><span>Corrected I<sub>s</sub>(50)</span><strong>{preview === null ? 'Enter load and diameter' : `${format(preview.is50Mpa)} MPa`}</strong></div>
            </section>

            {formError === null ? null : <p className="strength-form-error" role="alert">{formError}</p>}
            <footer className="strength-dialog-footer"><p>{editingPointLoad?.sourceFile ? 'Reported lab values are retained. Changing load or diameter recalculates the indices.' : 'Derived values are calculated from the recorded peak load and equivalent diameter.'}</p><div><button className="button button-secondary" onClick={closeEntry} type="button">Cancel</button><button className="button button-primary" disabled={savingRecord} type="submit">{savingRecord ? 'Saving…' : editingPointLoad ? 'Save changes' : 'Add test'}</button></div></footer>
          </form>
        </div>
      ) : null}
    </div>
  )
}
