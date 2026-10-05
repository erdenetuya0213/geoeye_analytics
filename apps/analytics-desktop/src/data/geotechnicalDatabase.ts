import type {
  Dataset,
  FieldLoggingDataset,
  ObservationValue,
  VariableDefinition,
} from '@geoeye/datapool-client'
import { calculateRmr76, type ExcavationType, type Rmr76JointCondition } from '../analysis/geotechnical.js'
import {
  RMR76_METHOD_DEFINITION,
  type GeotechnicalInterval,
  type InputCandidate,
  type Rmr76CanonicalInputKey,
} from '../analysis/geotechnicalWorkflow.js'
import type { GeotechnicalSource, RmrDataset } from './geotechnicalTypes.js'
import { liveFieldLoggingDatasets } from './fieldLoggingSources.js'

export type Rmr76ColumnMapping = Partial<Record<Rmr76CanonicalInputKey, string>>

export interface Rmr76ParameterSource {
  columnKey: string
  sourceId: string
}

export type Rmr76ParameterSourceMapping = Partial<Record<Rmr76CanonicalInputKey, Rmr76ParameterSource>>

export interface Rmr76JoinParameterDiagnostic {
  ambiguousIntervalCount: number
  matchedIntervalCount: number
  sourceIntervalCount: number
  unmatchedIntervalCount: number
}

export interface Rmr76JoinDiagnostics {
  jointConditionMean: number | null
  jointConditionSampleCount: number
  jointConditionEstimatedCount: number
  complete: boolean
  matchedBoreholeCount: number
  matchedIntervalCount: number
  parameters: Record<Rmr76CanonicalInputKey, Rmr76JoinParameterDiagnostic>
}

export interface JoinedRmrDataset {
  dataset: RmrDataset
  diagnostics: Rmr76JoinDiagnostics
}

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
  coveredHoleCount: number
  dataset: Pick<Dataset, 'currentVersion' | 'id' | 'name' | 'updatedAt'>
  holeNames: ReadonlyMap<string, string>
  parentTemplateId: string | null
  records: readonly DatabaseRmrRecord[]
  recordCount: number
  sourceKind: 'database' | 'field-template' | 'generated-csv'
}

function generatedParentTemplateId(datasetId: string): string | null {
  return datasetId.match(/^(.*):generated(?::v\d+)?$/)?.[1] ?? null
}

function coveredHoleCount(records: readonly DatabaseRmrRecord[]): number {
  return new Set(records.flatMap((record) => record.holeId === null ? [] : [record.holeId])).size
}

export function rmrSourceOptionLabel(
  source: DatabaseRmrSource,
  sources: readonly DatabaseRmrSource[],
): string {
  const rows = source.recordCount.toLocaleString('en-US')
  const holes = source.coveredHoleCount.toLocaleString('en-US')
  if (source.sourceKind === 'generated-csv') {
    const parent = sources.find((candidate) => candidate.dataset.id === source.parentTemplateId)
    const coverage = parent === undefined ? holes : `${holes}/${parent.coveredHoleCount.toLocaleString('en-US')}`
    const parentName = parent?.dataset.name ?? source.dataset.name.replace(/\s*·\s*generated CSV$/i, '')
    return `↳ ${parentName} · completed CSV v${source.dataset.currentVersion} · ${rows} exported rows · ${coverage} holes`
  }
  if (source.sourceKind === 'field-template') {
    return `${source.dataset.name} · live template v${source.dataset.currentVersion} · ${rows} records · ${holes} holes`
  }
  return `${source.dataset.name} · v${source.dataset.currentVersion} · ${rows} rows`
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

export function isCompleteRmrSourceMapping(
  mapping: Rmr76ParameterSourceMapping,
  sources: readonly DatabaseRmrSource[],
): boolean {
  const sourceById = new Map(sources.map((source) => [source.dataset.id, source]))
  return RMR76_METHOD_DEFINITION.requiredInputs.every((input) => {
    const selection = mapping[input.key]
    if (selection === undefined) return false
    const source = sourceById.get(selection.sourceId)
    const column = source?.columns.find((item) => item.key === selection.columnKey)
    return column !== undefined && isRmrColumnCompatible(input.key, column)
  })
}

function exactIntervalKey(record: DatabaseRmrRecord): string | null {
  if (record.holeId === null || record.depthFrom === null || record.depthTo === null) return null
  const depthFrom = Object.is(record.depthFrom, -0) ? 0 : record.depthFrom
  const depthTo = Object.is(record.depthTo, -0) ? 0 : record.depthTo
  return JSON.stringify([record.holeId, depthFrom, depthTo])
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Joins six independently selected local sources by the exact interval key:
 * database hole id + depth from + depth to. Overlap and nearest-depth joins
 * are deliberately rejected because they would silently change the geology.
 */
export function buildJoinedRmrDataset(
  sources: readonly DatabaseRmrSource[],
  mapping: Rmr76ParameterSourceMapping,
  excavationType: ExcavationType,
  options: {
    useJointConditionMean?: boolean
    inScope?: (record: DatabaseRmrRecord, source: DatabaseRmrSource) => boolean
  } = {},
): JoinedRmrDataset {
  const sourceById = new Map(sources.map((source) => [source.dataset.id, source]))
  const indexes = new Map<Rmr76CanonicalInputKey, Map<string, {
    record: DatabaseRmrRecord
    source: DatabaseRmrSource
    value: unknown
    estimated?: boolean
  }>>()
  const ambiguousByParameter = new Map<Rmr76CanonicalInputKey, Set<string>>()
  const selectedSources = new Map<string, DatabaseRmrSource>()

  for (const definition of RMR76_METHOD_DEFINITION.requiredInputs) {
    const index = new Map<string, { record: DatabaseRmrRecord; source: DatabaseRmrSource; value: unknown; estimated?: boolean }>()
    const ambiguous = new Set<string>()
    const selection = mapping[definition.key]
    const source = selection === undefined ? undefined : sourceById.get(selection.sourceId)
    if (source !== undefined && selection !== undefined) {
      selectedSources.set(source.dataset.id, source)
      for (const record of source.records) {
        const intervalKey = exactIntervalKey(record)
        if (intervalKey === null || !(selection.columnKey in record.values)) continue
        const value = mappedValue(definition.key, record.values[selection.columnKey], excavationType)
        const existing = index.get(intervalKey)
        if (existing !== undefined && !sameValue(existing.value, value)) ambiguous.add(intervalKey)
        else if (existing === undefined) index.set(intervalKey, { record, source, value })
      }
    }
    indexes.set(definition.key, index)
    ambiguousByParameter.set(definition.key, ambiguous)
  }

  const conditionKey = 'geotech.joint_condition'
  const conditionIndex = indexes.get(conditionKey)!
  const sample = [...conditionIndex.entries()].flatMap(([key, selected]) => {
    if (ambiguousByParameter.get(conditionKey)?.has(key) || options.inScope?.(selected.record, selected.source) === false) return []
    const value = selected.value
    if (typeof value !== 'number' && typeof value !== 'string') return []
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0 || value > 25)) return []
    const score = calculateRmr76({ jointCondition: value as Rmr76JointCondition | number }).scores.jointCondition
    return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 25 ? [score] : []
  })
  const jointConditionMean = sample.length === 0 ? null : sample.reduce((total, score) => total + score, 0) / sample.length
  let jointConditionEstimatedCount = 0
  if (options.useJointConditionMean && jointConditionMean !== null) {
    const selection = mapping[conditionKey]
    const conditionSource = selection === undefined ? undefined : sourceById.get(selection.sourceId)
    const anchorKey = RMR76_METHOD_DEFINITION.requiredInputs[0]!.key
    if (conditionSource !== undefined) for (const [key, anchor] of indexes.get(anchorKey)!) {
      const existing = conditionIndex.get(key)
      const missing = existing === undefined || existing.value === null || existing.value === undefined || existing.value === ''
      if (!missing || ambiguousByParameter.get(conditionKey)?.has(key) || options.inScope?.(anchor.record, anchor.source) === false) continue
      if (!RMR76_METHOD_DEFINITION.requiredInputs.every(input => input.key === conditionKey
        || (indexes.get(input.key)?.has(key) && !ambiguousByParameter.get(input.key)?.has(key)))) continue
      conditionIndex.set(key, { record: anchor.record, source: conditionSource, value: jointConditionMean, estimated: true })
      jointConditionEstimatedCount++
    }
  }

  const complete = isCompleteRmrSourceMapping(mapping, sources)
  const firstKey = RMR76_METHOD_DEFINITION.requiredInputs[0]?.key
  const matchedKeys = new Set<string>()
  if (complete && firstKey !== undefined) {
    for (const intervalKey of indexes.get(firstKey)?.keys() ?? []) {
      const matchesEveryParameter = RMR76_METHOD_DEFINITION.requiredInputs.every((definition) =>
        indexes.get(definition.key)?.has(intervalKey) === true
        && ambiguousByParameter.get(definition.key)?.has(intervalKey) !== true)
      if (matchesEveryParameter) matchedKeys.add(intervalKey)
    }
  }

  const intervals: GeotechnicalInterval[] = [...matchedKeys].flatMap((intervalKey) => {
    const candidates: InputCandidate[] = []
    let representative: { record: DatabaseRmrRecord; source: DatabaseRmrSource } | undefined
    for (const definition of RMR76_METHOD_DEFINITION.requiredInputs) {
      const selected = indexes.get(definition.key)?.get(intervalKey)
      const selection = mapping[definition.key]
      if (selected === undefined || selection === undefined) return []
      representative ??= selected
      candidates.push({
        availability: selected.estimated ? 'fallback' : 'direct',
        canonicalKey: definition.key,
        observationId: selected.estimated ? `mean:${jointConditionMean}:n=${sample.length}:${intervalKey}` : selected.record.observationIds[selection.columnKey] ?? `${selected.record.id}:${selection.columnKey}`,
        sourceFieldId: selection.columnKey,
        sourceLabel: selected.estimated ? `${selected.source.dataset.name} · estimated scoped mean (${sample.length} intervals)` : selected.source.dataset.name,
        sourceTemplateId: selected.source.dataset.id,
        value: selected.value,
      })
    }
    if (representative === undefined || representative.record.holeId === null || representative.record.depthFrom === null) return []
    const depthTo = representative.record.depthTo ?? representative.record.depthFrom
    return [{
      candidates,
      depthFrom: representative.record.depthFrom,
      depthTo,
      holeId: representative.source.holeNames.get(representative.record.holeId) ?? representative.record.holeId,
      id: `rmr76-exact:${intervalKey}`,
      lithology: 'Unassigned',
    }]
  }).sort((left, right) => left.holeId.localeCompare(right.holeId) || left.depthFrom - right.depthFrom || left.depthTo - right.depthTo)

  const emptyDiagnostic = (): Rmr76JoinParameterDiagnostic => ({
    ambiguousIntervalCount: 0,
    matchedIntervalCount: 0,
    sourceIntervalCount: 0,
    unmatchedIntervalCount: 0,
  })
  const parameters = Object.fromEntries(RMR76_METHOD_DEFINITION.requiredInputs.map((definition) => {
    const sourceIntervalCount = indexes.get(definition.key)?.size ?? 0
    const ambiguousIntervalCount = ambiguousByParameter.get(definition.key)?.size ?? 0
    return [definition.key, {
      ambiguousIntervalCount,
      matchedIntervalCount: matchedKeys.size,
      sourceIntervalCount,
      unmatchedIntervalCount: Math.max(0, sourceIntervalCount - matchedKeys.size),
    } satisfies Rmr76JoinParameterDiagnostic]
  })) as Record<Rmr76CanonicalInputKey, Rmr76JoinParameterDiagnostic>
  for (const definition of RMR76_METHOD_DEFINITION.requiredInputs) parameters[definition.key] ??= emptyDiagnostic()

  const sourceDefinitions: GeotechnicalSource[] = [...selectedSources.values()].map((source) => ({
    id: source.dataset.id,
    label: source.dataset.name,
    role: 'geotechnical',
    version: `v${source.dataset.currentVersion}`,
  }))
  const signature = RMR76_METHOD_DEFINITION.requiredInputs.map((definition) => {
    const selection = mapping[definition.key]
    return `${definition.key}=${selection?.sourceId ?? ''}:${selection?.columnKey ?? ''}`
  }).join('|')
  const versions = [...selectedSources.values()].map((source) => source.dataset.currentVersion)
  const version = versions.length === 0 ? 1 : Math.max(...versions)
  return {
    dataset: {
      id: 'local-rmr76-exact-join',
      intervals,
      label: 'Local RMR76 exact interval join',
      snapshotId: `local-rmr76:${signature}`,
      snapshotLabel: 'Local sources · exact interval join',
      sources: sourceDefinitions,
      targetTemplateId: 'local-rmr76-exact-join',
      version,
    },
    diagnostics: {
      jointConditionMean,
      jointConditionSampleCount: sample.length,
      jointConditionEstimatedCount,
      complete,
      matchedBoreholeCount: new Set(intervals.map((interval) => interval.holeId)).size,
      matchedIntervalCount: intervals.length,
      parameters,
    },
  }
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
        coveredHoleCount: coveredHoleCount([...records.values()]),
        dataset,
        holeNames,
        parentTemplateId: null,
        records: [...records.values()],
        recordCount: records.size,
        sourceKind: 'database',
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
  return liveFieldLoggingDatasets(datasets).flatMap((dataset): DatabaseRmrSource[] => {
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
    if (columns.length === 0) return []
    const parentTemplateId = generatedParentTemplateId(dataset.id)
    return [{
      columns,
      coveredHoleCount: coveredHoleCount(records),
      dataset: {
        currentVersion: dataset.version,
        id: dataset.id,
        name: dataset.name,
        updatedAt: dataset.updatedAt,
      },
      holeNames,
      parentTemplateId,
      records,
      recordCount: records.length,
      sourceKind: parentTemplateId === null ? 'field-template' : 'generated-csv',
    }]
  }).sort((left, right) => {
    const leftName = left.dataset.name.replace(/\s*·\s*generated CSV$/i, '')
    const rightName = right.dataset.name.replace(/\s*·\s*generated CSV$/i, '')
    return sourceRank(leftName) - sourceRank(rightName)
      || leftName.localeCompare(rightName)
      || Number(left.sourceKind === 'generated-csv') - Number(right.sourceKind === 'generated-csv')
      || right.dataset.currentVersion - left.dataset.currentVersion
      || right.dataset.updatedAt.localeCompare(left.dataset.updatedAt)
  })
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
