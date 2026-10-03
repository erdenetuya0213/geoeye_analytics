import { Check, CircleAlert, Filter, MapPin, Plus, Route, Search, ShieldCheck, Upload } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { DrillholeImportDialog } from '../components/DrillholeImportDialog.js'
import type { DrillholeImportResult, ImportedCollarRecord, ImportedSurveyRecord } from '../components/DrillholeImportDialog.js'
import { drillholes } from '../data/demo.js'
import { saveDrillholeImport } from '../data/drillholeImportStore.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { LiveDrillholesPage } from './LiveDrillholesPage.js'
import { usePersistentState } from '../state/persistentState.js'

type DrillholeView = 'collar' | 'survey' | 'validation'

const initialCollars: ImportedCollarRecord[] = drillholes.map((hole, index) => ({
  holeId: hole.id,
  easting: 518426.32 - index * 19,
  northing: 5324118.76 + index * 15,
  elevation: 1428.4 + index * .7,
}))

const initialSurveys: ImportedSurveyRecord[] = drillholes.flatMap((hole, index) => [0, .5, 1].map((ratio, stationIndex) => ({
  holeId: hole.id,
  depth: hole.depth * ratio,
  azimuth: 42.6 + index + stationIndex * .8,
  dip: -62 + index + stationIndex * .6,
})))

const supportColumns: Record<DrillholeView, readonly string[]> = {
  collar: ['Hole ID', 'Easting', 'Northing', 'RL', 'CRS', 'QA'],
  survey: ['Hole ID', 'Stations', 'Last depth', 'Azimuth', 'Dip', 'QA'],
  validation: ['Hole ID', 'Collar', 'Survey', 'Trace', 'Intervals', 'Overall'],
}

function coordinate(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

export function DrillholesPage() {
  const workspace = useDataPoolWorkspace()
  if (workspace.live && workspace.client !== null && workspace.project !== null) {
    return <LiveDrillholesPage client={workspace.client} project={workspace.project} scope={workspace.scope} />
  }
  return <DemoDrillholesPage />
}

function DemoDrillholesPage() {
  const [query, setQuery] = usePersistentState('drillholes.query', '')
  const [selectedId, setSelectedId] = usePersistentState<string>('drillholes.selectedId', drillholes[0].id)
  const [view, setView] = usePersistentState<DrillholeView>('drillholes.view', 'collar')
  const [collars, setCollars] = useState<ImportedCollarRecord[]>(initialCollars)
  const [surveys, setSurveys] = useState<ImportedSurveyRecord[]>(initialSurveys)
  const [showImport, setShowImport] = useState(false)
  const [importSummary, setImportSummary] = useState('')
  const deferredQuery = useDeferredValue(query)

  const surveyGroups = Array.from(new Set(surveys.map((record) => record.holeId))).map((holeId) => {
    const records = surveys.filter((record) => record.holeId === holeId).sort((a, b) => a.depth - b.depth)
    const last = records.at(-1)
    return { holeId, records, last }
  })
  const validationIds = Array.from(new Set([...collars.map((record) => record.holeId), ...surveys.map((record) => record.holeId)]))

  const sourceRows = view === 'collar'
    ? collars.map((record) => [record.holeId, coordinate(record.easting), coordinate(record.northing), `${coordinate(record.elevation)} m`, 'EPSG:32648', 'Accepted'])
    : view === 'survey'
      ? surveyGroups.map(({ holeId, records, last }) => [holeId, String(records.length), `${(last?.depth ?? 0).toFixed(1)} m`, `${(last?.azimuth ?? 0).toFixed(1)}°`, `${(last?.dip ?? 0).toFixed(1)}°`, 'Accepted'])
      : validationIds.map((holeId) => {
        const known = drillholes.find((hole) => hole.id === holeId)
        const collarReady = collars.some((record) => record.holeId === holeId)
        const surveyReady = surveys.some((record) => record.holeId === holeId)
        const review = !collarReady || !surveyReady || known?.collar === 'Review' || known?.survey === 'Review'
        return [holeId, collarReady ? known?.collar ?? 'Accepted' : 'Missing', surveyReady ? known?.survey ?? 'Accepted' : 'Missing', known?.logged === known?.depth ? 'Complete' : 'Partial', review ? 'Review' : 'Continuous', review ? 'Review' : 'Accepted']
      })

  const supportRows = sourceRows.filter((row) => (row[0] ?? '').toLowerCase().includes(deferredQuery.toLowerCase()))
  const effectiveSelectedId = supportRows.some((row) => row[0] === selectedId) ? selectedId : (supportRows[0]?.[0] ?? selectedId)
  const selectedSurveyRecords = surveys.filter((record) => record.holeId === effectiveSelectedId).sort((a, b) => a.depth - b.depth)
  const selectedSurvey = selectedSurveyRecords.at(-1)
  const selectedCollar = collars.find((record) => record.holeId === effectiveSelectedId)
  const knownSelected = drillholes.find((hole) => hole.id === effectiveSelectedId)
  const selected = knownSelected ?? {
    id: effectiveSelectedId,
    depth: selectedSurvey?.depth ?? 0,
    logged: 0,
    structures: 0,
    collar: selectedCollar === undefined ? 'Review' : 'Validated',
    survey: selectedSurvey === undefined ? 'Review' : 'Validated',
    status: 'Imported',
  }

  const views = [
    { id: 'collar', label: 'Collar', count: `${collars.length} records`, icon: MapPin },
    { id: 'survey', label: 'Survey', count: `${surveys.length} stations`, icon: Route },
    { id: 'validation', label: 'Validation', count: `${validationIds.length} holes`, icon: ShieldCheck },
  ] as const

  const applyImport = (result: DrillholeImportResult) => {
    if (result.collar.length > 0) setCollars(result.collar)
    if (result.survey.length > 0) setSurveys(result.survey)
    saveDrillholeImport(result)
    setSelectedId(result.collar[0]?.holeId ?? result.survey[0]?.holeId ?? selectedId)
    setView('collar')
    setImportSummary(`${result.collar.length} collar · ${result.survey.length} survey rows imported`)
    setShowImport(false)
  }

  return (
    <div className="page drillholes-page">
      <h1 className="sr-only">Drillholes</h1>

      <nav aria-label="Drillhole data views" className="drillhole-view-tabs">
        {views.map((item) => {
          const Icon = item.icon
          return (
            <button aria-pressed={view === item.id} className={view === item.id ? 'is-active' : ''} key={item.id} onClick={() => setView(item.id)} type="button">
              <Icon size={17} /><span><strong>{item.label}</strong><small>{item.count}</small></span>
            </button>
          )
        })}
      </nav>

      <div className="filter-bar drillhole-control-bar">
        <label className="table-search"><Search size={16} /><input aria-label="Search drillholes" onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${view}…`} value={query} /></label>
        <button className="filter-button" type="button"><Filter size={15} /> Status: All</button>
        <button className="filter-button" type="button">Validation: All</button>
        {importSummary === '' ? <span className="result-count">{supportRows.length} shown</span> : <span className="import-summary"><Check size={13} />{importSummary}</span>}
        <button className="button button-secondary" onClick={() => setShowImport(true)} type="button"><Upload size={16} /> Import CSV</button>
        <button className="button button-primary" type="button"><Plus size={16} /> Add drillhole</button>
      </div>

      <div className="drillhole-layout">
        <section className="panel drillhole-table-panel">
          <div className="borehole-data-table">
            <div className="borehole-data-row borehole-data-header">
              {supportColumns[view].map((column) => <span key={column}>{column}</span>)}
            </div>
            {supportRows.map((row) => {
              const rowId = row[0] ?? ''
              const review = row[row.length - 1] === 'Review'
              return (
                <button className={`borehole-data-row ${rowId === effectiveSelectedId ? 'is-selected' : ''}`} key={`${view}-${row.join('-')}`} onClick={() => setSelectedId(rowId)} type="button">
                  {row.map((cell, index) => <span className={index === 0 ? 'hole-id' : index === row.length - 1 ? `validation-label ${review ? 'needs-review' : ''}` : ''} key={`${cell}-${index}`}>{index === 0 ? <i /> : null}{index === row.length - 1 ? review ? <CircleAlert size={13} /> : <Check size={13} /> : null}{cell}</span>)}
                </button>
              )
            })}
          </div>
        </section>

        <aside className="panel hole-detail-panel">
          <div className="hole-detail-heading"><div><p className="eyebrow">Selected hole</p><h2>{selected.id}</h2></div><span className="status-chip">{selected.status}</span></div>
          <div className="trace-visual">
            <div className="trace-scale"><span>0 m</span><span>100</span><span>200</span><span>300</span><span>{Math.round(selected.depth)} m</span></div>
            <svg aria-label={`Simplified drill trace for ${selected.id}`} viewBox="0 0 180 290" role="img">
              <path d="M65 12C66 58 78 86 84 128C92 178 100 223 126 278" fill="none" stroke="#d7ded9" strokeLinecap="round" strokeWidth="12" />
              <path d="M65 12C66 58 78 86 84 128C92 178 100 223 126 278" fill="none" stroke="#287c70" strokeLinecap="round" strokeWidth="4" />
              {[40, 78, 111, 148, 183, 221, 252].map((y, index) => <circle cx={70 + index * 7.5} cy={y} fill={index === 4 ? '#d1813c' : '#fff'} key={y} r="4" stroke={index === 4 ? '#d1813c' : '#287c70'} strokeWidth="2" />)}
            </svg>
          </div>
          <div className="hole-stats">
            <div><span>Total depth</span><strong>{selected.depth.toFixed(1)} m</strong></div>
            <div><span>Azimuth</span><strong>{(selectedSurvey?.azimuth ?? 42.6).toFixed(1)}°</strong></div>
            <div><span>Dip</span><strong>{(selectedSurvey?.dip ?? -62).toFixed(1)}°</strong></div>
            <div><span>Structures</span><strong>{selected.structures}</strong></div>
          </div>
          <div className="coordinate-card"><MapPin size={17} /><div><span>Collar · EPSG:32648</span><strong>E {coordinate(selectedCollar?.easting ?? 0)} · N {coordinate(selectedCollar?.northing ?? 0)} · RL {coordinate(selectedCollar?.elevation ?? 0)}</strong></div></div>
        </aside>
      </div>

      {showImport ? <DrillholeImportDialog onClose={() => setShowImport(false)} onImport={applyImport} /> : null}
    </div>
  )
}
