import type {
  DataPoolClient,
  Dataset,
  DrillholeSummary,
  ObservationValue,
  ProjectSummary,
  VariableDefinition,
} from '@geoeye/datapool-client'
import { useQuery } from '@tanstack/react-query'
import type { EdaObservation } from '../analysis/eda.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { loadEdaDatasets, type EdaDataset, type EdaDimensionDefinition, type EdaVariableDefinition } from './edaDemo.js'
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
  { key: 'dataset', label: 'Dataset' },
  { key: 'source_type', label: 'Source type' },
  { key: 'quality', label: 'Quality' },
]

const localImportLabels = {
  laboratory: 'Laboratory CSV imports',
  spectral: 'Spectral CSV imports',
  strength: 'Strength CSV imports',
  xrf: 'XRF CSV imports',
} as const

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
  const observations = draft.rows.map((row, rowIndex): EdaObservation => {
    const rawHoleName = holeIndex < 0 ? '' : row[holeIndex]?.trim() ?? ''
    const hole = holesByName.get(normalizedIdentifier(rawHoleName))
    const pointDepth = depthIndex < 0 ? null : csvNumber(row[depthIndex])
    const depthFrom = (fromIndex < 0 ? null : csvNumber(row[fromIndex])) ?? pointDepth ?? 0
    const depthTo = Math.max(depthFrom, (toIndex < 0 ? null : csvNumber(row[toIndex])) ?? pointDepth ?? depthFrom)
    const sourceId = `local:${draft.section}:${draft.updatedAt}:${rowIndex + 2}`
    const dimensions: Record<string, string> = {
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
      dimensions: { dataset: 'Drillhole collars', drillhole: hole.name, quality: 'Local database', source_type: 'drillhole.collar' },
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
        dimensions: { dataset: 'Drillhole surveys', drillhole: hole?.name ?? holeId, quality: 'Local database', source_type: 'drillhole.survey' },
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
    const datasetObservations = observationsForDataset(dataset, observations, holes, definitions)
    if (datasetObservations.length === 0) return []
    const observedKeys = new Set(observations
      .filter((observation) => observation.datasetId === dataset.id)
      .map((observation) => observation.variableKey))
    const datasetVariables = variables.filter((variable) => observedKeys.has(variable.key))
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
      variables: datasetVariables.map(variableDefinition),
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
  return [...localDraftDatasets, ...snapshotDatasets, ...localDrillholeDatasets(snapshot, drillholeDraft, project)]
}

/** Returns demo snapshots only in demo mode and project snapshots only in a signed-in workspace. */
export function useProjectEdaDatasets() {
  const workspace = useDataPoolWorkspace()
  const projectId = workspace.project?.id ?? 'no-project'
  const localDraftSignature = (Object.keys(workspace.localTabularDrafts) as Array<keyof typeof workspace.localTabularDrafts>)
    .sort()
    .map((section) => `${section}:${workspace.localTabularDrafts[section]?.updatedAt ?? 'empty'}`)
    .join('|')
  return useQuery<EdaDataset[]>({
    enabled: !workspace.live || (!workspace.projectsLoading && !workspace.localLoading),
    queryFn: () => {
      if (!workspace.live) return loadEdaDatasets()
      return Promise.resolve(buildLocalEdaDatasets(workspace.localSnapshot, workspace.localDrillholeDraft, workspace.localTabularDrafts, workspace.project))
    },
    queryKey: workspace.live
      ? ['eda-datasets', 'local', projectId, workspace.localSnapshot?.refreshedAt ?? 'empty', workspace.localDrillholeDraft?.updatedAt ?? 'no-draft', localDraftSignature]
      : ['eda-datasets', 'demo'],
    staleTime: Number.POSITIVE_INFINITY,
  })
}
