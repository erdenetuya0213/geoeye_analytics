import { useMemo, useState } from 'react'
import { RMR76_METHOD_DEFINITION, type ResolvedInput, type Rmr76IntervalResult } from '../analysis/geotechnicalWorkflow.js'

export type ResultStatusFilter = 'all' | Rmr76IntervalResult['status'] | 'estimated'

const parameters = [
  { key: 'geotech.ucs', label: 'UCS (MPa)', score: 'strength' },
  { key: 'geotech.rqd', label: 'RQD (%)', score: 'rqd' },
  { key: 'structure.joint_spacing', label: 'Spacing (m)', score: 'jointSpacing' },
  { key: 'geotech.joint_condition', label: 'Joint condition', score: 'jointCondition' },
  { key: 'geotech.groundwater', label: 'Groundwater', score: 'groundwater' },
] as const

export function resultValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return Number.isFinite(value) ? String(Number(value.toFixed(3))) : '—'
  if (typeof value === 'string') return value.replaceAll('-', ' ')
  if (typeof value === 'object' && 'orientation' in value) return resultValue(value.orientation)
  return '—'
}

function estimatedLabels(interval: Rmr76IntervalResult) {
  return Object.values(interval.resolvedInputs).filter(input => input.availability === 'fallback').map(input => input.definition.label)
}

export function filterRmrResults(intervals: readonly Rmr76IntervalResult[], query: string, status: ResultStatusFilter) {
  const search = query.trim().toLowerCase()
  return intervals.filter(interval => (!search || interval.holeId.toLowerCase().includes(search))
    && (status === 'all' || (status === 'estimated' ? estimatedLabels(interval).length > 0 : interval.status === status)))
}

function InputValue({ input, score }: { input: ResolvedInput; score: number | null | undefined }) {
  const missing = input.availability === 'missing'
  return <td title={input.availability === 'derived' ? 'Derived input' : undefined}>
    <span className={missing ? 'rmr-value-missing' : ''}>{missing ? 'Missing' : resultValue(input.value)}</span>
    <small>{score === null || score === undefined ? '— pts' : `${resultValue(score)} pts`}
      {input.availability === 'fallback' ? <b className="rmr-estimate">Estimated</b> : null}
    </small>
  </td>
}

interface Props {
  intervals: readonly Rmr76IntervalResult[]
  selectedId: string | null
  onSelect: (id: string) => void
  status: ResultStatusFilter
  onStatusChange: (status: ResultStatusFilter) => void
}

export function GeotechnicalResultsTable({ intervals, selectedId, onSelect, status, onStatusChange }: Props) {
  const [query, setQuery] = useState('')
  const [pagination, setPagination] = useState({ index: 0, status })
  const page = pagination.status === status ? pagination.index : 0
  const setPage = (index: number) => setPagination({ index, status })
  const filtered = useMemo(() => filterRmrResults(intervals, query, status), [intervals, query, status])
  const pageSize = 50
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1)
  const currentPage = Math.min(page, lastPage)
  const rows = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

  return <section className="rmr-results-list" aria-label="RMR results and derived values">
    <div className="rmr-table-toolbar">
      <label>Find borehole<input type="search" placeholder="Hole ID…" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} /></label>
      <label>Show<select aria-label="Result status" value={status} onChange={event => { onStatusChange(event.target.value as ResultStatusFilter); setPage(0) }}>
        <option value="all">All intervals</option><option value="valid">Calculated</option><option value="missing">Missing inputs</option><option value="estimated">Uses estimates</option><option value="excluded">Excluded</option>
      </select></label>
      <p><strong>{filtered.length.toLocaleString()}</strong> of {intervals.length.toLocaleString()} intervals</p>
    </div>
    <div className="rmr-table-scroll" tabIndex={0} role="region" aria-label="Scrollable RMR results table">
      <table className="rmr-values-table">
        <caption className="sr-only">Borehole intervals, input values, derived component ratings, RMR and classification</caption>
        <thead><tr>
          <th scope="col">Borehole</th><th scope="col">From (m)</th><th scope="col">To (m)</th>
          <th scope="col">RMR76<small>Final / basis</small></th><th scope="col">Class</th><th scope="col">Status / reason</th>
          {parameters.map(parameter => <th scope="col" key={parameter.key}>{parameter.label}<small>Value / rating</small></th>)}
          <th scope="col">Basic RMR</th><th scope="col">Orientation<small>Adjustment (pts)</small></th>
        </tr></thead>
        <tbody>{rows.map(interval => {
          const calculation = interval.calculation
          const estimated = estimatedLabels(interval)
          const missing = interval.missing.filter(key => key !== 'structure.orientation_rating').map(key => RMR76_METHOD_DEFINITION.requiredInputs.find(input => input.key === key)?.label ?? key)
          return <tr key={interval.id} className={interval.id === selectedId ? 'is-selected' : ''}>
            <th scope="row"><button type="button" aria-label={`View ${interval.holeId}, ${interval.depthFrom} to ${interval.depthTo} m`} aria-pressed={interval.id === selectedId} onClick={() => onSelect(interval.id)}>{interval.holeId}</button></th>
            <td>{interval.depthFrom}</td><td>{interval.depthTo}</td>
            <td className="rmr-final-value"><strong>{resultValue(calculation?.total)}</strong><small>{calculation?.total == null ? 'Not calculated' : calculation.ratingBasis === 'basic' ? 'Basic' : 'Adjusted'}</small></td>
            <td>{calculation?.classification ?? '—'}</td>
            <td className="rmr-row-reason"><span className={`geotech-status status-${interval.status}`}>{interval.status === 'valid' ? 'Calculated' : interval.status === 'missing' ? 'Missing inputs' : 'Excluded'}</span>
              {interval.status === 'missing' ? <small>Missing: {missing.join(', ') || 'Valid input values'}</small> : null}
              {interval.status === 'excluded' ? <small>{interval.exclusionReason ?? 'Excluded by source rule'}</small> : null}
              {estimated.length > 0 ? <small className="rmr-estimate">Estimated: {estimated.join(', ')}</small> : null}
            </td>
            {parameters.map(parameter => <InputValue key={parameter.key} input={interval.resolvedInputs[parameter.key]} score={calculation?.scores[parameter.score]} />)}
            <td>{resultValue(calculation?.basic)}</td>
            <td>{resultValue(calculation?.orientationAdjustment)}<small>{interval.resolvedInputs['structure.orientation_rating'].availability === 'missing' ? 'Not assessed' : resultValue(interval.resolvedInputs['structure.orientation_rating'].value)}</small></td>
          </tr>
        })}</tbody>
      </table>
      {rows.length === 0 ? <p className="rmr-no-results">No intervals match these filters.</p> : null}
    </div>
    <footer className="rmr-table-pagination">
      <span role="status">{filtered.length === 0 ? '0 rows' : `Rows ${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filtered.length)} of ${filtered.length.toLocaleString()}`}</span>
      <button className="button button-secondary" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
      <span>Page {currentPage + 1} of {lastPage + 1}</span>
      <button className="button button-secondary" type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button>
    </footer>
  </section>
}
