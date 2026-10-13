import { Download, Pencil, Trash2, Upload, X } from 'lucide-react'
import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { normalizeStructureHoleId, type CollarRecord, type SurveyStation } from '../analysis/structureAnalysis.js'
import { FileNameDialog } from '../components/FileNameDialog.js'
import { saveExportFiles } from '../data/exportBundle.js'
import { readImportSource } from '../data/importSource.js'
import { effectiveDrillholes, effectiveSurveysByHoleId } from '../data/localProjectDb.js'
import { projectOperationTables, readOperationTables, removeOperationTable, writeOperationTable, type StoredOperationTable } from '../data/operationTableStore.js'
import { csv } from '../data/resultExport.js'
import { calculatePoints, fieldColumns, isIntervalTable, mergeTables, operationTable, type OperationTable, type PointPosition } from '../data/tableOperations.js'
import { csvRows } from '../data/tabularCsvImport.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { useExportTarget } from '../state/ExportContext.js'
import { usePersistentState } from '../state/persistentState.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'

const operations = [['merge', 'Merge table'], ['point', 'Calculate point'], ['composite', 'Composite']] as const
type OperationId = typeof operations[number][0]
/** Leapfrog's four composites. The tab keeps their place until they are built. */
const composites = ['Category composite', 'Economic composite', 'Majority composite', 'Numeric composite']
const positions: readonly (readonly [PointPosition, string])[] = [['mid', 'Interval mid'], ['above', 'Contact above (From)'], ['below', 'Contact below (To)']]
const previewRows = 200
const count = (value: number) => value.toLocaleString('en-US')
const parts = (...items: (string | false)[]) => items.filter(Boolean).join(' · ')

interface Created { columns: string[]; name: string; note: string; rows: string[][] }

function TableSelect({ label, onChange, tables, value }: { label: string; onChange: (id: string) => void; tables: readonly OperationTable[]; value: string }) {
  return <label><span>{label}</span><select aria-label={label} onChange={event => onChange(event.target.value)} value={value}>
    <option value="">Choose table…</option>
    {[...new Set(tables.map(table => table.group))].map(group => <optgroup key={group} label={group}>
      {tables.filter(table => table.group === group).map(table => <option key={table.id} value={table.id}>{table.name} · {count(table.rows.length)} rows</option>)}
    </optgroup>)}
  </select></label>
}

function MergeForm({ onCreate, projectHoles, tables }: { onCreate: (created: Created) => void; projectHoles: ReadonlySet<string>; tables: readonly OperationTable[] }) {
  const intervalTables = useMemo(() => tables.filter(isIntervalTable), [tables])
  const [ids, setIds] = useState<[string, string]>(['', ''])
  const [fields, setFields] = useState<[number[], number[]]>([[], []])
  const [name, setName] = useState('')
  const [projectOnly, setProjectOnly] = useState(true)
  const [first, second] = ids.map(id => intervalTables.find(table => table.id === id))
  const defaultName = first && second ? `${first.name} + ${second.name}` : 'Merged table'
  const set = <T,>(pair: [T, T], side: number, value: T): [T, T] => side === 0 ? [value, pair[1]] : [pair[0], value]
  const toggle = (side: number, index: number) => {
    const list = fields[side]!
    setFields(set(fields, side, list.includes(index) ? list.filter(item => item !== index) : [...list, index].sort((a, b) => a - b)))
  }
  const create = () => {
    if (first === undefined || second === undefined) return
    const merged = mergeTables(first, fields[0], second, fields[1], projectOnly && projectHoles.size > 0 ? projectHoles : undefined)
    onCreate({ columns: merged.columns, name: name.trim() || defaultName, rows: merged.rows, note: parts(
      `${count(merged.rows.length)} intervals in ${count(merged.holes)} holes`,
      merged.overlaps > 0 && `${count(merged.overlaps)} overlapping pieces left blank`,
      merged.skippedHoles > 0 && `${count(merged.skippedHoles)} holes not in Drillholes left out`) })
  }
  return <>
    <div className="strength-form-grid">
      {[first, second].map((_, side) => <TableSelect key={side} label={side === 0 ? 'First table' : 'Second table'} onChange={id => { setIds(set(ids, side, id)); setFields(set(fields, side, [])) }} tables={intervalTables} value={ids[side]!} />)}
      {[first, second].map((table, side) => <fieldset className="operation-fields" key={side}>
        <legend>{table === undefined ? 'Fields' : `${table.name} fields`}</legend>
        {table === undefined ? <small>Choose a table</small> : fieldColumns(table).map(index => <label key={index}><input checked={fields[side]!.includes(index)} onChange={() => toggle(side, index)} type="checkbox" />{table.columns[index]}</label>)}
      </fieldset>)}
      <label><span>New table name</span><input onChange={event => setName(event.target.value)} placeholder={defaultName} value={name} /></label>
      <label className="strength-validity-field"><input checked={projectOnly && projectHoles.size > 0} disabled={projectHoles.size === 0} onChange={event => setProjectOnly(event.target.checked)} type="checkbox" /><span><strong>Only holes in Drillholes</strong></span></label>
    </div>
    <footer className="operation-footer">
      <button className="button button-primary" disabled={first === undefined || second === undefined || first === second || fields.some(list => list.length === 0)} onClick={create} type="button">Create merged table</button>
      <small>{intervalTables.length < 2 ? 'Needs two tables with Hole ID, From and To.' : 'Hole ID, From and To come from the tables; intervals split at every contact of both.'}</small>
    </footer>
  </>
}

function PointForm({ collars, onCreate, surveys, tables }: { collars: readonly CollarRecord[]; onCreate: (created: Created) => void; surveys: readonly SurveyStation[]; tables: readonly OperationTable[] }) {
  const [id, setId] = useState('')
  const [depthColumn, setDepthColumn] = useState('')
  const [position, setPosition] = useState<PointPosition>('mid')
  const [name, setName] = useState('')
  const table = tables.find(item => item.id === id)
  const defaultName = table ? `${table.name} points` : 'Points'
  const singleDepth = table !== undefined && (depthColumn !== '' || !isIntervalTable(table))
  const create = () => {
    if (table === undefined) return
    const result = calculatePoints(table, position, collars, surveys, depthColumn === '' ? undefined : Number(depthColumn))
    onCreate({ columns: result.columns, name: name.trim() || defaultName, rows: result.located === 0 ? [] : result.rows, note: parts(
      `${count(result.located)} of ${count(result.rows.length)} rows located`,
      result.noCollar > 0 && `${count(result.noCollar)} holes without a collar left blank`,
      result.vertical > 0 && `${count(result.vertical)} holes without a survey taken as vertical`) })
  }
  return <>
    <div className="strength-form-grid">
      <TableSelect label="Table" onChange={value => { setId(value); setDepthColumn('') }} tables={tables} value={id} />
      <label><span>Depth field</span><select aria-label="Depth field" disabled={table === undefined} onChange={event => setDepthColumn(event.target.value)} value={depthColumn}>
        <option value="">{table === undefined ? 'Choose a table' : isIntervalTable(table) ? `${table.columns[table.from]} – ${table.columns[table.to]}` : table.columns[table.from]}</option>
        {table === undefined ? null : fieldColumns(table).map(index => <option key={index} value={index}>{table.columns[index]}</option>)}
      </select></label>
      <label><span>Coordinate at</span><select aria-label="Coordinate at" onChange={event => setPosition(event.target.value as PointPosition)} value={position}>
        {positions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label><span>New table name</span><input onChange={event => setName(event.target.value)} placeholder={defaultName} value={name} /></label>
    </div>
    <footer className="operation-footer">
      <button className="button button-primary" disabled={table === undefined || collars.length === 0} onClick={create} type="button">Calculate points</button>
      <small>{collars.length === 0 ? 'Import collars in Drillholes first.' : singleDepth ? 'One depth per row: every position gives the same point.' : 'X, Y and Z are added to a copy of the table.'}</small>
    </footer>
  </>
}

/** Data → Operations: builds new tables from the project's tables. */
export function OperationsPage() {
  const workspace = useDataPoolWorkspace()
  const storage = useProjectStorage()
  const exportTarget = useExportTarget('data')
  const [operation, setOperation] = usePersistentState<OperationId>('operations.active', 'merge')
  const [activeId, setActiveId] = usePersistentState<string | null>('operations.activeTable', null)
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const [dialog, setDialog] = useState<'rename' | 'export' | 'delete' | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const { localDrillholeDraft: drillholeDraft, localSnapshot: snapshot, localTabularDrafts: tabularDrafts } = workspace
  const made = useMemo(() => readOperationTables(storage), [storage, revision])
  const tables = useMemo(() => projectOperationTables({ drillholeDraft, snapshot, storage, tabularDrafts }), [drillholeDraft, snapshot, storage, tabularDrafts, revision])
  const drillholes = useMemo(() => {
    const holes = effectiveDrillholes(snapshot, drillholeDraft), surveys = effectiveSurveysByHoleId(snapshot, drillholeDraft)
    return {
      collars: holes.flatMap(hole => hole.collar === null ? [] : [{ easting: hole.collar.easting, elevation: hole.collar.elevation, holeId: hole.name, northing: hole.collar.northing }]),
      names: new Set(holes.map(hole => normalizeStructureHoleId(hole.name))),
      surveys: holes.flatMap(hole => (surveys[hole.id] ?? []).map(station => ({ azimuth: station.azimuth, depth: station.measuredDepth, dip: station.dip, holeId: hole.name }))),
    }
  }, [drillholeDraft, snapshot])
  const active = made.find(table => table.id === activeId) ?? made.at(-1)

  const report = (text: string, error = false) => setNotice({ error, text })
  const fail = (error: unknown) => report(error instanceof Error ? error.message : 'The change could not be saved.', true)
  const store = async (change: () => void, text: string) => {
    setDialog(null)
    try {
      change()
      await storage.flush?.()
      setRevision(value => value + 1)
      report(text)
    } catch (error) { fail(error) }
  }
  const add = ({ columns, name, note, rows }: Created) => {
    if (rows.length === 0) { report(parts('No rows were produced', note), true); return }
    const id = crypto.randomUUID()
    void store(() => { writeOperationTable(storage, { columns, createdAt: new Date().toISOString(), id, name, note, rows }); setActiveId(id) }, parts(`${name} created`, note))
  }
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    try {
      const [header = [], ...rows] = csvRows((await readImportSource(file)).contents)
      const columns = header.map(column => column.replace(/^﻿/, '').trim())
      if (operationTable('', '', '', columns, rows) === null) throw new Error('The CSV needs a Hole ID column with From and To, or with Depth.')
      add({ columns, name: file.name.replace(/\.[^.]+$/, ''), note: 'Imported CSV', rows: rows.map(row => columns.map((_, index) => (row[index] ?? '').trim())) })
    } catch (error) { fail(error) }
  }
  const rename = (table: StoredOperationTable, value: string) => {
    const name = value.trim()
    if (name === '' || name === table.name) setDialog(null)
    else void store(() => writeOperationTable(storage, { ...table, name }), `Renamed to ${name}`)
  }
  const exportCsv = async (table: StoredOperationTable, name: string) => {
    setDialog(null)
    try {
      const saved = await saveExportFiles(exportTarget, [{ contents: csv(table.columns, table.rows), kind: 'csv', name }])
      report(`Saved ${saved.paths[0] ?? name}`)
    } catch (error) { fail(error) }
  }

  if (!workspace.live) return <div className="page dataset-tool-page"><div className="eda-state panel">No local project data is open.</div></div>
  return (
    <div className="page dataset-tool-page operations-page">
      <h1 className="sr-only">Data operations</h1>
      <div aria-label="Operations" className="strength-method-tabs" role="tablist">
        {operations.map(([id, label]) => <button aria-selected={id === operation} className={id === operation ? 'is-active' : ''} key={id} onClick={() => setOperation(id)} role="tab" type="button">{label}</button>)}
      </div>
      <section className="panel operation-panel">
        {operation === 'merge' ? <MergeForm onCreate={add} projectHoles={drillholes.names} tables={tables} />
          : operation === 'point' ? <PointForm collars={drillholes.collars} onCreate={add} surveys={drillholes.surveys} tables={tables} />
            : <div className="operation-planned">{composites.map(name => <div key={name}><strong>{name}</strong><span>Planned</span></div>)}</div>}
      </section>
      <div aria-label="Operation tables" className="strength-method-tabs" role="tablist">
        {made.map(table => dialog === 'rename' && table.id === active?.id
          ? <input aria-label="Table name" autoFocus defaultValue={table.name} key={table.id} onBlur={event => rename(table, event.target.value)} onFocus={event => event.target.select()} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setDialog(null) }} />
          : <button aria-selected={table.id === active?.id} className={table.id === active?.id ? 'is-active' : ''} key={table.id} onClick={() => setActiveId(table.id)} onDoubleClick={() => { setActiveId(table.id); setDialog('rename') }} role="tab" title="Double-click to rename" type="button">{table.name} <span>{count(table.rows.length)}</span></button>)}
        <input accept=".csv,text/csv" aria-label="Choose a CSV table" className="sr-only" onChange={event => void importFile(event)} ref={fileInput} type="file" />
        <button onClick={() => fileInput.current?.click()} type="button"><Upload size={14} /> Import CSV</button>
        {notice === null ? null : <span className={`strength-save-notice operation-notice ${notice.error ? 'is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</span>}
        {active === undefined ? null : <div className="strength-test-actions">
          <button aria-label={`Rename ${active.name}`} className="icon-button" onClick={() => setDialog('rename')} title="Rename table" type="button"><Pencil size={15} /></button>
          <button aria-label={`Export ${active.name}`} className="icon-button" onClick={() => setDialog('export')} title="Export CSV" type="button"><Download size={15} /></button>
          <button aria-label={`Delete ${active.name}`} className="icon-button" onClick={() => setDialog('delete')} title="Delete table" type="button"><Trash2 size={15} /></button>
        </div>}
      </div>
      <section className="panel operation-preview">
        {active === undefined ? <div className="strength-empty"><strong>No operation tables yet</strong><span>Run an operation or import a CSV.</span></div> : <>
          <div><table>
            <thead><tr>{active.columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead>
            <tbody>{active.rows.slice(0, previewRows).map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column}>{value}</td>)}</tr>)}</tbody>
          </table></div>
          <p>{parts(active.note, active.rows.length > previewRows && `first ${previewRows} of ${count(active.rows.length)} rows shown`)}</p>
        </>}
      </section>
      {dialog === 'export' && active ? <FileNameDialog defaultName={active.name} detail={`Saved as CSV in export/${exportTarget.folder}/`} onCancel={() => setDialog(null)} onConfirm={name => void exportCsv(active, name)} title="Export table" /> : null}
      {dialog === 'delete' && active ? <div className="dialog-backdrop">
        <section aria-labelledby="operation-delete-title" aria-modal="true" className="strength-dialog" role="dialog">
          <header className="strength-dialog-header"><h2 id="operation-delete-title">Delete {active.name}?</h2><button aria-label="Close delete confirmation" className="icon-button" onClick={() => setDialog(null)} type="button"><X size={18} /></button></header>
          <footer className="strength-dialog-footer"><p>{count(active.rows.length)} rows</p><div><button className="button button-secondary" onClick={() => setDialog(null)} type="button">Cancel</button><button className="button button-accent" onClick={() => void store(() => removeOperationTable(storage, active.id), `${active.name} deleted`)} type="button">Delete table</button></div></footer>
        </section>
      </div> : null}
    </div>
  )
}
