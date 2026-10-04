import type {
  DataPoolClient,
  Dataset,
  DrillholeSummary,
  FieldLoggingDataset,
  ObservationValue,
  ProjectSummary,
  VariableDefinition,
} from '@geoeye/datapool-client'
import { useQuery } from '@tanstack/react-query'
import { buildAnalyticalObservations } from '../analysis/analyticalDataset.js'
import type { EdaObservation } from '../analysis/eda.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import type { EdaDataset, EdaDimensionDefinition, EdaVariableDefinition } from './edaTypes.js'
import {
  effectiveDrillholes,
  effectiveSurveysByHoleId,
  type LocalDrillholeDraft,
  type LocalProjectSnapshot,
  type LocalTabularDraft,
} from './localProjectDb.js'

const LIVE_OBSERVATION_LIMIT = 200_000

const baseDimensions: readonly EdaDimensionDefinition[] = [
  { key: 'drillhole', label: 'Drillhole' },
  { key: 'data_type', label: 'Data type' },
  { key: 'data_source', label: 'Data source' },
  { key: 'dataset', label: 'Dataset' },
  { key: 'source_type', label: 'Source type' },
  { key: 'quality', label: 'Quality' },
]

export type EdaDatasetKind = 'integrated' | 'drillholes' | 'logging' | 'laboratory' | 'strength' | 'xrf' | 'spectral' | 'other'

export const EDA_DATASET_CATALOG: ReadonlyArray<{ id: EdaDatasetKind; label: string }> = [
  { id: 'integrated', label: 'All data' },
  { id: 'drillholes', label: 'Drillholes' },
  { id: 'logging', label: 'Logging' },
  { id: 'laboratory', label: 'Lab / Assay' },
  { id: 'strength', label: 'Strength' },
  { id: 'xrf', label: 'XRF' },
  { id: 'spectral', label: 'Spectral' },
  { id: 'other', label: 'Other' },
]

export function edaDatasetKind(dataset: Pick<EdaDataset, 'id' | 'name' | 'producer' | 'variables'>): EdaDatasetKind {
  const identity = `${dataset.id} ${dataset.name} ${dataset.producer}`.toLocaleLowerCase()
  const variables = dataset.variables.map((variable) => `${variable.key} ${variable.label}`).join(' ').toLocaleLowerCase()
  if (/integrated|all local data/.test(identity)) return 'integrated'
  if (/\bxrf\b|x-ray fluorescence/.test(identity)) return 'xrf'
  if (/spectral|hyperspectral|mineral scanner/.test(identity)) return 'spectral'
  if (/logging|core[_ -]?row|geolog|geotech|litholog/.test(identity)) return 'logging'
  if (/strength|uniaxial|point[ -]?load|schmidt/.test(identity)) return 'strength'
  if (/laborator|\blab\b|assay|geochem/.test(identity)) return 'laboratory'
  if (/drillhole|collar|survey/.test(identity)) return 'drillholes'
  if (/\bxrf\b|x-ray fluorescence/.test(variables)) return 'xrf'
  if (/spectral|hyperspectral|mineral scanner/.test(variables)) return 'spectral'
  if (/strength|\bucs\b|uniaxial|point[ -]?load|schmidt/.test(variables)) return 'strength'
  if (/laborator|\blab\b|assay|geochem/.test(variables)) return 'laboratory'
  if (/logging|geolog|geotech|litholog/.test(variables)) return 'logging'
  return 'other'
}

function dataTypeLabel(kind: EdaDatasetKind): string {
  return EDA_DATASET_CATALOG.find((item) => item.id === kind)?.label ?? 'Other'
}

function mergeDimensions(...groups: ReadonlyArray<readonly EdaDimensionDefinition[]>): EdaDimensionDefinition[] {
  const dimensions = new Map<string, EdaDimensionDefinition>()
  groups.flat().forEach((dimension) => dimensions.set(dimension.key, dimension))
  return [...dimensions.values()]
}

function mergeVariables(...groups: ReadonlyArray<readonly EdaVariableDefinition[]>): EdaVariableDefinition[] {
  const variables = new Map<string, EdaVariableDefinition>()
  groups.flat().forEach((variable) => variables.set(variable.key, variable))
  return [...variables.values()]
}

const localImportLabels = {
  laboratory: 'Laboratory CSV imports',
  spectral: 'Spectral CSV imports',
  strength: 'Strength CSV imports',
  xrf: 'XRF CSV imports',
} as const

const localImportKinds: Record<keyof typeof localImportLabels, EdaDatasetKind> = {
  laboratory: 'laboratory',
  spectral: 'spectral',
  strength: 'strength',
  xrf: 'xrf',
}

type LocalTabularDrafts = Partial<Record<keyof typeof localImportLabels, LocalTabularDraft>>

function normalizedIdentifier(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, '')
}

function headerIndex(columns: readonly string[], aliases: readonly string[]): number {
  return columns.findIndex((column) => aliases.includes(normalizedIdentifier(column)))
}

function variableSlug(value: string, index: number): string {
  const slug = value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return (/^[a-z]/.test(slug) ? slug : `column_${slug || index + 1}`).slice(0, 48)
}

function csvNumber(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed.length === 0) return null
  const normalized = /^[-+]?\d{1,3}(,\d{3})*(\.\d+)?$/.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function unitForColumn(column: string): string {
  const normalized = column.toLocaleLowerCase()
  if (/g\s*\/\s*t|gpt/.test(normalized)) return 'g/t'
  if (/\bppm\b/.test(normalized)) return 'ppm'
  if (/\bmpa\b/.test(normalized)) return 'MPa'
  if (/\bkn\b/.test(normalized)) return 'kN'
  if (/\bmm\b/.test(normalized)) return 'mm'
  if (/%/.test(normalized)) return '%'
  if (/azimuth|\bdip\b|inclination|bearing/.test(normalized)) return 'degree'
  return ''
}

function localTabularDataset(
  draft: LocalTabularDraft,
  project: ProjectSummary,
  drillholes: readonly DrillholeSummary[],
): EdaDataset {
  const holeIndex = headerIndex(draft.columns, ['holeid', 'borehole', 'hole', 'drillhole', 'drillholeid', 'bhid'])
  const fromIndex = headerIndex(draft.columns, ['from', 'fromm', 'depthfrom', 'depthfromm'])
  const toIndex = headerIndex(draft.columns, ['to', 'tom', 'depthto', 'depthtom'])
  const depthIndex = headerIndex(draft.columns, ['depth', 'depthm', 'measureddepth', 'md'])
  const sampleIndex = headerIndex(draft.columns, ['sampleid', 'sample', 'reading', 'readingid', 'scanid', 'recordid'])
  const locationColumns = new Set([holeIndex, fromIndex, toIndex, depthIndex].filter((index) => index >= 0))
  const usedKeys = new Set<string>()
  const columns = draft.columns.flatMap((column, columnIndex) => {
    if (locationColumns.has(columnIndex)) return []
    const populated = draft.rows.map((row) => row[columnIndex]?.trim() ?? '').filter((value) => value.length > 0)
    if (populated.length === 0) return []
    const dataType = populated.every((value) => csvNumber(value) !== null) ? 'numeric' as const : 'category' as const
    const baseKey = `${draft.section}.${variableSlug(column, columnIndex)}`
    let key = baseKey
    let suffix = 2
    while (usedKeys.has(key)) {
      key = `${baseKey}_${suffix}`
      suffix += 1
    }
    usedKeys.add(key)
    return [{ columnIndex, dataType, key, label: column, unit: unitForColumn(column) }]
  })
  const holesByName = new Map(drillholes.map((hole) => [normalizedIdentifier(hole.name), hole]))
  const datasetLabel = localImportLabels[draft.section]
  const dataType = dataTypeLabel(localImportKinds[draft.section])
  const observations = draft.rows.map((row, rowIndex): EdaObservation => {
    const rawHoleName = holeIndex < 0 ? '' : row[holeIndex]?.trim() ?? ''
    const hole = holesByName.get(normalizedIdentifier(rawHoleName))
    const pointDepth = depthIndex < 0 ? null : csvNumber(row[depthIndex])
    const depthFrom = (fromIndex < 0 ? null : csvNumber(row[fromIndex])) ?? pointDepth ?? 0
    const depthTo = Math.max(depthFrom, (toIndex < 0 ? null : csvNumber(row[toIndex])) ?? pointDepth ?? depthFrom)
    const sourceId = `local:${draft.section}:${draft.updatedAt}:${rowIndex + 2}`
    const dimensions: Record<string, string> = {
      data_source: datasetLabel,
      data_type: dataType,
      dataset: datasetLabel,
      drillhole: hole?.name ?? (rawHoleName || 'Project'),
      quality: draft.dirty ? 'Local draft' : 'Local saved copy',
      source_type: `analytics.csv.${draft.section}`,
    }
    const values: Record<string, number | null> = {}
    let lithology = 'Unassigned'
    columns.forEach((column) => {
      const raw = row[column.columnIndex]?.trim() ?? ''
      if (column.dataType === 'numeric') values[column.key] = csvNumber(raw)
      else if (raw.length > 0) {
        dimensions[column.key] = raw
        if (/litholog|rocktype|rock_type/.test(normalizedIdentifier(column.label))) lithology = raw
      }
    })
    return {
      depthFrom,
      depthTo,
      dimensions,
      easting: hole?.collar?.easting ?? 0,
      holeId: hole?.name ?? (rawHoleName || 'Project'),
      id: sourceId,
      joinKey: `${hole?.id ?? (normalizedIdentifier(rawHoleName) || 'project')}:${depthFrom}:${depthTo}`,
      lithology,
      northing: hole?.collar?.northing ?? 0,
      sampleId: sampleIndex < 0 ? `${draft.fileName}:${rowIndex + 2}` : row[sampleIndex]?.trim() || `${draft.fileName}:${rowIndex + 2}`,
      sourceObservationId: sourceId,
      sourceObservationIds: [sourceId],
      values,
    }
  })
  return {
    dimensions: [
      ...baseDimensions,
      ...columns.filter((column) => column.dataType === 'category').map((column) => ({ key: column.key, label: column.label })),
    ],
    id: `local-csv-${draft.section}`,
    name: `${datasetLabel} · local`,
    observations,
    producer: 'GeoEye Analytics local database',
    project: project.name,
    snapshotAt: draft.updatedAt,
    source: 'live',
    support: `local ${draft.section} CSV · ${observations.length.toLocaleString()} records`,
    variables: columns.map((column): EdaVariableDefinition => ({
      dataType: column.dataType,
      decimals: column.unit === '%' || column.unit === 'degree' ? 1 : 3,
      key: column.key,
      label: column.label,
      origin: 'primary',
      shortLabel: column.label,
      unit: column.unit,
    })),
  }
}

function localDrillholeDatasets(
  snapshot: LocalProjectSnapshot | null,
  draft: LocalDrillholeDraft | null,
  project: ProjectSummary,
): EdaDataset[] {
  const drillholes = effectiveDrillholes(snapshot, draft)
  const snapshotAt = draft?.updatedAt ?? snapshot?.refreshedAt ?? new Date(0).toISOString()
  const collarObservations = drillholes.flatMap((hole): EdaObservation[] => {
    if (hole.collar === null) return []
    const sourceId = `local:collar:${hole.id}`
    return [{
      depthFrom: 0,
      depthTo: 0,
      dimensions: { data_source: 'Drillhole collars', data_type: 'Drillholes', dataset: 'Drillhole collars', drillhole: hole.name, quality: 'Local database', source_type: 'drillhole.collar' },
      easting: hole.collar.easting,
      holeId: hole.name,
      id: sourceId,
      joinKey: `${hole.id}:0:0`,
      lithology: 'Unassigned',
      northing: hole.collar.northing,
      sampleId: hole.name,
      sourceObservationId: sourceId,
      sourceObservationIds: [sourceId],
      values: {
        'collar.easting': hole.collar.easting,
        'collar.elevation': hole.collar.elevation,
        'collar.northing': hole.collar.northing,
      },
    }]
  })
  const datasets: EdaDataset[] = []
  if (collarObservations.length > 0) datasets.push({
    dimensions: baseDimensions,
    id: 'local-drillhole-collars',
    name: 'Drillhole collars · local',
    observations: collarObservations,
    producer: 'GeoEye Analytics local database',
    project: project.name,
    snapshotAt,
    source: 'live',
    support: `point · ${collarObservations.length.toLocaleString()} records`,
    variables: [
      { dataType: 'numeric', decimals: 2, key: 'collar.easting', label: 'Collar easting', origin: 'primary', shortLabel: 'Easting', unit: 'm' },
      { dataType: 'numeric', decimals: 2, key: 'collar.northing', label: 'Collar northing', origin: 'primary', shortLabel: 'Northing', unit: 'm' },
      { dataType: 'numeric', decimals: 2, key: 'collar.elevation', label: 'Collar elevation', origin: 'primary', shortLabel: 'Elevation', unit: 'm' },
    ],
  })

  const holesById = new Map(drillholes.map((hole) => [hole.id, hole]))
  const surveyObservations = Object.entries(effectiveSurveysByHoleId(snapshot, draft)).flatMap(([holeId, stations]) => {
    const hole = holesById.get(holeId)
    return stations.map((station): EdaObservation => {
      const sourceId = `local:survey:${station.id}`
      return {
        depthFrom: station.measuredDepth,
        depthTo: station.measuredDepth,
        dimensions: { data_source: 'Drillhole surveys', data_type: 'Drillholes', dataset: 'Drillhole surveys', drillhole: hole?.name ?? holeId, quality: 'Local database', source_type: 'drillhole.survey' },
        easting: hole?.collar?.easting ?? 0,
        holeId: hole?.name ?? holeId,
        id: sourceId,
        joinKey: `${holeId}:${station.measuredDepth}:${station.measuredDepth}`,
        lithology: 'Unassigned',
        northing: hole?.collar?.northing ?? 0,
        sampleId: `${hole?.name ?? holeId}@${station.measuredDepth}`,
        sourceObservationId: sourceId,
        sourceObservationIds: [sourceId],
        values: {
          'survey.azimuth': station.azimuth,
          'survey.dip': station.dip,
          'survey.measured_depth': station.measuredDepth,
        },
      }
    })
  })
  if (surveyObservations.length > 0) datasets.push({
    dimensions: baseDimensions,
    id: 'local-drillhole-surveys',
    name: 'Drillhole surveys · local',
    observations: surveyObservations,
    producer: 'GeoEye Analytics local database',
    project: project.name,
    snapshotAt,
    source: 'live',
    support: `orientation · ${surveyObservations.length.toLocaleString()} records`,
    variables: [
      { dataType: 'numeric', decimals: 2, key: 'survey.measured_depth', label: 'Measured depth', origin: 'primary', shortLabel: 'MD', unit: 'm' },
      { dataType: 'numeric', decimals: 1, key: 'survey.azimuth', label: 'Azimuth', origin: 'primary', shortLabel: 'Azimuth', unit: 'degree' },
      { dataType: 'numeric', decimals: 1, key: 'survey.dip', label: 'Dip', origin: 'primary', shortLabel: 'Dip', unit: 'degree' },
    ],
  })
  return datasets
}

function fieldLoggingDataset(
  dataset: FieldLoggingDataset,
  project: ProjectSummary,
  drillholes: readonly DrillholeSummary[],
): EdaDataset | null {
  if (dataset.records.length === 0 || dataset.columns.length === 0) return null
  const holesById = new Map(drillholes.map((hole) => [hole.id, hole]))
  const categoryColumns = dataset.columns.filter((column) => column.dataType !== 'numeric')
  const observations = dataset.records.map((record): EdaObservation => {
    const hole = record.holeId === null ? undefined : holesById.get(record.holeId)
    const depthFrom = record.depthFrom ?? record.depthTo ?? 0
    const depthTo = Math.max(depthFrom, record.depthTo ?? depthFrom)
    const dimensions: Record<string, string> = {
      data_source: dataset.name,
      data_type: 'Logging',
      dataset: dataset.name,
      drillhole: hole?.name ?? record.holeId ?? 'Project',
      logging_category: dataset.category ?? 'Uncategorised',
      logging_template: dataset.name,
      quality: 'Local database',
      source_type: 'field.logging',
    }
    const values: Record<string, number | null> = {}
    let lithology = 'Unassigned'
    dataset.columns.forEach((column) => {
      const value = record.values[column.key]
      if (column.dataType === 'numeric') {
        const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
        values[column.key] = Number.isFinite(numeric) ? numeric : null
      } else if (value !== null && value !== undefined && String(value).length > 0) {
        dimensions[column.key] = String(value)
        if (/litholog|rock[ _-]?type/i.test(`${column.key} ${column.label}`)) lithology = String(value)
      }
    })
    return {
      depthFrom,
      depthTo,
      dimensions,
      easting: hole?.collar?.easting ?? 0,
      holeId: hole?.name ?? record.holeId ?? 'Project',
      id: `local:logging:${dataset.id}:${record.id}`,
      joinKey: `${record.holeId ?? 'project'}:${depthFrom}:${depthTo}`,
      lithology,
      northing: hole?.collar?.northing ?? 0,
      sampleId: record.id,
      sourceObservationId: record.id,
      sourceObservationIds: [record.id],
      values,
    }
  })
  return {
    dimensions: mergeDimensions(baseDimensions, [
      { key: 'logging_template', label: 'Logging template' },
      { key: 'logging_category', label: 'Logging category' },
    ], categoryColumns.map((column) => ({ key: column.key, label: column.label }))),
    id: `local-field-logging-${dataset.id}`,
    name: `${dataset.name} · Logging v${dataset.version}`,
    observations,
    producer: 'GeoEye Field local database',
    project: project.name,
    snapshotAt: dataset.updatedAt,
    source: 'live',
    support: `logging intervals · ${observations.length.toLocaleString()} records`,
    variables: dataset.columns.map((column): EdaVariableDefinition => ({
      dataType: column.dataType === 'numeric' ? 'numeric' : 'category',
      decimals: column.unit === '%' || column.unit === 'degree' ? 1 : 3,
      key: column.key,
      label: column.label,
      origin: 'primary',
      shortLabel: column.label,
      unit: column.unit ?? '',
    })),
  }
}

function sourceGroupDimension(kind: EdaDatasetKind) {
  if (kind === 'laboratory') return { key: 'assay_source', label: 'Lab / Assay source' }
  if (kind === 'integrated') return { key: 'integrated_source', label: 'Integrated source' }
  return { key: `${kind}_source`, label: `${dataTypeLabel(kind)} source` }
}

function datasetWithSourceGroup(dataset: EdaDataset): EdaDataset {
  const dimension = sourceGroupDimension(edaDatasetKind(dataset))
  return {
    ...dataset,
    dimensions: mergeDimensions(dataset.dimensions, [dimension]),
    observations: dataset.observations.map((observation) => ({
      ...observation,
      dimensions: { ...observation.dimensions, [dimension.key]: dataset.name.replace(/ · (local|v\d+|Logging v\d+)$/, '') },
    })),
  }
}

function integratedLocalDataset(datasets: readonly EdaDataset[], project: ProjectSummary): EdaDataset | null {
  const sourceDatasets = datasets.map(datasetWithSourceGroup)
  if (sourceDatasets.length < 2 || !sourceDatasets.some((dataset) => edaDatasetKind(dataset) !== 'drillholes')) return null
  const kindPriority: Record<EdaDatasetKind, number> = {
    integrated: 0,
    drillholes: 10,
    laboratory: 50,
    logging: 70,
    other: 30,
    spectral: 40,
    strength: 45,
    xrf: 40,
  }
  const base = [...sourceDatasets].sort((left, right) => {
    const intervalScore = (dataset: EdaDataset) => dataset.observations.some((row) => row.depthTo > row.depthFrom) ? 100 : 0
    return intervalScore(right) + kindPriority[edaDatasetKind(right)] + Math.min(20, right.observations.length / 100)
      - intervalScore(left) - kindPriority[edaDatasetKind(left)] - Math.min(20, left.observations.length / 100)
  })[0]
  if (base === undefined) return null
  const genericDimensions = new Set(['data_source', 'data_type', 'dataset', 'drillhole', 'quality', 'source_type'])
  const analyticalObservations = buildAnalyticalObservations(base.id, base.observations, sourceDatasets
    .filter((dataset) => dataset.id !== base.id)
    .map((dataset) => ({
      datasetId: dataset.id,
      dimensions: dataset.dimensions.map((dimension) => dimension.key).filter((key) => !genericDimensions.has(key)),
      match: 'point-or-interval' as const,
      observations: dataset.observations,
    })))
  const kindsByDatasetId = new Map(sourceDatasets.map((dataset) => [dataset.id, edaDatasetKind(dataset)]))
  const observations = analyticalObservations.map((observation) => {
    const coverage = [...new Set(observation.analyticalLineage
      .map((entry) => kindsByDatasetId.get(entry.datasetId))
      .filter((kind): kind is EdaDatasetKind => kind !== undefined)
      .map(dataTypeLabel))]
    return {
      ...observation,
      dimensions: { ...observation.dimensions, data_coverage: coverage.join(' + ') },
    }
  })
  const snapshotAt = sourceDatasets.map((dataset) => dataset.snapshotAt).sort().at(-1) ?? new Date(0).toISOString()
  return {
    dimensions: mergeDimensions(baseDimensions, [{ key: 'data_coverage', label: 'Available data types' }], ...sourceDatasets.map((dataset) => dataset.dimensions)),
    id: 'local-all-data-integrated',
    name: 'All local data · integrated',
    observations,
    producer: 'GeoEye Analytics local database',
    project: project.name,
    snapshotAt,
    source: 'live',
    support: `${base.name.split(' · ')[0]} support · drillhole/depth matched · ${observations.length.toLocaleString()} records`,
    variables: mergeVariables(...sourceDatasets.map((dataset) => dataset.variables)),
  }
}

function decimalsFor(definition: VariableDefinition): number {
  const configured = definition.metadata?.decimals
  if (typeof configured === 'number' && Number.isInteger(configured) && configured >= 0 && configured <= 12) return configured
  if (definition.canonicalUnit === '%' || definition.canonicalUnit === 'degree') return 1
  return 3
}

function variableDefinition(definition: VariableDefinition): EdaVariableDefinition {
  return {
    dataType: definition.dataType === 'category' ? 'category' : 'numeric',
    decimals: decimalsFor(definition),
    key: definition.key,
    label: definition.displayName,
    origin: definition.origin === 'primary' || definition.origin === 'integrated' || definition.origin === 'derived'
      ? definition.origin
      : 'derived',
    shortLabel: definition.displayName,
    unit: definition.canonicalUnit ?? '',
  }
}

function typedValue(observation: ObservationValue): number | string | boolean | null {
  return observation.numericValue
    ?? observation.categoryValue
    ?? observation.textValue
    ?? observation.booleanValue
    ?? observation.datetimeValue
}

function rowKey(observation: ObservationValue): string {
  return [
    observation.datasetId,
    observation.sourceType,
    observation.sourceId,
    observation.holeId ?? '',
    observation.depthFrom ?? '',
    observation.depthTo ?? '',
  ].join('|')
}

function observationsForDataset(
  dataset: Dataset,
  observations: readonly ObservationValue[],
  holes: ReadonlyMap<string, DrillholeSummary>,
  definitions: ReadonlyMap<string, VariableDefinition>,
  dataType: string,
): EdaObservation[] {
  const rows = new Map<string, EdaObservation>()

  observations.filter((observation) => observation.datasetId === dataset.id).forEach((observation) => {
    const key = rowKey(observation)
    const hole = observation.holeId === null ? undefined : holes.get(observation.holeId)
    const holeName = hole?.name ?? observation.holeId ?? 'Project'
    const value = typedValue(observation)
    const existing = rows.get(key) ?? {
      depthFrom: observation.depthFrom ?? 0,
      depthTo: observation.depthTo ?? observation.depthFrom ?? 0,
      dimensions: {
        data_source: dataset.name,
        data_type: dataType,
        dataset: dataset.name,
        drillhole: holeName,
        quality: observation.quality,
        source_type: observation.sourceType,
      },
      easting: hole?.collar?.easting ?? 0,
      holeId: holeName,
      id: `live:${key}`,
      joinKey: `${observation.holeId ?? 'project'}:${observation.depthFrom ?? 0}:${observation.depthTo ?? observation.depthFrom ?? 0}`,
      lithology: 'Unassigned',
      northing: hole?.collar?.northing ?? 0,
      sampleId: observation.sourceId,
      sourceObservationId: observation.id,
      sourceObservationIds: [],
      values: {},
    }

    existing.sourceObservationIds = [...new Set([...(existing.sourceObservationIds ?? []), observation.id])]
    if (typeof value === 'number') existing.values[observation.variableKey] = value
    else if (value !== null) {
      existing.dimensions[observation.variableKey] = String(value)
      if (/lithology/i.test(observation.variableKey)) existing.lithology = String(value)
    }
    // Retain an explicit null for numeric variables so missingness is visible to
    // the analysis engines instead of silently dropping the field.
    if (value === null && definitions.get(observation.variableKey)?.dataType === 'numeric') {
      existing.values[observation.variableKey] = null
    }
    rows.set(key, existing)
  })

  return [...rows.values()]
}

/** Converts the normalized Data Pool read model into the snapshot shape used by the analytical workbenches. */
export async function loadLiveEdaDatasets(
  client: DataPoolClient,
  project: ProjectSummary,
): Promise<EdaDataset[]> {
  const [variables, datasets, drillholes] = await Promise.all([
    client.variables(),
    client.datasets(project.id),
    client.drillholes(project.id),
  ])
  if (variables.length === 0 || datasets.length === 0) return []

  const observations = await client.queryObservations({
    acceptedOnly: true,
    limit: LIVE_OBSERVATION_LIMIT,
    projectId: project.id,
    variableKeys: variables.map((variable) => variable.key),
  })
  return buildEdaDatasets({ datasets, drillholes, observations, project, variables })
}

/** Builds feature datasets from a persisted local snapshot without contacting the Data Pool. */
export function buildEdaDatasets(input: {
  datasets: readonly Dataset[]
  drillholes: readonly DrillholeSummary[]
  observations: readonly ObservationValue[]
  project: ProjectSummary
  variables: readonly VariableDefinition[]
}): EdaDataset[] {
  const { datasets, drillholes, observations, project, variables } = input
  const definitions = new Map(variables.map((variable) => [variable.key, variable]))
  const holes = new Map(drillholes.map((hole) => [hole.id, hole]))

  return datasets.flatMap((dataset): EdaDataset[] => {
    const observedKeys = new Set(observations
      .filter((observation) => observation.datasetId === dataset.id)
      .map((observation) => observation.variableKey))
    const datasetVariables = variables.filter((variable) => observedKeys.has(variable.key))
    const variablesForDataset = datasetVariables.map(variableDefinition)
    const kind = edaDatasetKind({ id: dataset.id, name: dataset.name, producer: dataset.producerName, variables: variablesForDataset })
    const datasetObservations = observationsForDataset(dataset, observations, holes, definitions, dataTypeLabel(kind))
    if (datasetObservations.length === 0) return []
    const categoryDimensions = datasetVariables
      .filter((variable) => variable.dataType !== 'numeric')
      .map((variable) => ({ key: variable.key, label: variable.displayName }))
    return [{
      dimensions: [...baseDimensions, ...categoryDimensions],
      id: dataset.id,
      name: `${dataset.name} · v${dataset.currentVersion}`,
      observations: datasetObservations,
      producer: dataset.producerName,
      project: project.name,
      snapshotAt: dataset.updatedAt,
      source: 'live',
      support: `${dataset.spatialSupport} · ${datasetObservations.length.toLocaleString()} records`,
      variables: variablesForDataset,
    }]
  })
}

export function buildLocalEdaDatasets(
  snapshot: LocalProjectSnapshot | null,
  drillholeDraft: LocalDrillholeDraft | null,
  tabularDrafts: LocalTabularDrafts = {},
  activeProject: ProjectSummary | null = null,
): EdaDataset[] {
  const project = activeProject ?? snapshot?.project ?? null
  if (project === null) return []
  const drillholes = effectiveDrillholes(snapshot, drillholeDraft)
  const localDraftDatasets = (Object.keys(localImportLabels) as Array<keyof typeof localImportLabels>)
    .flatMap((section) => tabularDrafts[section] === undefined ? [] : [localTabularDataset(tabularDrafts[section], project, drillholes)])
  const replacedDatasetNames = new Set(localDraftDatasets.map((dataset) => dataset.name.replace(/ · local$/, '')))
  const snapshotDatasets = snapshot === null ? [] : buildEdaDatasets({
    datasets: snapshot.datasets,
    drillholes,
    observations: snapshot.observations,
    project: snapshot.project,
    variables: snapshot.variables,
  }).filter((dataset) => ![...replacedDatasetNames].some((name) => dataset.name.startsWith(`${name} · v`)))
  const loggingDatasets = (snapshot?.fieldLogging.datasets ?? [])
    .flatMap((dataset) => {
      const converted = fieldLoggingDataset(dataset, project, drillholes)
      return converted === null ? [] : [converted]
    })
  const sourceDatasets = [...localDraftDatasets, ...loggingDatasets, ...snapshotDatasets, ...localDrillholeDatasets(snapshot, drillholeDraft, project)]
  const integrated = integratedLocalDataset(sourceDatasets, project)
  return integrated === null ? sourceDatasets : [integrated, ...sourceDatasets]
}

/** Returns only durable project datasets from the signed-in or offline local workspace. */
export function useProjectEdaDatasets() {
  const workspace = useDataPoolWorkspace()
  const projectId = workspace.project?.id ?? 'no-project'
  const localDraftSignature = (Object.keys(workspace.localTabularDrafts) as Array<keyof typeof workspace.localTabularDrafts>)
    .sort()
    .map((section) => `${section}:${workspace.localTabularDrafts[section]?.updatedAt ?? 'empty'}`)
    .join('|')
  return useQuery<EdaDataset[]>({
    enabled: workspace.live && !workspace.projectsLoading && !workspace.localLoading,
    queryFn: () => Promise.resolve(buildLocalEdaDatasets(workspace.localSnapshot, workspace.localDrillholeDraft, workspace.localTabularDrafts, workspace.project)),
    queryKey: ['eda-datasets', 'local', projectId, workspace.localSnapshot?.refreshedAt ?? 'empty', workspace.localDrillholeDraft?.updatedAt ?? 'no-draft', localDraftSignature],
    staleTime: Number.POSITIVE_INFINITY,
  })
}
