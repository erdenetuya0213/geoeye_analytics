import type { TabularImportInput } from '@geoeye/datapool-client'
import { AlertCircle, CheckCircle2, Filter, Plus, Save, Search, Upload, X } from 'lucide-react'
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
  return [record.sampleId, record.holeId, record.sourceFile, String(record.reboundValue)]
    .some((value) => value.toLowerCase().includes(normalized))
}

type StrengthMethod = 'point-load' | 'schmidt'

function strengthDatabaseDraft(pointLoad: readonly PointLoadRecord[], schmidt: readonly SchmidtRecord[]): TabularImportInput {
  const columns = ['Method', 'Sample ID', 'Hole ID', 'From', 'To', 'Peak Load kN', 'Equivalent Diameter mm', 'Is50 MPa', 'Schmidt Rebound', 'Laboratory', 'Tested At', 'Valid']
  const pointLoadRows = pointLoad.map((record) => [
    'Point load', record.sampleId, record.holeId, String(record.depthFromM), String(record.depthToM),
    String(record.peakLoadKn), String(record.equivalentDiameterMm), String(record.is50Mpa), '',
    record.labName, record.testedAt, String(record.validBreak),
  ])
  const schmidtRows = schmidt.map((record) => [
    'Schmidt rebound', record.sampleId, record.holeId, String(record.depthFromM), String(record.depthToM),
    '', '', '', String(record.reboundValue), '', '', 'true',
  ])
  return { columns, fileName: 'strength-local-records.csv', rows: [...pointLoadRows, ...schmidtRows], section: 'strength' }
}

export function StrengthPage() {
  const workspace = useDataPoolWorkspace()
  const storage = useProjectStorage()
  const [records, setRecords] = useState(() => readPointLoadRecords(storage))
  const [schmidtRecords, setSchmidtRecords] = useState(() => readSchmidtRecords(storage))
  const [activeMethod, setActiveMethod] = usePersistentState<StrengthMethod>('strength.activeMethod', 'point-load')
  const [query, setQuery] = usePersistentState('strength.query', '')
  const [validOnly, setValidOnly] = usePersistentState('strength.validOnly', false)
  const [showEntry, setShowEntry] = usePersistentState('strength.showEntry', false)
  const [draft, setDraft] = usePersistentState<PointLoadDraft>('strength.draft', initialDraft)
  const [formError, setFormError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const databaseDraft = workspace.localTabularDrafts.strength

  useEffect(() => {
    if (!workspace.live || databaseDraft !== undefined || records.length + schmidtRecords.length === 0) return
    void workspace.saveTabularImportLocally(strengthDatabaseDraft(records, schmidtRecords)).catch(error => { setNoticeIsError(true); setSaveNotice(String(error)) })
  }, [databaseDraft, records, schmidtRecords, workspace.live, workspace.saveTabularImportLocally])

  const filteredRecords = useMemo(() => records.filter((record) => (
    (!validOnly || record.validBreak) && recordMatches(record, query)
  )), [query, records, validOnly])
  const filteredSchmidtRecords = useMemo(
    () => schmidtRecords.filter((record) => schmidtRecordMatches(record, query)),
    [query, schmidtRecords],
  )

  const validRecords = useMemo(() => records.filter((record) => record.validBreak), [records])
  const meanIs50 = validRecords.length === 0
    ? null
    : validRecords.reduce((sum, record) => sum + record.is50Mpa, 0) / validRecords.length
  const meanSchmidt = schmidtRecords.length === 0
    ? null
    : schmidtRecords.reduce((sum, record) => sum + record.reboundValue, 0) / schmidtRecords.length

  const preview = useMemo(() => {
    try {
      return calculatePointLoadIndex(Number(draft.peakLoadKn), Number(draft.equivalentDiameterMm))
    } catch {
      return null
    }
  }, [draft.equivalentDiameterMm, draft.peakLoadKn])

  const closeEntry = () => {
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
      const record = createPointLoadRecord({
        depthFromM: Number(draft.depthFromM),
        depthToM: Number(draft.depthToM),
        equivalentDiameterMm: Number(draft.equivalentDiameterMm),
        holeId: draft.holeId,
        labName: draft.labName,
        peakLoadKn: Number(draft.peakLoadKn),
        sampleId: draft.sampleId,
        testedAt: draft.testedAt,
        testType: draft.testType,
        validBreak: draft.validBreak,
      }, crypto.randomUUID())
      const nextRecords = [record, ...records]
      const persisted = writePointLoadRecords(storage, nextRecords)
      await storage.flush?.()
      if (workspace.live) await workspace.saveTabularImportLocally(strengthDatabaseDraft(nextRecords, schmidtRecords))
      setRecords(nextRecords)
      setNoticeIsError(false)
      setSaveNotice(persisted ? `${record.sampleId} added` : `${record.sampleId} added for this session; local storage is unavailable`)
      closeEntry()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Review the point-load inputs.')
    }
  }

  const handleCsvImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return

    try {
      const source = await readImportSource(file)
      const result = parseStrengthCsv(source.contents, file.name)
      const importedIds = new Set(result.records.map((record) => record.id))
      const existingIds = new Set(schmidtRecords.map((record) => record.id))
      const newCount = result.records.filter((record) => !existingIds.has(record.id)).length
      const nextRecords = [...result.records, ...schmidtRecords.filter((record) => !importedIds.has(record.id))]
      const persisted = writeSchmidtRecords(storage, nextRecords)
      await storage.flush?.()
      if (workspace.live) await workspace.saveTabularImportLocally(strengthDatabaseDraft(records, nextRecords), [source])
      setSchmidtRecords(nextRecords)
      setActiveMethod('schmidt')
      setQuery('')
      const skipped = result.blankRows + result.invalidRows
      setNoticeIsError(false)
      setSaveNotice(`${result.records.length} Schmidt readings imported (${newCount} new, ${skipped} skipped)${persisted ? '' : '; local storage is unavailable'}`)
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
        <div><span>Point-load tests</span><strong>{records.length}</strong><small>{validRecords.length} valid · {records.length - validRecords.length} invalid</small></div>
        <div><span>Mean I<sub>s</sub>(50)</span><strong>{meanIs50 === null ? '—' : format(meanIs50)}</strong><small>MPa · valid tests only</small></div>
        <div><span>Schmidt readings</span><strong>{schmidtRecords.length}</strong><small>{meanSchmidt === null ? 'No imported readings' : `Mean rebound ${format(meanSchmidt, 1)}`}</small></div>
      </section>

      <div aria-label="Strength test method" className="strength-method-tabs" role="tablist">
        <button aria-selected={activeMethod === 'point-load'} className={activeMethod === 'point-load' ? 'is-active' : ''} onClick={() => { setActiveMethod('point-load'); setQuery('') }} role="tab" type="button">Point load <span>{records.length}</span></button>
        <button aria-selected={activeMethod === 'schmidt'} className={activeMethod === 'schmidt' ? 'is-active' : ''} onClick={() => { setActiveMethod('schmidt'); setQuery('') }} role="tab" type="button">Schmidt rebound <span>{schmidtRecords.length}</span></button>
      </div>

      <div className="filter-bar drillhole-control-bar dataset-control-bar strength-control-bar">
        <label className="table-search"><Search size={16} /><input aria-label={`Search ${activeMethod === 'point-load' ? 'point-load tests' : 'Schmidt readings'}`} onChange={(event) => setQuery(event.target.value)} placeholder={activeMethod === 'point-load' ? 'Search sample, hole, lab…' : 'Search hole, sample, source…'} value={query} /></label>
        {activeMethod === 'point-load' ? <button aria-pressed={validOnly} className={`filter-button ${validOnly ? 'is-active' : ''}`} onClick={() => setValidOnly((current) => !current)} type="button"><Filter size={15} /> {validOnly ? 'Valid only' : 'All results'}</button> : null}
        <span className="result-count">{activeMethod === 'point-load' ? filteredRecords.length : filteredSchmidtRecords.length} shown</span>
        {saveNotice === null && databaseDraft?.dirty !== true ? null : <span className={`strength-save-notice ${noticeIsError ? 'is-error' : ''}`} role={noticeIsError ? 'alert' : 'status'}>{noticeIsError ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />} {saveNotice ?? 'Local changes have not been saved to the Database.'}</span>}
        <input accept=".csv,text/csv" aria-label="Choose a Strength CSV file" className="sr-only" onChange={handleCsvImport} ref={fileInputRef} type="file" />
        <button className="button button-secondary" onClick={() => { setSaveNotice(null); fileInputRef.current?.click() }} type="button"><Upload size={16} /> Import CSV</button>
        {workspace.live ? <button className="button button-primary" disabled={publishing || !workspace.connected || !workspace.project?.canWrite || databaseDraft?.dirty !== true} onClick={() => void publishToDatabase()} title={!workspace.connected ? 'Sign in to save to the Database' : !workspace.project?.canWrite ? 'Your role on this project is read-only' : databaseDraft?.dirty === true ? 'Send the local Strength records to the Database' : 'Import or add Strength records before saving'} type="button"><Save size={16} /> {publishing ? 'Saving…' : 'Save to Database'}</button> : null}
        {activeMethod === 'point-load' ? <button className="button button-primary" onClick={() => { setSaveNotice(null); setNoticeIsError(false); setShowEntry(true) }} type="button"><Plus size={16} /> Add point-load test</button> : null}
      </div>

      <section className="panel dataset-records-panel strength-records-panel">
        {activeMethod === 'point-load' ? (
          <div aria-label="Point-load test records" className="dataset-record-table strength-record-table" role="table">
            <div className="dataset-record-row dataset-record-header strength-record-row" role="row">
              <span>Sample</span><span>Hole / interval</span><span>Test type</span><span>Peak load</span><span>D<sub>e</sub></span><span>I<sub>s</sub></span><span>F</span><span>I<sub>s</sub>(50)</span><span>Quality</span>
            </div>
            {filteredRecords.map((record) => (
              <div className={`dataset-record-row strength-record-row ${record.validBreak ? '' : 'is-invalid'}`} key={record.id} role="row">
                <span className="dataset-record-key"><strong>{record.sampleId}</strong><small>{record.labName} · {record.testedAt}</small></span>
                <span><strong>{record.holeId}</strong><small>{format(record.depthFromM, 1)}–{format(record.depthToM, 1)} m</small></span>
                <span>{testTypeLabels[record.testType]}</span>
                <span className="mono-value">{format(record.peakLoadKn)} kN</span>
                <span className="mono-value">{format(record.equivalentDiameterMm, 1)} mm</span>
                <span className="mono-value">{format(record.isMpa)} MPa</span>
                <span className="mono-value">{format(record.correctionFactor, 3)}</span>
                <span className="mono-value strength-result">{format(record.is50Mpa)} MPa</span>
                <span><b className={`strength-quality ${record.validBreak ? 'is-valid' : 'is-invalid'}`}>{record.validBreak ? 'Valid' : 'Invalid'}</b></span>
              </div>
            ))}
            {filteredRecords.length === 0 ? <div className="strength-empty"><Search size={20} /><strong>No matching tests</strong><span>Change the search or result filter.</span></div> : null}
          </div>
        ) : (
          <div aria-label="Schmidt rebound records" className="dataset-record-table strength-record-table schmidt-record-table" role="table">
            <div className="dataset-record-row dataset-record-header schmidt-record-row" role="row">
              <span>Sample</span><span>Hole / interval</span><span>Schmidt rebound</span><span>Source file</span><span>CSV row</span>
            </div>
            {filteredSchmidtRecords.map((record) => (
              <div className="dataset-record-row schmidt-record-row" key={record.id} role="row">
                <span className="dataset-record-key">{record.sampleId}</span>
                <span><strong>{record.holeId}</strong><small>{format(record.depthFromM, 3)}–{format(record.depthToM, 3)} m</small></span>
                <span className="mono-value strength-result">R {format(record.reboundValue, 0)}</span>
                <span title={record.sourceFile}>{record.sourceFile}</span>
                <span className="mono-value">{record.sourceRow}</span>
              </div>
            ))}
            {filteredSchmidtRecords.length === 0 ? <div className="strength-empty"><Search size={20} /><strong>No Schmidt readings</strong><span>Import a CSV with Borehole, From, To, and Schmidt or Smidth columns.</span></div> : null}
          </div>
        )}
      </section>

      {showEntry ? (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEntry() }}>
          <form aria-labelledby="point-load-entry-title" aria-modal="true" className="strength-dialog" onSubmit={handleSubmit} role="dialog">
            <header className="strength-dialog-header">
              <div><p className="eyebrow">Strength · laboratory</p><h2 id="point-load-entry-title">Add point-load test</h2></div>
              <button aria-label="Close point-load entry" className="icon-button" onClick={closeEntry} type="button"><X size={18} /></button>
            </header>

            <div className="strength-form-grid">
              <label><span>Sample ID</span><input autoFocus onChange={(event) => updateDraft('sampleId', event.target.value)} placeholder="PLT-018-086" required value={draft.sampleId} /></label>
              <label><span>Hole ID</span><input onChange={(event) => updateDraft('holeId', event.target.value)} placeholder="Drillhole ID" required value={draft.holeId} /></label>
              <label><span>From depth (m)</span><input min="0" onChange={(event) => updateDraft('depthFromM', event.target.value)} placeholder="86.0" required step="any" type="number" value={draft.depthFromM} /></label>
              <label><span>To depth (m)</span><input min="0" onChange={(event) => updateDraft('depthToM', event.target.value)} placeholder="86.2" required step="any" type="number" value={draft.depthToM} /></label>
              <label><span>Test type</span><select onChange={(event) => updateDraft('testType', event.target.value as PointLoadTestType)} value={draft.testType}>{Object.entries(testTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Test date</span><input onChange={(event) => updateDraft('testedAt', event.target.value)} required type="date" value={draft.testedAt} /></label>
              <label><span>Peak load P (kN)</span><input min="0.001" onChange={(event) => updateDraft('peakLoadKn', event.target.value)} placeholder="7.80" required step="any" type="number" value={draft.peakLoadKn} /></label>
              <label><span>Equivalent diameter D<sub>e</sub> (mm)</span><input min="0.1" onChange={(event) => updateDraft('equivalentDiameterMm', event.target.value)} placeholder="47.6" required step="any" type="number" value={draft.equivalentDiameterMm} /></label>
              <label className="strength-lab-field"><span>Laboratory</span><input onChange={(event) => updateDraft('labName', event.target.value)} placeholder="Laboratory name" required value={draft.labName} /></label>
              <label className="strength-validity-field"><input checked={draft.validBreak} onChange={(event) => updateDraft('validBreak', event.target.checked)} type="checkbox" /><span><strong>Valid break</strong><small>Include this result in strength summaries.</small></span></label>
            </div>

            <section aria-live="polite" className={`strength-calculation ${preview === null ? 'is-empty' : ''}`}>
              <div><span>Point-load index I<sub>s</sub></span><strong>{preview === null ? '—' : `${format(preview.isMpa)} MPa`}</strong></div>
              <div><span>Size factor F</span><strong>{preview === null ? '—' : format(preview.correctionFactor, 3)}</strong></div>
              <div><span>Corrected I<sub>s</sub>(50)</span><strong>{preview === null ? 'Enter load and diameter' : `${format(preview.is50Mpa)} MPa`}</strong></div>
            </section>

            {formError === null ? null : <p className="strength-form-error" role="alert">{formError}</p>}
            <footer className="strength-dialog-footer"><p>Derived values are calculated from the recorded peak load and equivalent diameter.</p><div><button className="button button-secondary" onClick={closeEntry} type="button">Cancel</button><button className="button button-primary" type="submit">Add test</button></div></footer>
          </form>
        </div>
      ) : null}
    </div>
  )
}
