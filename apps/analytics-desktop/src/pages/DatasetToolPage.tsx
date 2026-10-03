import { Filter, RefreshCw, Search, Upload } from 'lucide-react'
import { useMemo } from 'react'
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
  const config = configs[section]
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
