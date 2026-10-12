import type { CompositeRules } from '../data/geotechnicalComposite.js'
import { rmrColumnLabel, type DatabaseRmrSource } from '../data/geotechnicalDatabase.js'

export function CompositeRuleEditor({ rules, sources, onChange }: {
  rules: CompositeRules; sources: readonly DatabaseRmrSource[]; onChange: (rules: CompositeRules) => void
}) {
  const inherited = sources.find(source => `field:${source.dataset.id}` === rules.boundarySourceId)?.composite
  const boundary = (secondary: boolean) => {
    const sourceKey = secondary ? 'secondaryBoundarySourceId' : 'boundarySourceId'
    const fieldKey = secondary ? 'secondaryBoundaryFieldKey' : 'boundaryFieldKey'
    const source = sources.find(source => source.dataset.id === rules[sourceKey])
    const prefix = secondary ? 'Second boundary' : 'Boundary'
    return <div className="geotech-boundary-selection">
      <label>{prefix} template<select aria-label={`${prefix} template`} value={rules[sourceKey] ?? ''} onChange={event => onChange({ ...rules, [sourceKey]: event.target.value, [fieldKey]: '' })}>
        <option value="">{secondary ? 'None' : 'Fixed intervals only'}</option>
        {!secondary && sources.filter(item => item.composite).map(item => <option key={`field:${item.dataset.id}`} value={`field:${item.dataset.id}`}>Use saved Field rules · {item.dataset.name}</option>)}
        {sources.map(item => <option key={item.dataset.id} value={item.dataset.id}>{item.dataset.name}</option>)}
      </select></label>
      {source && <label>{prefix} field<select aria-label={`${prefix} field`} value={rules[fieldKey] ?? ''} onChange={event => onChange({ ...rules, [fieldKey]: event.target.value })}>
        <option value="">Choose field…</option>
        {source.columns.map(column => <option key={column.key} value={column.key}>{rmrColumnLabel(column)}</option>)}
      </select></label>}
    </div>
  }
  return <>
    <label>Composite length (m)<input aria-label="Composite length (m)" type="number" min="0.1" step="0.1" disabled={!!inherited} value={inherited?.intervalLength ?? rules.intervalLength} onChange={event => { const value = Number(event.target.value); if (value >= 0.1) onChange({ ...rules, intervalLength: value }) }} /></label>
    <label>Start depth (m)<input aria-label="Composite start depth (m)" type="number" min="0" step="0.1" disabled={!!inherited} value={inherited?.startDepth ?? rules.startDepth} onChange={event => { const value = Number(event.target.value); if (value >= 0) onChange({ ...rules, startDepth: value }) }} /></label>
    {boundary(false)}
    {!inherited && rules.boundarySourceId && boundary(true)}
    <label>Population rule<select aria-label="Composite population rule" value={rules.population} onChange={event => onChange({ ...rules, population: event.target.value as CompositeRules['population'] })}>
      <option value="mean">Length-weighted mean / dominant category</option><option value="minimum">Numeric minimum / dominant category</option><option value="mode">Dominant observed value</option>
    </select></label>
    <small>{inherited ? 'Uses the selected Field template’s saved intervals and exclusions.' : 'Choose a template, then its boundary field. Equal adjacent field values are joined; changes and gaps stop the composite. The length starts again at each boundary.'} Population combines overlapping input values inside each composite: numeric means and category dominance are length-weighted; point measurements have equal weight. Missing-value filling is separate. Minimum means the lowest numeric input, not necessarily the lowest RMR rating.</small>
  </>
}
