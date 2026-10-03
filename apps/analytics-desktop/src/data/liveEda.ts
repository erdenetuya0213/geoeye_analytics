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

const LIVE_OBSERVATION_LIMIT = 200_000

const baseDimensions: readonly EdaDimensionDefinition[] = [
  { key: 'drillhole', label: 'Drillhole' },
  { key: 'dataset', label: 'Dataset' },
  { key: 'source_type', label: 'Source type' },
  { key: 'quality', label: 'Quality' },
]

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

/** Returns demo snapshots only in demo mode and project snapshots only in a signed-in workspace. */
export function useProjectEdaDatasets() {
  const workspace = useDataPoolWorkspace()
  const projectId = workspace.project?.id ?? 'no-project'
  return useQuery<EdaDataset[]>({
    enabled: !workspace.live || !workspace.projectsLoading,
    queryFn: () => {
      if (!workspace.live) return loadEdaDatasets()
      if (workspace.client === null || workspace.project === null) return Promise.resolve([])
      return loadLiveEdaDatasets(workspace.client, workspace.project)
    },
    queryKey: workspace.live
      ? ['eda-datasets', 'live', workspace.scope, projectId]
      : ['eda-datasets', 'demo'],
    staleTime: 30_000,
  })
}
