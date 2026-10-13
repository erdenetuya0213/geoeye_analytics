import { ChevronDown } from 'lucide-react'
import type { EdaVariableDefinition } from '../data/edaTypes.js'

const title = (variable: EdaVariableDefinition) => `${variable.label}${variable.unit ? ` (${variable.unit})` : ''}`

/** Field 1, Field 2, Field 3 … one select each, with as many more as the data offers. */
export function FieldSelects({ ariaPrefix, maxFields = 12, minFields = 1, onChange, value, variables }: {
  ariaPrefix: string
  maxFields?: number
  minFields?: number
  onChange: (keys: string[]) => void
  value: readonly string[]
  variables: readonly EdaVariableDefinition[]
}) {
  const chosen = value.filter((key) => variables.some((variable) => variable.key === key))
  const unused = variables.filter((variable) => !chosen.includes(variable.key))
  const replace = (index: number, key: string) => {
    const next = [...chosen]
    if (key === '') next.splice(index, 1)
    else next[index] = key
    onChange(next)
  }
  return <>
    {chosen.map((key, index) => (
      <label className="tool-select tool-select-field" key={`${key}:${index}`}>
        <span>Field {index + 1}</span>
        <select aria-label={`${ariaPrefix} field ${index + 1}`} onChange={(event) => replace(index, event.target.value)} value={key}>
          {[...variables.filter((variable) => variable.key === key), ...unused].map((variable) => (
            <option key={variable.key} value={variable.key}>{title(variable)}</option>
          ))}
          {chosen.length > minFields ? <option value="">Remove field {index + 1}</option> : null}
        </select>
        <ChevronDown size={14} />
      </label>
    ))}
    {unused.length > 0 && chosen.length < maxFields ? (
      <label className="tool-select tool-select-field">
        <span>Add field</span>
        <select aria-label={`${ariaPrefix} add field`} onChange={(event) => { if (event.target.value !== '') onChange([...chosen, event.target.value]) }} value="">
          <option value="">Choose…</option>
          {unused.map((variable) => <option key={variable.key} value={variable.key}>{title(variable)}</option>)}
        </select>
        <ChevronDown size={14} />
      </label>
    ) : null}
  </>
}
