import type { DataPoolClient, ObservationValue, ProjectSummary, VariableDefinition } from '@geoeye/datapool-client'
import { useQuery } from '@tanstack/react-query'
import { Filter, RefreshCw, Search, Upload } from 'lucide-react'
import { useMemo } from 'react'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { usePersistentState } from '../state/persistentState.js'
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
  if (workspace.live && workspace.client !== null && workspace.project !== null) {
    return <LiveDatasetToolPage client={workspace.client} project={workspace.project} scope={workspace.scope} section={section} />
  }
  return <DatasetToolWorkbench config={configs[section]} section={section} />
}

function DatasetToolWorkbench({ config, section }: { config: DatasetToolConfig; section: DatasetSection }) {
  const [query, setQuery] = usePersistentState(`datasetTool.${section}.query`, '')
  const filteredRows = useMemo(() => config.rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(query.toLowerCase()))), [config.rows, query])

  return (
    <div className="page dataset-tool-page">
      <h1 className="sr-only">{config.searchLabel}</h1>

      <div className="filter-bar drillhole-control-bar dataset-control-bar">
        <label className="table-search"><Search size={16} /><input aria-label={`Search ${config.searchLabel}`} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${config.searchLabel}…`} value={query} /></label>
        <button className="filter-button" type="button"><Filter size={15} /> All records</button>
        <span className="result-count">{filteredRows.length} shown</span>
        <button className="button button-secondary" type="button"><RefreshCw size={16} /> Refresh</button>
        <button className="button button-primary" type="button"><Upload size={16} /> Import CSV</button>
      </div>

      <section className="panel dataset-records-panel">
        <div className="dataset-record-table">
          <div className="dataset-record-row dataset-record-header">
            {config.columns.map((column) => <span key={column}>{column}</span>)}
          </div>
          {filteredRows.map((row) => (
            <button className="dataset-record-row" key={row.join('-')} type="button">
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

function LiveDatasetToolPage({ client, project, scope, section }: {
  client: DataPoolClient
  project: ProjectSummary
  scope: string
  section: DatasetSection
}) {
  const dataQuery = useQuery({
    queryKey: ['datapool', scope, project.id, 'dataset-tool', section],
    queryFn: async (): Promise<DatasetToolConfig> => {
      const [variables, datasets, holes] = await Promise.all([
        client.variables(),
        client.datasets(project.id),
        client.drillholes(project.id),
      ])
      const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]))
      const selectedVariables = variables.filter((variable) => datasets.some((dataset) => (
        supportsSection(section, variable, `${dataset.name} ${dataset.producerName} ${dataset.producerType}`)
      )))
      if (selectedVariables.length === 0) return { ...configs[section], rows: [] }
      const observations = await client.queryObservations({
        acceptedOnly: true,
        limit: 200_000,
        projectId: project.id,
        variableKeys: selectedVariables.map((variable) => variable.key),
      })
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
    },
  })

  if (dataQuery.isPending) return <div className="page dataset-tool-page"><div className="eda-state panel">Loading {configs[section].searchLabel} from {project.name}…</div></div>
  if (dataQuery.isError) return <div className="page dataset-tool-page"><div className="eda-state panel" role="alert">The connected project data could not be loaded.</div></div>
  return <DatasetToolWorkbench config={dataQuery.data} section={section} />
}
