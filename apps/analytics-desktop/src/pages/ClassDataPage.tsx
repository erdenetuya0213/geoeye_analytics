import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { classDatabaseDraft, classColumn } from '../data/classDatabaseDraft.js'
import { emptyClassTable, mergeClassImport, parseClassRows, classRowIssue, type ClassTable } from '../data/classTables.js'
import { readClassTables, tableFromImport, writeClassTables, type ClassSection } from '../data/classTableStore.js'
import { readImportSource } from '../data/importSource.js'
import { csvRows } from '../data/tabularCsvImport.js'
import type { ImportSourceFile } from '../desktop/bridge.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { usePersistentState } from '../state/persistentState.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'
import { DatasetToolWorkbench } from './DatasetToolPage.js'

const labels: Record<ClassSection, { tabs: string; unit: string; units: string }> = {
  laboratory: { tabs: 'Lab classes', unit: 'class', units: 'Classes' },
  strength: { tabs: 'Strength tests', unit: 'test', units: 'Tests' },
}

const emptyTable = emptyClassTable('', '')

/** Laboratory and Strength data: user-named classes, one import flow, columns taken from the lab headers. */
export function ClassDataPage({ section }: { section: ClassSection }) {
  const workspace = useDataPoolWorkspace()
  const storage = useProjectStorage()
  const label = labels[section]
  const [stored, setStored] = useState(() => readClassTables(storage, section))
  const [activeId, setActiveId] = usePersistentState<string | null>(`${section}.activeClass`, null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ClassTable | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const databaseDraft = workspace.localTabularDrafts[section]
  // An import saved by an earlier single-table build stays visible until it is edited or re-imported.
  const tables = useMemo(() => stored.length > 0 || databaseDraft === undefined || databaseDraft.columns[0] === classColumn[section]
    ? stored
    : tableFromImport(databaseDraft.fileName, databaseDraft.columns, databaseDraft.rows), [databaseDraft, section, stored])
  const active = tables.find(table => table.id === activeId) ?? tables[0]
  const recordCount = tables.reduce((sum, table) => sum + table.rows.length, 0)
  const holeCount = new Set(tables.flatMap(table => table.rows.map(row => row[0]))).size

  const report = (message: string, isError = false) => { setNotice(message); setNoticeIsError(isError) }
  const fail = (error: unknown) => report(error instanceof Error ? error.message : 'The change could not be saved.', true)

  useEffect(() => {
    if (!workspace.live || databaseDraft !== undefined || recordCount === 0) return
    void workspace.saveTabularImportLocally(classDatabaseDraft(section, tables)).catch(fail)
  }, [databaseDraft, recordCount, section, tables, workspace.live, workspace.saveTabularImportLocally])

  const persist = async (next: ClassTable[], files?: ImportSourceFile[]) => {
    try {
      if (!writeClassTables(storage, section, next)) throw new Error('The changes could not be saved locally.')
      await storage.flush?.()
      if (workspace.live && (databaseDraft !== undefined || next.some(table => table.rows.length > 0))) await workspace.saveTabularImportLocally(classDatabaseDraft(section, next), files)
      setStored(next)
    } catch (error) {
      writeClassTables(storage, section, stored)
      throw error
    }
  }

  const addTable = async () => {
    const table = emptyClassTable(crypto.randomUUID(), `${label.unit[0]!.toUpperCase()}${label.unit.slice(1)} ${tables.length + 1}`)
    await persist([...tables, table])
    setActiveId(table.id)
    setRenamingId(table.id)
  }

  const renameTable = async (table: ClassTable, value: string) => {
    setRenamingId(null)
    const name = value.trim()
    if (name !== '' && name !== table.name) await persist(tables.map(item => item.id === table.id ? { ...item, name } : item))
  }

  const removeTable = async (table: ClassTable) => {
    await persist(tables.filter(item => item.id !== table.id))
    setRemoving(null)
    report(`${table.name} deleted`)
  }

  const importFile = async (file: File) => {
    try {
      const source = await readImportSource(file)
      const imported = parseClassRows(csvRows(source.contents))
      const { added, table } = mergeClassImport(active ?? emptyClassTable(crypto.randomUUID(), file.name.replace(/\.[^.]+$/, '')), imported)
      await persist(active ? tables.map(item => item.id === table.id ? table : item) : [table], [source])
      setActiveId(table.id)
      report(`${imported.rows.length} rows imported into ${table.name} (${added} new, ${imported.skipped} skipped${imported.issues[0] ? ` · ${imported.issues[0]}` : ''})`)
    } catch (error) { fail(error) }
  }

  const changeRows = async (rows: readonly (readonly string[])[]) => {
    if (!active) return
    const issue = rows.map(classRowIssue).find(Boolean)
    if (issue) throw new Error(issue)
    await persist(tables.map(table => table.id === active.id ? { ...table, rows: rows.map(row => [...row]) } : table))
    report('Changes saved locally')
  }

  const publish = async () => {
    setPublishing(true)
    try {
      const result = await workspace.publishLocalTabularImport(section)
      const unmatched = result.unmatchedHoles.length === 0 ? '' : ` · ${result.unmatchedHoles.length} unmatched holes`
      report(`Saved ${result.importedRows.toLocaleString()} rows to Database · v${result.version}${unmatched}`)
    } catch (error) { fail(error) } finally { setPublishing(false) }
  }

  const header = <>
    <section aria-label={`${label.tabs} summary`} className="strength-summary">
      <div><span>{label.units}</span><strong>{tables.length}</strong></div>
      <div><span>Records</span><strong>{recordCount}</strong></div>
      <div><span>Holes</span><strong>{holeCount}</strong></div>
      <div><span>{active?.name ?? `No ${label.unit} yet`}</span><strong>{active?.rows.length ?? 0}</strong><small>{Math.max((active?.columns.length ?? 4) - 4, 0)} fields</small></div>
    </section>
    <div aria-label={label.tabs} className="strength-method-tabs" role="tablist">
      {tables.map(table => table.id === renamingId
        ? <input aria-label={`${label.unit} name`} autoFocus defaultValue={table.name} key={table.id} onBlur={event => void renameTable(table, event.target.value).catch(fail)} onFocus={event => event.target.select()} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setRenamingId(null) }} />
        : <button aria-selected={table.id === active?.id} className={table.id === active?.id ? 'is-active' : ''} key={table.id} onClick={() => setActiveId(table.id)} onDoubleClick={() => setRenamingId(table.id)} role="tab" title="Double-click to rename" type="button">{table.name} <span>{table.rows.length}</span></button>)}
      <button onClick={() => void addTable().catch(fail)} type="button"><Plus size={14} /> Add {label.unit}</button>
      {active ? <div className="strength-test-actions">
        <button aria-label={`Rename ${active.name}`} className="icon-button" onClick={() => setRenamingId(active.id)} title={`Rename ${label.unit}`} type="button"><Pencil size={15} /></button>
        <button aria-label={`Delete ${active.name}`} className="icon-button" onClick={() => active.rows.length === 0 ? void removeTable(active).catch(fail) : setRemoving(active)} title={`Delete ${label.unit}`} type="button"><Trash2 size={15} /></button>
      </div> : null}
    </div>
  </>

  return <>
    <DatasetToolWorkbench
      canWrite={workspace.connected && workspace.project?.canWrite === true}
      config={{ columns: (active ?? emptyTable).columns, rows: (active ?? emptyTable).rows, searchLabel: active ? `${active.name} records` : `${section} records` }}
      emptyHint={`Add a ${label.unit}, name it, then import its CSV. Hole ID, Sample ID, From and To are required; every other column is kept under its own header.`}
      header={header}
      importDraft={databaseDraft}
      notice={notice ?? (databaseDraft?.dirty === true ? 'Local changes have not been saved to the Database.' : null)}
      noticeIsError={noticeIsError}
      onChangeRows={changeRows}
      onImport={importFile}
      {...(workspace.live ? { onPublish: publish } : {})}
      publishing={publishing}
      section={section}
    />
    {removing ? <div className="dialog-backdrop">
      <section aria-labelledby="class-delete-title" aria-modal="true" className="strength-dialog" role="dialog">
        <header className="strength-dialog-header"><h2 id="class-delete-title">Delete {removing.name}?</h2><button aria-label="Close delete confirmation" className="icon-button" onClick={() => setRemoving(null)} type="button"><X size={18} /></button></header>
        <p className="strength-delete-description">The {label.unit} and its {removing.rows.length} records will be removed from the local dataset.</p>
        <footer className="strength-dialog-footer"><p>{removing.rows.length} records</p><div><button className="button button-secondary" onClick={() => setRemoving(null)} type="button">Cancel</button><button className="button button-accent" onClick={() => void removeTable(removing).catch(fail)} type="button">Delete {label.unit}</button></div></footer>
      </section>
    </div> : null}
  </>
}
