import type {
  Dataset,
  FieldLoggingDataset,
  ObservationValue,
  VariableDefinition,
} from '@geoeye/datapool-client'
import type { ExcavationType } from '../analysis/geotechnical.js'
import {
  RMR76_METHOD_DEFINITION,
  type GeotechnicalInterval,
  type InputCandidate,
  type Rmr76CanonicalInputKey,
} from '../analysis/geotechnicalWorkflow.js'
import type { GeotechnicalSource, RmrDataset } from './geotechnicalDemo.js'

export type Rmr76ColumnMapping = Partial<Record<Rmr76CanonicalInputKey, string>>

export interface DatabaseRmrColumn {
  canonicalUnit: string | null
  dataType: VariableDefinition['dataType']
  displayName: string
  key: string
  sourceColumn: string | null
}

export interface DatabaseRmrRecord {
  depthFrom: number | null
  depthTo: number | null
  holeId: string | null
  id: string
  observationIds: Readonly<Record<string, string>>
  values: Readonly<Record<string, unknown>>
}

export interface DatabaseRmrSource {
  columns: readonly DatabaseRmrColumn[]
  dataset: Pick<Dataset, 'currentVersion' | 'id' | 'name' | 'updatedAt'>
  holeNames: ReadonlyMap<string, string>
  records: readonly DatabaseRmrRecord[]
  recordCount: number
}

const numericInputs = new Set<Rmr76CanonicalInputKey>([
  'geotech.ucs',
  'geotech.rqd',
  'structure.joint_spacing',
])

function observationValue(observation: ObservationValue): unknown {
  return observation.numericValue
    ?? observation.categoryValue
    ?? observation.textValue
    ?? observation.booleanValue
    ?? observation.datetimeValue
}

function normalizedCategory(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[_\s]+/g, '-').replace(/-+/g, '-')
}

function mappedValue(key: Rmr76CanonicalInputKey, value: unknown, excavationType: ExcavationType): unknown {
  if (typeof value !== 'string') return value
  const normalized = normalizedCategory(value)
  return key === 'structure.orientation_rating'
    ? { excavationType, orientation: normalized }
    : normalized
}

export function isRmrColumnCompatible(key: Rmr76CanonicalInputKey, column: DatabaseRmrColumn): boolean {
  if (numericInputs.has(key)) return column.dataType === 'numeric'
  return column.dataType === 'numeric' || column.dataType === 'category' || column.dataType === 'text'
}

export function rmrColumnLabel(column: DatabaseRmrColumn): string {
  const sourceColumn = column.sourceColumn
  const unit = column.canonicalUnit === null ? '' : ` · ${column.canonicalUnit}`
  return `${sourceColumn ?? column.displayName}${unit}`
}

export function isCompleteRmrMapping(mapping: Rmr76ColumnMapping): boolean {
  return RMR76_METHOD_DEFINITION.requiredInputs.every((input) => {
    const value = mapping[input.key]
    return typeof value === 'string' && value.length > 0
  })
}

export function buildDatabaseRmrSources(
  datasets: readonly Dataset[],
  observations: readonly ObservationValue[],
  variables: readonly VariableDefinition[],
  holeNames: ReadonlyMap<string, string>,
): DatabaseRmrSource[] {
  const definitions = new Map(variables.map((variable) => [variable.key, variable]))
  return datasets
    .filter((dataset) => dataset.status === 'active')
    .flatMap((dataset): DatabaseRmrSource[] => {
      const datasetObservations = observations.filter((observation) => observation.datasetId === dataset.id)
      const observedKeys = [...new Set(datasetObservations.map((observation) => observation.variableKey))]
      const columns = observedKeys.flatMap((key) => {
        const definition = definitions.get(key)
        return definition === undefined ? [] : [{
          canonicalUnit: definition.canonicalUnit,
          dataType: definition.dataType,
          displayName: definition.displayName,
          key: definition.key,
          sourceColumn: typeof definition.metadata?.sourceColumn === 'string' ? definition.metadata.sourceColumn : null,
        } satisfies DatabaseRmrColumn]
      }).sort((left, right) => rmrColumnLabel(left).localeCompare(rmrColumnLabel(right)))
      if (columns.length === 0) return []
      const records = new Map<string, DatabaseRmrRecord>()
      for (const observation of datasetObservations) {
        const depthTo = observation.depthTo ?? observation.depthFrom
        const recordId = `${observation.holeId ?? 'none'}|${observation.sourceId}|${observation.depthFrom ?? 'none'}|${depthTo ?? 'none'}`
        const record = records.get(recordId) ?? {
          depthFrom: observation.depthFrom,
          depthTo,
          holeId: observation.holeId,
          id: recordId,
          observationIds: {},
          values: {},
        }
        ;(record.values as Record<string, unknown>)[observation.variableKey] = observationValue(observation)
        ;(record.observationIds as Record<string, string>)[observation.variableKey] = observation.id
        records.set(recordId, record)
      }
      return [{
        columns,
        dataset,
        holeNames,
        records: [...records.values()],
        recordCount: records.size,
      }]
    })
    .sort((left, right) => right.dataset.updatedAt.localeCompare(left.dataset.updatedAt) || left.dataset.name.localeCompare(right.dataset.name))
}

/** Converts exact Field template IDs and records into the same explicit mapper used by CSV datasets. */
export function buildFieldLoggingRmrSources(
  datasets: readonly FieldLoggingDataset[],
  holeNames: ReadonlyMap<string, string>,
): DatabaseRmrSource[] {
  const sourceRank = (name: string) => /^geotechnical\b/i.test(name) ? 0 : /\brqd\b/i.test(name) ? 1 : /\bstructure\b/i.test(name) ? 2 : 3
  return datasets.filter((dataset) => dataset.category?.toLocaleLowerCase() !== 'lithology' && !/^colou?r$/i.test(dataset.name.trim())).flatMap((dataset): DatabaseRmrSource[] => {
    const columns = dataset.columns.map((column): DatabaseRmrColumn => ({
      canonicalUnit: column.unit,
      dataType: column.dataType,
      displayName: column.label,
      key: column.key,
      sourceColumn: column.label,
    }))
    const records = dataset.records.map((record): DatabaseRmrRecord => ({
      depthFrom: record.depthFrom,
      depthTo: record.depthTo,
      holeId: record.holeId,
      id: record.id,
      observationIds: Object.fromEntries(Object.keys(record.values).map((key) => [key, `${record.id}:${key}`])),
      values: record.values,
    }))
    if (columns.length === 0 || records.length === 0) return []
    return [{
      columns,
      dataset: {
        currentVersion: dataset.version,
        id: dataset.id,
        name: dataset.name,
        updatedAt: dataset.updatedAt,
      },
      holeNames,
      records,
      recordCount: records.length,
    }]
  }).sort((left, right) => sourceRank(left.dataset.name) - sourceRank(right.dataset.name)
    || right.dataset.updatedAt.localeCompare(left.dataset.updatedAt)
    || left.dataset.name.localeCompare(right.dataset.name))
}

export function buildMappedRmrDataset(
  source: DatabaseRmrSource,
  mapping: Rmr76ColumnMapping,
  excavationType: ExcavationType,
): RmrDataset {
  const targetsByColumn = new Map<string, Rmr76CanonicalInputKey[]>()
  for (const definition of RMR76_METHOD_DEFINITION.requiredInputs) {
    const columnKey = mapping[definition.key]
    if (columnKey === undefined || columnKey === '') continue
    targetsByColumn.set(columnKey, [...(targetsByColumn.get(columnKey) ?? []), definition.key])
  }

  const intervals: GeotechnicalInterval[] = source.records.flatMap((record) => {
    if (record.holeId === null || record.depthFrom === null) return []
    const depthTo = record.depthTo ?? record.depthFrom
    const candidates: InputCandidate[] = []
    for (const [columnKey, targets] of targetsByColumn) {
      if (!(columnKey in record.values)) continue
      const rawValue = record.values[columnKey]
      for (const canonicalKey of targets) candidates.push({
        availability: 'direct',
        canonicalKey,
        observationId: record.observationIds[columnKey] ?? `${record.id}:${columnKey}`,
        sourceFieldId: columnKey,
        sourceLabel: source.dataset.name,
        sourceTemplateId: source.dataset.id,
        value: mappedValue(canonicalKey, rawValue, excavationType),
      })
    }
    return [{
      candidates,
      depthFrom: record.depthFrom,
      depthTo,
      holeId: source.holeNames.get(record.holeId) ?? record.holeId,
      id: record.id,
      lithology: 'Unassigned',
    }]
  }).sort((left, right) => left.holeId.localeCompare(right.holeId) || left.depthFrom - right.depthFrom || left.id.localeCompare(right.id))
  const datasetSource: GeotechnicalSource = {
    id: source.dataset.id,
    label: source.dataset.name,
    role: 'geotechnical',
    version: `v${source.dataset.currentVersion}`,
  }
  return {
    id: source.dataset.id,
    intervals,
    label: source.dataset.name,
    snapshotId: `${source.dataset.id}:v${source.dataset.currentVersion}:${source.dataset.updatedAt}`,
    snapshotLabel: `${source.dataset.name} · v${source.dataset.currentVersion}`,
    sources: [datasetSource],
    targetTemplateId: source.dataset.id,
    version: source.dataset.currentVersion,
  }
}
