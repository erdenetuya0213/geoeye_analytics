import { Check, CircleAlert, Filter, MapPin, Plus, Route, Save, Search, ShieldCheck, Upload } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { DrillholeImportDialog } from '../components/DrillholeImportDialog.js'
import type { DrillholeImportResult, ImportedCollarRecord, ImportedSurveyRecord } from '../components/DrillholeImportDialog.js'
import { drillholes } from '../data/demo.js'
import { readDrillholeImport, saveDrillholeImport } from '../data/drillholeImportStore.js'
import { effectiveDrillholes, effectiveSurveysByHoleId } from '../data/localProjectDb.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { usePersistentState } from '../state/persistentState.js'
import { buildDrillholeTrace, formatTraceDepth } from '../visualization/drillholeTrace.js'

type DrillholeView = 'collar' | 'survey' | 'validation'

const initialCollars: ImportedCollarRecord[] = drillholes.map((hole, index) => ({
  crs: 'EPSG:32648',
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

function normalizedHoleId(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, '')
}

function sameHole(left: string, right: string) {
  return normalizedHoleId(left) === normalizedHoleId(right)
}

function collarStatus(collar: ImportedCollarRecord | undefined) {
  if (collar === undefined) return 'Missing'
  return [collar.easting, collar.northing, collar.elevation].every(Number.isFinite) ? 'Accepted' : 'Review'
}

function surveyStatus(records: readonly ImportedSurveyRecord[]) {
  if (records.length === 0) return 'Missing'
  const valid = (records.at(-1)?.depth ?? 0) > 0 && records.every((record, index) => (
    Number.isFinite(record.depth)
    && record.depth >= 0
    && Number.isFinite(record.azimuth)
    && record.azimuth >= 0
    && record.azimuth < 360
    && Number.isFinite(record.dip)
    && record.dip >= -90
    && record.dip <= 90
    && (index === 0 || record.depth > (records[index - 1]?.depth ?? -1))
  ))
  return valid ? 'Accepted' : 'Review'
}

function metric(value: number | undefined, suffix: string) {
  return value === undefined ? '—' : `${value.toFixed(1)}${suffix}`
}

export function DrillholesPage() {
  const workspace = useDataPoolWorkspace()
  const seedDemo = !workspace.live
  if (workspace.live && (workspace.projectsLoading || workspace.localLoading)) return <div className="page drillholes-page"><div className="eda-state panel">Opening the local drillhole workspace…</div></div>
  if (workspace.live && workspace.project === null) return <div className="page drillholes-page"><div className="eda-state panel">No project is available for this account.</div></div>
  const localVersion = workspace.live ? workspace.project?.id ?? 'none' : 'demo'
  return <CsvDrillholesPage key={localVersion} seedDemo={seedDemo} />
}

function CsvDrillholesPage({ seedDemo }: { seedDemo: boolean }) {
  const workspace = useDataPoolWorkspace()
  const [query, setQuery] = usePersistentState('drillholes.query', '')
  const [selectedId, setSelectedId] = usePersistentState<string>('drillholes.selectedId', drillholes[0].id)
  const [view, setView] = usePersistentState<DrillholeView>('drillholes.view', 'collar')
  const [savedImport] = useState(() => {
    if (seedDemo) return readDrillholeImport()
    if (workspace.localDrillholeDraft !== null) return workspace.localDrillholeDraft
    const holes = effectiveDrillholes(workspace.localSnapshot, null)
    const surveys = effectiveSurveysByHoleId(workspace.localSnapshot, null)
    return {
      collar: holes.flatMap((hole): ImportedCollarRecord[] => hole.collar === null ? [] : [{
        crs: `${hole.collar.crs.authority}:${hole.collar.crs.code}`,
        easting: hole.collar.easting,
        elevation: hole.collar.elevation,
        holeId: hole.name,
        northing: hole.collar.northing,
      }]),
      survey: holes.flatMap((hole) => (surveys[hole.id] ?? []).map((station): ImportedSurveyRecord => ({
        azimuth: station.azimuth,
        depth: station.measuredDepth,
        dip: station.dip,
        holeId: hole.name,
      }))),
    }
  })
  const [collars, setCollars] = useState<ImportedCollarRecord[]>(() => savedImport?.collar ?? (seedDemo ? initialCollars : []))
  const [surveys, setSurveys] = useState<ImportedSurveyRecord[]>(() => savedImport?.survey ?? (seedDemo ? initialSurveys : []))
  const [showImport, setShowImport] = useState(false)
  const [importSummary, setImportSummary] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishSummary, setPublishSummary] = useState('')
  const deferredQuery = useDeferredValue(query)

  const surveyGroups = Array.from(new Set(surveys.map((record) => normalizedHoleId(record.holeId)))).map((normalizedId) => {
    const records = surveys.filter((record) => normalizedHoleId(record.holeId) === normalizedId).sort((a, b) => a.depth - b.depth)
    const last = records.at(-1)
    return { holeId: records[0]?.holeId ?? normalizedId, records, last }
  })
  const validationIds = Array.from(new Map([...collars, ...surveys].map((record) => [normalizedHoleId(record.holeId), record.holeId])).values())

  const sourceRows = view === 'collar'
    ? collars.map((record) => [record.holeId, coordinate(record.easting), coordinate(record.northing), `${coordinate(record.elevation)} m`, record.crs ?? '—', collarStatus(record)])
    : view === 'survey'
      ? surveyGroups.map(({ holeId, records, last }) => [holeId, String(records.length), metric(last?.depth, ' m'), metric(last?.azimuth, '°'), metric(last?.dip, '°'), surveyStatus(records)])
      : validationIds.map((holeId) => {
        const known = seedDemo ? drillholes.find((hole) => hole.id === holeId) : undefined
        const collarQa = collarStatus(collars.find((record) => sameHole(record.holeId, holeId)))
        const holeSurvey = surveys.filter((record) => sameHole(record.holeId, holeId)).sort((a, b) => a.depth - b.depth)
        const surveyQa = surveyStatus(holeSurvey)
        const review = collarQa !== 'Accepted' || surveyQa !== 'Accepted' || known?.collar === 'Review' || known?.survey === 'Review'
        return [holeId, known?.collar ?? collarQa, known?.survey ?? surveyQa, holeSurvey.length > 0 ? 'Computed' : 'Missing', known === undefined ? 'Not loaded' : known.logged === known.depth ? 'Complete' : 'Partial', review ? 'Review' : 'Accepted']
      })

  const supportRows = sourceRows.filter((row) => (row[0] ?? '').toLowerCase().includes(deferredQuery.toLowerCase()))
  const selectedRow = supportRows.find((row) => sameHole(row[0] ?? '', selectedId))
  const effectiveSelectedId = selectedRow?.[0] ?? supportRows[0]?.[0] ?? ''
  const selectedSurveyRecords = surveys.filter((record) => sameHole(record.holeId, effectiveSelectedId)).sort((a, b) => a.depth - b.depth)
  const firstSurvey = selectedSurveyRecords[0]
  const selectedCollar = collars.find((record) => sameHole(record.holeId, effectiveSelectedId))
  const knownSelected = seedDemo ? drillholes.find((hole) => hole.id === effectiveSelectedId) : undefined
  const trace = buildDrillholeTrace(selectedSurveyRecords)
  const selected = effectiveSelectedId === '' ? null : {
    depth: trace.totalDepth,
    id: effectiveSelectedId,
    status: knownSelected?.status ?? (collarStatus(selectedCollar) === 'Accepted' && surveyStatus(selectedSurveyRecords) === 'Accepted' ? 'Ready' : 'Incomplete'),
  }

  const views = [
    { id: 'collar', label: 'Collar', count: `${collars.length} records`, icon: MapPin },
    { id: 'survey', label: 'Survey', count: `${surveys.length} stations`, icon: Route },
    { id: 'validation', label: 'Validation', count: `${validationIds.length} holes`, icon: ShieldCheck },
  ] as const

  const applyImport = (result: DrillholeImportResult) => {
    setCollars(result.collar)
    setSurveys(result.survey)
    if (seedDemo) saveDrillholeImport(result)
    else void workspace.saveDrillholesLocally(result)
    setSelectedId(result.collar[0]?.holeId ?? result.survey[0]?.holeId ?? selectedId)
    setView('collar')
    setImportSummary(`${result.collar.length} collar · ${result.survey.length} survey rows imported`)
    setShowImport(false)
  }

  const publish = async () => {
    setPublishing(true)
    try {
      const report = await workspace.publishLocalDrillholes()
      const details = [`${report.collars} collars`, `${report.surveys} surveys (${report.stations} stations)`]
      if (report.unknownHoles.length > 0) details.push(`${report.unknownHoles.length} unknown holes`)
      if (report.problems.length > 0) details.push(...report.problems)
      setPublishSummary(details.join(' · '))
    } finally {
      setPublishing(false)
    }
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
        {!seedDemo ? (
          <button
            className="button button-primary"
            disabled={publishing || !workspace.project?.canWrite || workspace.localDrillholeDraft?.dirty !== true}
            onClick={() => void publish()}
            title={!workspace.project?.canWrite ? 'Your role on this project is read-only' : workspace.localDrillholeDraft?.dirty === true ? 'Send the local collar and survey draft to the Database' : 'The local drillhole draft is already saved'}
            type="button"
          >
            <Save size={16} /> {publishing ? 'Saving…' : 'Save to Database'}
          </button>
        ) : null}
        <button className="button button-primary" type="button"><Plus size={16} /> Add drillhole</button>
      </div>

      {!seedDemo ? <p className="pool-live-note" role="status">{publishSummary || (workspace.localDrillholeDraft?.dirty === true ? 'Local changes are preserved on this computer and have not been sent to the Database.' : 'Showing the persistent local project copy.')}</p> : null}

      <div className="drillhole-layout">
        <section className="panel drillhole-table-panel">
          <div className="borehole-data-table">
            <div className="borehole-data-row borehole-data-header">
              {supportColumns[view].map((column) => <span key={column}>{column}</span>)}
            </div>
            {supportRows.length === 0 ? <p className="pool-live-note">Import collar and survey CSV files to populate this workspace.</p> : null}
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
          {selected === null ? <p className="pool-live-note">No imported drillhole selected.</p> : (
            <>
          <div className="hole-detail-heading"><div><p className="eyebrow">Selected hole</p><h2>{selected.id}</h2></div><span className="status-chip">{selected.status}</span></div>
          <div className="trace-visual">
            {trace.path === '' ? <p className="trace-empty">No positive-depth survey stations</p> : (
              <>
                <div className="trace-scale">{trace.depthTicks.map((depth, index) => <span key={depth}>{formatTraceDepth(depth)}{index === 0 || index === trace.depthTicks.length - 1 ? ' m' : ''}</span>)}</div>
                <svg aria-label={`Survey-derived drill trace for ${selected.id}`} viewBox="0 0 180 290" role="img">
                  <path d={trace.path} fill="none" stroke="#d7ded9" strokeLinecap="round" strokeLinejoin="round" strokeWidth="12" />
                  <path d={trace.path} fill="none" stroke="#287c70" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
                  {trace.points.map((point, index) => <circle className={index === trace.points.length - 1 ? 'is-last' : undefined} cx={point.x} cy={point.y} key={`${point.depth}-${index}`} r="4" strokeWidth="2" />)}
                </svg>
              </>
            )}
          </div>
          <div className="hole-stats">
            <div><span>Total depth</span><strong>{metric(selected.depth ?? undefined, ' m')}</strong></div>
            <div><span>Collar azimuth</span><strong>{metric(firstSurvey?.azimuth, '°')}</strong></div>
            <div><span>Collar dip</span><strong>{metric(firstSurvey?.dip, '°')}</strong></div>
            <div><span>Survey stations</span><strong>{selectedSurveyRecords.length}</strong></div>
          </div>
          <div className="coordinate-card"><MapPin size={17} /><div><span>{selectedCollar === undefined ? 'Collar' : `Collar · ${selectedCollar.crs ?? 'CRS not supplied'}`}</span><strong>{selectedCollar === undefined ? 'No collar imported' : `E ${coordinate(selectedCollar.easting)} · N ${coordinate(selectedCollar.northing)} · RL ${coordinate(selectedCollar.elevation)}`}</strong></div></div>
            </>
          )}
        </aside>
      </div>

      {showImport ? <DrillholeImportDialog onClose={() => setShowImport(false)} onImport={applyImport} /> : null}
    </div>
  )
}
