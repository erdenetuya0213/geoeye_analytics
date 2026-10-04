import type { DataPoolClient, ProjectSummary } from '@geoeye/datapool-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleAlert, MapPin, Search, Upload } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { DrillholeImportDialog } from '../components/DrillholeImportDialog.js'
import type { DrillholeImportResult } from '../components/DrillholeImportDialog.js'
import { planDrillholePublish } from '../data/drillholePublish.js'
import { usePersistentState } from '../state/persistentState.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'

interface LiveDrillholesPageProps {
  client: DataPoolClient
  project: ProjectSummary
  scope: string
}

interface PublishReport {
  collars: number
  surveys: number
  stations: number
  unknownHoles: string[]
  problems: string[]
}

const crsStorageKey = 'geoeye.analytics.collar-epsg.v1'
const columns = ['Hole ID', 'Easting', 'Northing', 'RL', 'CRS', 'Survey'] as const

function coordinate(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

/** Drillholes of the active Data Pool project. Collar and survey are edited here and shared with Field. */
export function LiveDrillholesPage({ client, project, scope }: LiveDrillholesPageProps) {
  const storage = useProjectStorage()
  const queryClient = useQueryClient()
  const holesKey = ['datapool', scope, project.id, 'drillholes'] as const
  const [query, setQuery] = usePersistentState('liveDrillholes.query', '', { scope: project.id })
  const [selectedId, setSelectedId] = usePersistentState<string | null>('liveDrillholes.selectedId', null, { scope: project.id })
  const [epsg, setEpsg] = useState(() => storage.getItem(crsStorageKey) ?? '')
  const [showImport, setShowImport] = useState(false)
  const [report, setReport] = useState<PublishReport | null>(null)
  const deferredQuery = useDeferredValue(query)

  const holesQuery = useQuery({ queryKey: holesKey, queryFn: () => client.drillholes(project.id) })
  const holes = holesQuery.data ?? []
  const visible = holes.filter((hole) => hole.name.toLowerCase().includes(deferredQuery.trim().toLowerCase()))
  const selected = visible.find((hole) => hole.id === selectedId) ?? visible[0] ?? null

  const surveyQuery = useQuery({
    queryKey: [...holesKey, selected?.id ?? 'none', 'surveys'],
    queryFn: () => selected === null ? [] : client.surveys(project.id, selected.id),
    enabled: selected !== null && selected.surveyStationCount > 0,
  })
  const stations = selected !== null && selected.surveyStationCount > 0 ? surveyQuery.data ?? [] : []

  const epsgCode = epsg.trim()
  const epsgValid = /^\d{4,6}$/.test(epsgCode)

  const publish = useMutation({
    mutationFn: async (result: DrillholeImportResult): Promise<PublishReport> => {
      const plan = planDrillholePublish(result, holes)
      const problems = [...plan.rejected]
      let collars = 0
      let surveys = 0
      let stationCount = 0
      for (const collar of plan.collars) {
        try {
          await client.saveCollar(project.id, collar.holeId, {
            easting: collar.easting,
            northing: collar.northing,
            elevation: collar.elevation,
            crs: { authority: 'EPSG', code: epsgCode },
            source: 'GeoEye Analytics CSV import',
          })
          collars += 1
        } catch {
          problems.push(`${collar.holeName}: the Database rejected the collar`)
        }
      }
      for (const survey of plan.surveys) {
        try {
          await client.replaceSurveys(project.id, survey.holeId, {
            stations: survey.stations.map((station) => ({ ...station, source: 'GeoEye Analytics CSV import' })),
          })
          surveys += 1
          stationCount += survey.stations.length
        } catch {
          problems.push(`${survey.holeName}: the Database rejected the survey`)
        }
      }
      return { collars, surveys, stations: stationCount, unknownHoles: plan.unknownHoles, problems }
    },
    onSuccess: (result) => setReport(result),
    onSettled: () => queryClient.invalidateQueries({ queryKey: holesKey }),
  })

  const applyImport = async (result: DrillholeImportResult) => {
    setReport(null)
    await publish.mutateAsync(result)
    setShowImport(false)
  }

  const changeEpsg = (value: string) => {
    setEpsg(value)
    storage.setItem(crsStorageKey, value.trim())
  }

  const withCollar = holes.filter((hole) => hole.collar !== null).length
  const surveyed = holes.filter((hole) => hole.surveyStationCount > 0).length
  const reportHasProblems = report !== null && (report.problems.length > 0 || report.unknownHoles.length > 0)

  return (
    <div className="page drillholes-page">
      <h1 className="sr-only">Drillholes</h1>

      <div className="filter-bar drillhole-control-bar">
        <label className="table-search"><Search size={16} /><input aria-label="Search drillholes" onChange={(event) => setQuery(event.target.value)} placeholder="Search drillholes…" value={query} /></label>
        <label className="drillhole-crs-field">
          <span>Collar CRS EPSG</span>
          <input aria-invalid={epsgCode !== '' && !epsgValid} aria-label="EPSG code for imported collars" inputMode="numeric" onChange={(event) => changeEpsg(event.target.value)} placeholder="32648" value={epsg} />
        </label>
        <span className="result-count">{holes.length} holes · {withCollar} with collar · {surveyed} surveyed</span>
        <button
          className="button button-secondary"
          disabled={!project.canWrite || !epsgValid || publish.isPending || holes.length === 0}
          onClick={() => setShowImport(true)}
          title={!project.canWrite ? 'Your role on this project is read-only' : epsgValid ? 'Import collar and survey CSV files into the Database' : 'Enter the EPSG code of the collar coordinates first'}
          type="button"
        >
          <Upload size={16} /> {publish.isPending ? 'Publishing…' : 'Import CSV'}
        </button>
      </div>

      {publish.isError ? (
        <div className="drillhole-publish-report has-problems" role="alert">The import could not be published to the Database. No summary is available; reload to see what was saved.</div>
      ) : null}
      {report !== null ? (
        <div className={`drillhole-publish-report ${reportHasProblems ? 'has-problems' : ''}`} role="status">
          <strong>Published to the Database: {report.collars} collars, {report.surveys} surveys ({report.stations} stations).</strong>
          {report.unknownHoles.length > 0 ? (
            <p>Not in this project, so not imported: {report.unknownHoles.join(', ')}. Drillholes are created in GeoEye Field.</p>
          ) : null}
          {report.problems.length > 0 ? <ul>{report.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
        </div>
      ) : null}

      <div className="drillhole-layout">
        <section className="panel drillhole-table-panel">
          <div className="borehole-data-table">
            <div className="borehole-data-row borehole-data-header">
              {columns.map((column) => <span key={column}>{column}</span>)}
            </div>
            {holesQuery.isError ? <p className="pool-live-note is-error" role="alert"><CircleAlert size={14} /> Drillholes could not be loaded from the Database.</p> : null}
            {holesQuery.isPending ? <p className="pool-live-note">Loading drillholes…</p> : null}
            {!holesQuery.isPending && !holesQuery.isError && holes.length === 0 ? (
              <p className="pool-live-note">{project.name} has no drillholes yet. Drillholes appear here once GeoEye Field creates them.</p>
            ) : null}
            {visible.map((hole) => {
              const ready = hole.collar !== null && hole.surveyStationCount > 0
              return (
                <button className={`borehole-data-row ${hole.id === selected?.id ? 'is-selected' : ''}`} key={hole.id} onClick={() => setSelectedId(hole.id)} type="button">
                  <span className="hole-id"><i />{hole.name}</span>
                  <span>{hole.collar === null ? '—' : coordinate(hole.collar.easting)}</span>
                  <span>{hole.collar === null ? '—' : coordinate(hole.collar.northing)}</span>
                  <span>{hole.collar === null ? '—' : `${coordinate(hole.collar.elevation)} m`}</span>
                  <span>{hole.collar === null ? '—' : `${hole.collar.crs.authority}:${hole.collar.crs.code}`}</span>
                  <span className={`validation-label ${ready ? '' : 'needs-review'}`}>
                    {ready ? <Check size={13} /> : <CircleAlert size={13} />}
                    {hole.surveyStationCount === 0 ? 'No survey' : `${hole.surveyStationCount} stations`}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <aside className="panel hole-detail-panel">
          {selected === null ? <p className="pool-live-note">Select a drillhole.</p> : (
            <>
              <div className="hole-detail-heading">
                <div><p className="eyebrow">Selected hole</p><h2>{selected.name}</h2></div>
                <span className="status-chip">{selected.collar !== null && selected.surveyStationCount > 0 ? 'Ready to desurvey' : 'Incomplete'}</span>
              </div>
              <div className="hole-stats">
                <div><span>Survey stations</span><strong>{selected.surveyStationCount}</strong></div>
                <div><span>Last station</span><strong>{stations.length === 0 ? '—' : `${(stations.at(-1)?.measuredDepth ?? 0).toFixed(1)} m`}</strong></div>
                <div><span>Collar azimuth</span><strong>{stations.length === 0 ? '—' : `${(stations[0]?.azimuth ?? 0).toFixed(1)}°`}</strong></div>
                <div><span>Collar dip</span><strong>{stations.length === 0 ? '—' : `${(stations[0]?.dip ?? 0).toFixed(1)}°`}</strong></div>
              </div>
              <div className="coordinate-card">
                <MapPin size={17} />
                <div>
                  <span>{selected.collar === null ? 'Collar' : `Collar · ${selected.collar.crs.authority}:${selected.collar.crs.code} · ${selected.collar.source}`}</span>
                  <strong>{selected.collar === null
                    ? 'No collar in the Database yet'
                    : `E ${coordinate(selected.collar.easting)} · N ${coordinate(selected.collar.northing)} · RL ${coordinate(selected.collar.elevation)}`}</strong>
                </div>
              </div>
              {stations.length > 0 ? (
                <ul aria-label={`Survey stations of ${selected.name}`} className="survey-station-list">
                  <li>Depth</li><li>Azimuth</li><li>Dip</li>
                  {stations.slice(0, 40).flatMap((station) => [
                    <li key={`${station.id}-depth`}>{station.measuredDepth.toFixed(1)}</li>,
                    <li key={`${station.id}-azimuth`}>{station.azimuth.toFixed(1)}°</li>,
                    <li key={`${station.id}-dip`}>{station.dip.toFixed(1)}°</li>,
                  ])}
                </ul>
              ) : null}
            </>
          )}
        </aside>
      </div>

      {showImport ? <DrillholeImportDialog onClose={() => setShowImport(false)} onImport={applyImport} /> : null}
    </div>
  )
}
