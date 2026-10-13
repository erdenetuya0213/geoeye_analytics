import type { ObservationValue, VariableDefinition } from '@geoeye/datapool-client'
import { effectiveDrillholes, type LocalDrillholeDraft, type LocalProjectSnapshot } from './localProjectDb.js'

/** Sections kept as one imported table, as opposed to the user-named classes of Lab and Strength. */
export type DatasetSection = 'xrf' | 'spectral'

export function supportsSection(section: DatasetSection, definition: VariableDefinition, sourceLabel: string): boolean {
  const haystack = `${definition.key} ${definition.displayName} ${sourceLabel}`.toLowerCase()
  if (section === 'xrf') return /(^|[. _-])xrf|fluorescence/.test(haystack)
  return /spectral|spectrum|specim|mineral/.test(haystack)
}

function displayObservationValue(observation: ObservationValue): string {
  const value = observation.numericValue
    ?? observation.categoryValue
    ?? observation.textValue
    ?? observation.booleanValue
    ?? observation.datetimeValue
  if (value === null) return '—'
  return String(value)
}

/** Published observations of one section, folded back into the rows they were imported as. */
export function databaseRows(section: DatasetSection, snapshot: LocalProjectSnapshot | null, drillholeDraft: LocalDrillholeDraft | null): { columns: string[]; rows: string[][] } {
  const variables = snapshot?.variables ?? []
  const datasets = snapshot?.datasets ?? []
  const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]))
  const selectedVariables = variables.filter((variable) => datasets.some((dataset) => (
    supportsSection(section, variable, `${dataset.name} ${dataset.producerName} ${dataset.producerType}`)
  )))
  if (selectedVariables.length === 0) return { columns: [], rows: [] }
  const selectedKeys = new Set(selectedVariables.map((variable) => variable.key))
  const holeNames = new Map(effectiveDrillholes(snapshot, drillholeDraft).map(hole => [hole.id, hole.name]))
  const observed = (snapshot?.observations ?? []).filter((observation) => {
    if (!selectedKeys.has(observation.variableKey)) return false
    const dataset = datasetById.get(observation.datasetId)
    const definition = selectedVariables.find(variable => variable.key === observation.variableKey)
    return dataset !== undefined && definition !== undefined && supportsSection(section, definition, `${dataset.name} ${dataset.producerName} ${dataset.producerType}`)
  })
  const observedKeys = new Set(observed.map(observation => observation.variableKey))
  const fields = selectedVariables.filter(variable => observedKeys.has(variable.key))
  const labels = new Set(['Source record', 'Hole ID', 'From', 'To'])
  const columns = ['Source record', 'Hole ID', 'From', 'To', ...fields.map(variable => {
    const original = typeof variable.metadata?.sourceColumn === 'string' ? variable.metadata.sourceColumn : variable.displayName
    const label = labels.has(original) ? `${original} [${variable.key}]` : original
    labels.add(label)
    return label
  })]
  const rows = new Map<string, string[]>()
  for (const observation of observed) {
    const key = JSON.stringify([observation.datasetId, observation.sourceId, observation.holeId, observation.depthFrom, observation.depthTo])
    const row = rows.get(key) ?? [observation.sourceId, observation.holeId === null ? '' : holeNames.get(observation.holeId) ?? observation.holeId,
      observation.depthFrom === null ? '' : String(observation.depthFrom), observation.depthTo === null ? observation.depthFrom === null ? '' : String(observation.depthFrom) : String(observation.depthTo), ...fields.map(() => '')]
    row[fields.findIndex(variable => variable.key === observation.variableKey) + 4] = displayObservationValue(observation)
    rows.set(key, row)
  }
  return { columns, rows: [...rows.values()] }
}
