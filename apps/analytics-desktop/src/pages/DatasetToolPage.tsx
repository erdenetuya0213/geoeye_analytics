import type { ObservationValue, TabularImportInput, TabularImportResult, VariableDefinition } from '@geoeye/datapool-client'
import { AlertCircle, CheckCircle2, Filter, RefreshCw, Save, Search, Upload } from 'lucide-react'
import { useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { usePersistentState } from '../state/persistentState.js'
import { effectiveDrillholes, type LocalDrillholeDraft, type LocalProjectSnapshot, type LocalTabularDraft } from '../data/localProjectDb.js'
import { parseTabularCsv } from '../data/tabularCsvImport.js'
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
    rows: [['ALS-24018-031', 'GOR-DD-018', '82.0 m', '83.0 m', '1.42'], ['ALS-24018-032', 'GOR-DD-018', '83.0 m', '84.0 m', '2.18'], ['ALS-24018-033', 'GOR-DD-018', '84.0 m', '85.0 m', '0.76'], ['ALS-24017-114', 'GOR-DD-017', '112.0 m', '113.0 m', '3.08']],
  },
  xrf: {
    searchLabel: 'XRF readings',
    columns: ['Reading', 'Hole ID', 'Depth', 'Cu ppm', 'Instrument'],
    rows: [['XRF-0912-284', 'GOR-DD-018', '82.5 m', '1,842', 'PXRF-02'], ['XRF-0912-285', 'GOR-DD-018', '83.5 m', '2,194', 'PXRF-02'], ['XRF-0912-286', 'GOR-DD-018', '84.5 m', '1,016', 'PXRF-02'], ['XRF-0911-118', 'GOR-DD-017', '112.5 m', '2,807', 'PXRF-01']],
  },
  spectral: {
    searchLabel: 'spectral scans',
    columns: ['Scan ID', 'Hole ID', 'Depth', 'Mineral', 'Score'],
    rows: [['SPC-018-0082', 'GOR-DD-018', '82.0 m', 'Chlorite', '0.96'], ['SPC-018-0083', 'GOR-DD-018', '83.0 m', 'Sericite', '0.91'], ['SPC-018-0084', 'GOR-DD-018', '84.0 m', 'Epidote', '0.88'], ['SPC-017-0112', 'GOR-DD-017', '112.0 m', 'Kaolinite', '0.93']],
  },
}

export function DatasetToolPage({ section }: { section: DatasetSection }) {
  const workspace = useDataPoolWorkspace()
  if (workspace.live) {
    if (workspace.projectsLoading || workspace.localLoading) return <div className="page dataset-tool-page"><div className="eda-state panel">Opening the local project copy…</div></div>
    if (workspace.project === null) return <div className="page dataset-tool-page"><div className="eda-state panel">No project is available for this account.</div></div>
    return <LiveDatasetToolPage
      canWrite={workspace.project.canWrite}
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
  return <DatasetToolWorkbench config={configs[section]} section={section} />
}

function DatasetToolWorkbench({ canWrite = true, config, importDraft, notice, noticeIsError = false, onImport, onPublish, onRefresh, publishing = false, refreshing = false, section }: {
  canWrite?: boolean
  config: DatasetToolConfig
  importDraft?: LocalTabularDraft | undefined
  notice?: string | null
  noticeIsError?: boolean
  onImport?: (file: File) => Promise<void>
  onPublish?: () => Promise<void>
  onRefresh?: () => void
  publishing?: boolean
  refreshing?: boolean
  section: DatasetSection
}) {
  const [query, setQuery] = usePersistentState(`datasetTool.${section}.query`, '')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const filteredRows = useMemo(() => config.rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(query.toLowerCase()))), [config.rows, query])
  const rowStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${config.columns.length}, minmax(110px, 1fr))`,
    minWidth: `${Math.max(600, config.columns.length * 122)}px`,
  }
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file !== undefined) void onImport?.(file)
  }

  return (
    <div className="page dataset-tool-page">
      <h1 className="sr-only">{config.searchLabel}</h1>

      <div className="filter-bar drillhole-control-bar dataset-control-bar">
        <label className="table-search"><Search size={16} /><input aria-label={`Search ${config.searchLabel}`} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${config.searchLabel}…`} value={query} /></label>
        <button className="filter-button" type="button"><Filter size={15} /> All records</button>
        <span className="result-count">{filteredRows.length} shown</span>
        {notice === undefined || notice === null ? null : <span className={`strength-save-notice ${noticeIsError ? 'is-error' : ''}`} role={noticeIsError ? 'alert' : 'status'}>{noticeIsError ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />} {notice}</span>}
        <button className="button button-secondary" disabled={refreshing} onClick={onRefresh} type="button"><RefreshCw className={refreshing ? 'spin' : ''} size={16} /> Refresh local copy</button>
        <input accept=".csv,text/csv" aria-label={`Choose a ${section} CSV file`} className="sr-only" onChange={handleFile} ref={fileInputRef} type="file" />
        <button className="button button-secondary" onClick={() => fileInputRef.current?.click()} type="button"><Upload size={16} /> Import CSV</button>
        {onPublish === undefined ? null : <button className="button button-primary" disabled={publishing || !canWrite || importDraft?.dirty !== true} onClick={() => void onPublish()} title={!canWrite ? 'Your role on this project is read-only' : importDraft?.dirty === true ? 'Send this local CSV draft to the Database' : 'Import or change a CSV before saving'} type="button"><Save size={16} /> {publishing ? 'Saving…' : 'Save to Database'}</button>}
      </div>

      <section className="panel dataset-records-panel">
        <div className="dataset-record-table">
          <div className="dataset-record-row dataset-record-header" style={rowStyle}>
            {config.columns.map((column) => <span key={column}>{column}</span>)}
          </div>
          {filteredRows.map((row) => (
            <button className="dataset-record-row" key={row.join('-')} style={rowStyle} type="button">
              {row.map((cell, index) => <span className={index === 0 ? 'dataset-record-key' : ''} key={`${cell}-${index}`}>{cell}</span>)}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function supportsSection(section: DatasetSection, definition: VariableDefinition, sourceLabel: string): boolean {
  const haystack = `${definition.key} ${definition.displayName} ${sourceLabel}`.toLowerCase()
  if (section === 'laboratory') return /assay|laborator|geochem|sample/.test(haystack)
  if (section === 'xrf') return /(^|[. _-])xrf|fluorescence/.test(haystack)
  return /spectral|spectrum|specim|mineral/.test(haystack)
}

function displayObservationValue(observation: ObservationValue, definition: VariableDefinition | undefined): string {
  const value = observation.numericValue
    ?? observation.categoryValue
    ?? observation.textValue
    ?? observation.booleanValue
    ?? observation.datetimeValue
  if (value === null) return '—'
  const unit = observation.unit ?? definition?.canonicalUnit
  return `${String(value)}${unit === null || unit === undefined || unit === '' ? '' : ` ${unit}`}`
}

function LiveDatasetToolPage({ canWrite, drillholeDraft, importDraft, onPublish, onRefresh, onSaveLocal, refreshing, section, snapshot }: {
  canWrite: boolean
  drillholeDraft: LocalDrillholeDraft | null
  importDraft?: LocalTabularDraft | undefined
  onPublish: () => Promise<TabularImportResult>
  onRefresh: () => Promise<void>
  onSaveLocal: (value: TabularImportInput) => Promise<void>
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
      const definitions = new Map(variables.map((variable) => [variable.key, variable]))
      const holeNames = new Map(holes.map((hole) => [hole.id, hole.name]))
      const rows = observations.flatMap((observation): readonly string[][] => {
        const dataset = datasetById.get(observation.datasetId)
        const definition = definitions.get(observation.variableKey)
        if (definition === undefined || dataset === undefined || !supportsSection(section, definition, `${dataset.name} ${dataset.producerName} ${dataset.producerType}`)) return []
        const interval = observation.depthFrom === null
          ? 'Project'
          : observation.depthTo === null || observation.depthTo === observation.depthFrom
            ? `${observation.depthFrom.toFixed(2)} m`
            : `${observation.depthFrom.toFixed(2)}–${observation.depthTo.toFixed(2)} m`
        return [[
          observation.sourceId,
          observation.holeId === null ? '—' : holeNames.get(observation.holeId) ?? observation.holeId,
          interval,
          definition.displayName,
          displayObservationValue(observation, definition),
        ]]
      })
      return {
        columns: ['Source record', 'Drillhole', 'Interval', 'Variable', 'Value'],
        rows,
        searchLabel: configs[section].searchLabel,
      }
    }, [drillholeDraft, importDraft, section, snapshot])

  const importFile = async (file: File) => {
    try {
      const parsed = parseTabularCsv(await file.text(), file.name, section)
      await onSaveLocal(parsed)
      setNoticeIsError(false)
      setNotice(`${parsed.rows.length.toLocaleString()} rows imported locally; Database unchanged`)
    } catch (error) {
      setNoticeIsError(true)
      setNotice(error instanceof Error ? error.message : 'The CSV could not be imported.')
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

  return <DatasetToolWorkbench canWrite={canWrite} config={config} importDraft={importDraft} notice={notice ?? (importDraft?.dirty === true ? 'Local CSV changes have not been saved to the Database.' : null)} noticeIsError={noticeIsError} onImport={importFile} onPublish={publish} onRefresh={() => { void onRefresh() }} publishing={publishing} refreshing={refreshing} section={section} />
}
