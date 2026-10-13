import { ChevronDown, X } from 'lucide-react'
import type { FieldFilter, FieldFilters as FilterMap, FilterField, NumberRange } from '../analysis/fieldFilter.js'
import { normalizeFilter } from '../analysis/fieldFilter.js'
import { VariablePicker } from './VariablePicker.js'

export type { FilterField }

const rangeOf = (filter: FieldFilter | null): NumberRange => filter?.kind !== 'number'
  ? 'between'
  : filter.range ?? (filter.min !== null && filter.max !== null ? 'between' : filter.min !== null ? 'min' : 'max')
const numberOrNull = (value: string) => value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value)
const text = (value: number | null) => value === null ? '' : String(value)

export function FieldFilters({ ariaPrefix, fields, filters, keys, onChangeFilter, onChangeKeys }: {
  ariaPrefix: string
  fields: readonly FilterField[]
  filters: FilterMap
  keys: readonly string[]
  onChangeFilter: (key: string, filter: FieldFilter) => void
  onChangeKeys: (keys: string[]) => void
}) {
  const unused = fields.filter((field) => !keys.includes(field.key))
  return <>
    {keys.map((key) => {
      const field = fields.find((item) => item.key === key)
      if (field === undefined) return null
      const filter = normalizeFilter(filters[key])
      const remove = <button aria-label={`Remove ${field.label} filter`} onClick={() => onChangeKeys(keys.filter((item) => item !== key))} type="button"><X size={13} /></button>
      if (field.kind === 'category') {
        const values = filter?.kind === 'category' ? filter.values : []
        const options = (field.values ?? []).map((value) => ({ dataType: 'category' as const, decimals: 0, key: value, label: '', shortLabel: value, unit: '' }))
        return <div className="eda-filter-control" key={key}>
          <VariablePicker
            ariaLabel={`${ariaPrefix} ${field.label} values`}
            label={field.label}
            onToggle={(value) => onChangeFilter(key, { kind: 'category', values: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] })}
            selectedKeys={values}
            summary={values.length === 0 ? 'All' : values.length === 1 ? values[0]! : `${values.length} selected`}
            variables={options}
          >
            <button className="feature-picker-option" onClick={() => onChangeFilter(key, { kind: 'category', values: [] })} type="button"><span><strong>All {field.label}</strong></span></button>
          </VariablePicker>
          {remove}
        </div>
      }
      const range = rangeOf(filter)
      const bounds = filter?.kind === 'number' ? filter : { max: null, min: null }
      const set = (next: Partial<{ max: number | null; min: number | null }>) => onChangeFilter(key, { kind: 'number', max: bounds.max, min: bounds.min, range, ...next })
      return <div className="eda-filter-control eda-number-filter" key={key}>
        <label className="tool-select tool-select-field">
          <span>{field.label}{field.unit ? ` (${field.unit})` : ''}</span>
          <select aria-label={`${ariaPrefix} ${field.label} range`} onChange={(event) => {
            const value = event.target.value as NumberRange
            onChangeFilter(key, { kind: 'number', max: value === 'min' ? null : bounds.max, min: value === 'max' ? null : bounds.min, range: value })
          }} value={range}>
            <option value="min">More than</option>
            <option value="max">Less than</option>
            <option value="between">Between</option>
          </select>
          <ChevronDown size={14} />
        </label>
        {range === 'max' ? null : <input aria-label={`${ariaPrefix} ${field.label} minimum`} className="tool-number-input" inputMode="decimal" onChange={(event) => set({ min: numberOrNull(event.target.value) })} placeholder="min" value={text(bounds.min)} />}
        {range === 'min' ? null : <input aria-label={`${ariaPrefix} ${field.label} maximum`} className="tool-number-input" inputMode="decimal" onChange={(event) => set({ max: numberOrNull(event.target.value) })} placeholder="max" value={text(bounds.max)} />}
        {remove}
      </div>
    })}
    <label className="tool-select tool-select-field eda-add-filter">
      <span>Filters</span>
      <select aria-label={`${ariaPrefix} add filter`} disabled={unused.length === 0} onChange={(event) => { if (event.target.value !== '') onChangeKeys([...keys, event.target.value]) }} value="">
        <option value="">Add filter…</option>
        {unused.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
      </select>
      <ChevronDown size={14} />
    </label>
  </>
}
