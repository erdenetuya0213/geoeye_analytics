import type { FilterField } from '../analysis/fieldFilter.js'
import type { EdaDataset, EdaVariableDefinition } from './edaTypes.js'

const byLabel = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })

/**
 * The fields an analysis runs on: the numeric columns of the chosen table. A text column cannot be
 * summarised, correlated or clustered, so it is a filter rather than a field and is left out here.
 */
export function numericFields(dataset: Pick<EdaDataset, 'variables'> | undefined): EdaVariableDefinition[] {
  return dataset === undefined ? [] : dataset.variables.filter((variable) => variable.dataType !== 'category')
}

/** The dictionary of a text column: every value it takes in this table, in order. */
export function categoryValues(dataset: Pick<EdaDataset, 'observations'>, key: string): string[] {
  const values = new Set<string>()
  for (const observation of dataset.observations) {
    const value = observation.dimensions[key]
    if (value !== undefined && value !== '') values.add(value)
  }
  return [...values].sort(byLabel)
}

/**
 * What the chosen table can be filtered by: its numeric fields as ranges, its text fields as
 * dictionaries. A text column holding one value for every row is left out — there is nothing to
 * choose between, which is what keeps a table's own name, source and type out of the list.
 */
export function filterFields(dataset: Pick<EdaDataset, 'dimensions' | 'observations' | 'variables'> | undefined): FilterField[] {
  if (dataset === undefined) return []
  const dictionaries = new Map(dataset.dimensions.map((dimension) => [dimension.key, new Set<string>()]))
  for (const observation of dataset.observations) {
    for (const [key, values] of dictionaries) {
      const value = observation.dimensions[key]
      if (value !== undefined && value !== '') values.add(value)
    }
  }
  return [
    ...numericFields(dataset).map((variable): FilterField => ({ key: variable.key, kind: 'number', label: variable.label, unit: variable.unit })),
    ...dataset.dimensions.flatMap((dimension): FilterField[] => {
      const values = [...(dictionaries.get(dimension.key) ?? [])].sort(byLabel)
      return values.length < 2 ? [] : [{ key: dimension.key, kind: 'category', label: dimension.label, values }]
    }),
  ]
}
