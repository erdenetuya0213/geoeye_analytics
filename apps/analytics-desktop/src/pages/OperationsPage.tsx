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
const sourceRows = 50
const count = (value: number) => value.toLocaleString('en-US')
const plural = (value: number, noun: string) => `${count(value)} ${noun}${value === 1 ? '' : 's'}`
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

/** What an operation reads from a table: the hole and depth columns it located, then the chosen fields. */
function TablePreview({ fields, table }: { fields: readonly number[]; table: OperationTable | undefined }) {
  const summary = useMemo(() => table === undefined ? null : {
    holes: new Set(table.rows.map(row => normalizeStructureHoleId(row[table.hole] ?? ''))).size,
    points: table.rows.filter(row => Number(row[table.from]) === Number(row[table.to])).length,
  }, [table])
  if (table === undefined || summary === null) return <div />
  const columns = [...new Set([table.hole, table.from, table.to]), ...fields]
  return <section className="panel operation-preview operation-source">
    <div><table>
      <thead><tr>{columns.map(index => <th key={index}>{table.columns[index]}</th>)}</tr></thead>
      <tbody>{table.rows.slice(0, sourceRows).map((row, index) => <tr key={index}>{columns.map(column => <td key={column}>{row[column]}</td>)}</tr>)}</tbody>
    </table></div>
    <p>{parts(plural(table.rows.length, 'row'), plural(summary.holes, 'hole'), summary.points === 0 ? 'intervals' : summary.points === table.rows.length ? 'point samples' : `${plural(summary.points, 'point sample')}, the rest intervals`)}</p>
  </section>
}

interface MergeSetup { fields: number[][]; ids: string[]; name: string; projectOnly: boolean }
interface PointSetup { depthColumn: string; id: string; name: string; position: PointPosition }

// Both forms keep their choices with the project: the page is rebuilt whenever the workspace refreshes its datasets.
function MergeForm({ onCreate, projectHoles, tables }: { onCreate: (created: Created) => void; projectHoles: ReadonlySet<string>; tables: readonly OperationTable[] }) {
  const [setup, setSetup] = usePersistentState<MergeSetup>('operations.merge', { fields: [[], []], ids: ['', ''], name: '', projectOnly: true })
  const picked = [0, 1].map(side => tables.find(table => table.id === setup.ids[side]))
  const [first, second] = picked
  const fields = picked.map((table, side) => table === undefined ? [] : (setup.fields[side] ?? []).filter(index => fieldColumns(table).includes(index)))
  const defaultName = first && second ? `${first.name} + ${second.name}` : 'Merged table'
  const choose = (side: number, id: string, list: number[]) => setSetup(current => ({
    ...current,
    fields: [0, 1].map(index => index === side ? list : current.fields[index] ?? []),
    ids: [0, 1].map(index => index === side ? id : current.ids[index] ?? ''),
  }))
  const toggle = (side: number, index: number) => {
    const list = fields[side]!
    choose(side, setup.ids[side] ?? '', list.includes(index) ? list.filter(item => item !== index) : [...list, index].sort((a, b) => a - b))
  }
  const create = () => {
    if (first === undefined || second === undefined) return
    const merged = mergeTables(first, fields[0]!, second, fields[1]!, setup.projectOnly && projectHoles.size > 0 ? projectHoles : undefined)
    onCreate({ columns: merged.columns, name: setup.name.trim() || defaultName, rows: merged.rows, note: parts(
      `${plural(merged.rows.length, 'interval')} in ${plural(merged.holes, 'hole')}`,
      merged.placed > 0 && `${plural(merged.placed, 'point sample')} placed`,
      merged.combined > 0 && `several samples combined in ${plural(merged.combined, 'interval')}`,
      merged.unplaced > 0 && `${plural(merged.unplaced, 'sample')} outside every interval left out`,
      merged.overlaps > 0 && `${plural(merged.overlaps, 'overlapping piece')} left blank`,
      merged.skippedHoles > 0 && `${plural(merged.skippedHoles, 'hole')} not in Drillholes left out`) })
  }
  return <>
    <div className="strength-form-grid">
      {picked.map((table, side) => <TableSelect key={side} label={side === 0 ? 'First table' : 'Second table'} onChange={id => choose(side, id, [])} tables={tables} value={table?.id ?? ''} />)}
      {picked.map((table, side) => <fieldset className="operation-fields" key={side}>
        <legend>{table === undefined ? 'Fields' : `${table.name} fields`}</legend>
        {table === undefined ? <small>Choose a table</small> : fieldColumns(table).map(index => <label key={index}><input checked={fields[side]!.includes(index)} onChange={() => toggle(side, index)} type="checkbox" />{table.columns[index]}</label>)}
      </fieldset>)}
      {picked.map((table, side) => <TablePreview fields={fields[side]!} key={side} table={table} />)}
      <label><span>New table name</span><input onChange={event => setSetup(current => ({ ...current, name: event.target.value }))} placeholder={defaultName} value={setup.name} /></label>
      <label className="strength-validity-field"><input checked={setup.projectOnly && projectHoles.size > 0} disabled={projectHoles.size === 0} onChange={event => setSetup(current => ({ ...current, projectOnly: event.target.checked }))} type="checkbox" /><span><strong>Only holes in Drillholes</strong></span></label>
    </div>
    <footer className="operation-footer">
      <button className="button button-primary" disabled={first === undefined || second === undefined || first === second || fields.every(list => list.length === 0)} onClick={create} type="button">Create merged table</button>
      <small>Intervals split at every contact of both tables. A sample with From = To goes into the interval that contains it.</small>
    </footer>
  </>
}

function PointForm({ collars, onCreate, surveys, tables }: { collars: readonly CollarRecord[]; onCreate: (created: Created) => void; surveys: readonly SurveyStation[]; tables: readonly OperationTable[] }) {
  const [setup, setSetup] = usePersistentState<PointSetup>('operations.point', { depthColumn: '', id: '', name: '', position: 'mid' })
  const change = (next: Partial<PointSetup>) => setSetup(current => ({ ...current, ...next }))
  const table = tables.find(item => item.id === setup.id)
  const depthColumn = table !== undefined && setup.depthColumn !== '' && fieldColumns(table).includes(Number(setup.depthColumn)) ? setup.depthColumn : ''
  const defaultName = table ? `${table.name} points` : 'Points'
  const singleDepth = table !== undefined && (depthColumn !== '' || !isIntervalTable(table))
  const create = () => {
    if (table === undefined) return
    const result = calculatePoints(table, setup.position, collars, surveys, depthColumn === '' ? undefined : Number(depthColumn))
    onCreate({ columns: result.columns, name: setup.name.trim() || defaultName, rows: result.located === 0 ? [] : result.rows, note: parts(
      `${count(result.located)} of ${plural(result.rows.length, 'row')} located`,
      result.noCollar > 0 && `${plural(result.noCollar, 'hole')} without a collar left blank`,
      result.vertical > 0 && `${plural(result.vertical, 'hole')} without a survey taken as vertical`) })
  }
  return <>
    <div className="strength-form-grid">
      <TableSelect label="Table" onChange={id => change({ depthColumn: '', id })} tables={tables} value={table?.id ?? ''} />
      <label><span>Depth field</span><select aria-label="Depth field" disabled={table === undefined} onChange={event => change({ depthColumn: event.target.value })} value={depthColumn}>
        <option value="">{table === undefined ? 'Choose a table' : isIntervalTable(table) ? `${table.columns[table.from]} – ${table.columns[table.to]}` : table.columns[table.from]}</option>
        {table === undefined ? null : fieldColumns(table).map(index => <option key={index} value={index}>{table.columns[index]}</option>)}
      </select></label>
      <label><span>Coordinate at</span><select aria-label="Coordinate at" onChange={event => change({ position: event.target.value as PointPosition })} value={setup.position}>
        {positions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label><span>New table name</span><input onChange={event => change({ name: event.target.value })} placeholder={defaultName} value={setup.name} /></label>
    </div>
    {table === undefined ? null : <div className="operation-sources"><TablePreview fields={depthColumn === '' ? [] : [Number(depthColumn)]} table={table} /></div>}
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
  const store = (change: () => void, text: string) => {
    setDialog(null)
    try { change() } catch (error) { fail(error); return }
    // The table is in the open project at once. Its write to the project file follows; the storage retries a failed one.
    setRevision(value => value + 1)
    report(text)
    void storage.flush?.().catch(() => report(`${text} · not written to the project file yet`, true))
  }
  const add = ({ columns, name, note, rows }: Created) => {
    if (rows.length === 0) { report(parts('No rows were produced', note), true); return }
    // Running an operation again makes another table, so the new one gets a name of its own.
    const id = crypto.randomUUID(), taken = new Set(made.map(table => table.name))
    let unique = name
    for (let copy = 2; taken.has(unique); copy++) unique = `${name} ${copy}`
    store(() => { writeOperationTable(storage, { columns, createdAt: new Date().toISOString(), id, name: unique, note, rows }); setActiveId(id) }, parts(`${unique} created`, note))
  }
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    try {
      const [header = [], ...rows] = csvRows((await readImportSource(file)).contents)
      const columns = header.map(column => column.replace(/^\uFEFF/, '').trim())
      if (operationTable('', '', '', columns, rows) === null) throw new Error('The CSV needs a Hole ID column with From and To, or with Depth.')
      add({ columns, name: file.name.replace(/\.[^.]+$/, ''), note: 'Imported CSV', rows: rows.map(row => columns.map((_, index) => (row[index] ?? '').trim())) })
    } catch (error) { fail(error) }
  }
  const rename = (table: StoredOperationTable, value: string) => {
    const name = value.trim()
    if (name === '' || name === table.name) setDialog(null)
    else store(() => writeOperationTable(storage, { ...table, name }), `Renamed to ${name}`)
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
      {dialog === 'export' && active ? <FileNameDialog defaultName={active.name} detail={`Saved as CSV in ${exportTarget.folder}/export/`} onCancel={() => setDialog(null)} onConfirm={name => void exportCsv(active, name)} title="Export table" /> : null}
      {dialog === 'delete' && active ? <div className="dialog-backdrop">
        <section aria-labelledby="operation-delete-title" aria-modal="true" className="strength-dialog" role="dialog">
          <header className="strength-dialog-header"><h2 id="operation-delete-title">Delete {active.name}?</h2><button aria-label="Close delete confirmation" className="icon-button" onClick={() => setDialog(null)} type="button"><X size={18} /></button></header>
          <footer className="strength-dialog-footer"><p>{count(active.rows.length)} rows</p><div><button className="button button-secondary" onClick={() => setDialog(null)} type="button">Cancel</button><button className="button button-accent" onClick={() => store(() => removeOperationTable(storage, active.id), `${active.name} deleted`)} type="button">Delete table</button></div></footer>
        </section>
      </div> : null}
    </div>
  )
}
