import type { EdaDataset, EdaVariableKey } from '../data/edaDemo.js'
import { calculateDistribution, type DistributionRequest, type DistributionResult, type WeightingMethod } from './distributionEngine.js'

export interface EdaRunConfiguration {
  activeFilterKeys: string[]
  compareBy: string | null
  datasetId: string
  datasetName: string
  filterValues: Record<string, string>
  minimumPopulationSize: number
  secondGroup: string | null
  snapshotAt: string
  supportLabel: string
  variableKeys: EdaVariableKey[]
  weighting: {
    cellSize: number
    method: WeightingMethod
  }
}

export interface EdaPopulationWork {
  compareValue: string | null
  distributionRequest: DistributionRequest
  label: string
  populationId: string
  secondGroupValue: string | null
  variableKey: EdaVariableKey
}

export interface EdaRunRequest {
  configuration: EdaRunConfiguration
  configurationSignature: string
  populations: EdaPopulationWork[]
  requestedAt: string
  runId: string
  runNumber: number
}

export interface EdaPopulationResult extends Omit<EdaPopulationWork, 'distributionRequest'> {
  insufficient: boolean
  result: DistributionResult
}

export interface EdaRunResult {
  completedAt: string
  configuration: EdaRunConfiguration
  configurationSignature: string
  populations: EdaPopulationResult[]
  requestedAt: string
  runId: string
  runNumber: number
}

function normalizedConfiguration(configuration: EdaRunConfiguration) {
  return {
    ...configuration,
    activeFilterKeys: [...configuration.activeFilterKeys].sort(),
    filterValues: Object.fromEntries(Object.entries(configuration.filterValues).sort(([left], [right]) => left.localeCompare(right))),
    variableKeys: [...configuration.variableKeys].sort(),
  }
}

export function edaConfigurationSignature(configuration: EdaRunConfiguration) {
  return JSON.stringify(normalizedConfiguration(configuration))
}

function matchesFilters(
  dimensions: Readonly<Record<string, string>>,
  activeFilterKeys: readonly string[],
  filterValues: Readonly<Record<string, string>>,
) {
  return activeFilterKeys.every((key) => {
    const selected = filterValues[key]
    return selected === undefined || selected === 'all' || dimensions[key] === selected
  })
}

function populationKey(variableKey: string, compareValue: string | null, secondGroupValue: string | null) {
  return [variableKey, compareValue ?? 'all', secondGroupValue ?? 'all'].map(encodeURIComponent).join('::')
}

export function buildEdaRunRequest(
  configuration: EdaRunConfiguration,
  dataset: EdaDataset,
  runNumber: number,
  now = new Date(),
): EdaRunRequest {
  const filtered = dataset.observations.filter((observation) => matchesFilters(
    observation.dimensions,
    configuration.activeFilterKeys,
    configuration.filterValues,
  ))
  const compareDimension = dataset.dimensions.find((dimension) => dimension.key === configuration.compareBy)
  const secondDimension = dataset.dimensions.find((dimension) => dimension.key === configuration.secondGroup)
  const populations: EdaPopulationWork[] = []

  configuration.variableKeys.forEach((variableKey) => {
    const variable = dataset.variables.find((candidate) => candidate.key === variableKey)
    if (variable === undefined) return
    const grouped = new Map<string, {
      compareValue: string | null
      observations: typeof filtered
      secondGroupValue: string | null
    }>()
    filtered.forEach((observation) => {
      const compareValue = configuration.compareBy === null ? null : observation.dimensions[configuration.compareBy] ?? 'Unassigned'
      const secondGroupValue = configuration.secondGroup === null ? null : observation.dimensions[configuration.secondGroup] ?? 'Unassigned'
      const key = `${compareValue ?? ''}\u0000${secondGroupValue ?? ''}`
      const group = grouped.get(key)
      if (group === undefined) grouped.set(key, { compareValue, observations: [observation], secondGroupValue })
      else group.observations.push(observation)
    })

    grouped.forEach((group) => {
      const finite = group.observations.flatMap((observation) => {
        const value = observation.values[variableKey]
        if (typeof value !== 'number' || !Number.isFinite(value)) return []
        return [{
          groupId: observation.dimensions.domain ?? observation.lithology,
          holeId: observation.holeId,
          sourceObservationId: observation.sourceObservationId,
          support: Math.max(Number.EPSILON, observation.depthTo - observation.depthFrom),
          value,
          x: observation.easting,
          y: observation.northing,
          z: (observation.depthFrom + observation.depthTo) / 2,
        }]
      })
      if (finite.length === 0) return
      const groupLabels = [
        group.compareValue === null ? null : `${compareDimension?.label ?? configuration.compareBy}: ${group.compareValue}`,
        group.secondGroupValue === null ? null : `${secondDimension?.label ?? configuration.secondGroup}: ${group.secondGroupValue}`,
      ].filter((value): value is string => value !== null)
      const label = groupLabels.length === 0 ? `${variable.shortLabel} · All observations` : `${variable.shortLabel} · ${groupLabels.join(' · ')}`
      populations.push({
        compareValue: group.compareValue,
        distributionRequest: {
          algorithmVersion: 'geoeye-distribution-1.0.0',
          bootstrap: { blockSize: 15, iterations: 120, method: 'spatial', seed: 20_261_001 + populations.length },
          datasetId: configuration.datasetId,
          filterSignature: configuration.activeFilterKeys.length === 0
            ? 'No filters'
            : configuration.activeFilterKeys.map((key) => `${key}=${configuration.filterValues[key] ?? 'all'}`).join(';'),
          missingCount: group.observations.length - finite.length,
          observations: finite,
          snapshotAt: configuration.snapshotAt,
          supportLabel: configuration.supportLabel,
          variableKey,
          weighting: configuration.weighting,
        },
        label,
        populationId: populationKey(variableKey, group.compareValue, group.secondGroupValue),
        secondGroupValue: group.secondGroupValue,
        variableKey,
      })
    })
  })

  return {
    configuration,
    configurationSignature: edaConfigurationSignature(configuration),
    populations,
    requestedAt: now.toISOString(),
    runId: `eda-run-${now.getTime()}-${runNumber}`,
    runNumber,
  }
}

export function calculateEdaRun(request: EdaRunRequest, completedAt = new Date()): EdaRunResult {
  return {
    completedAt: completedAt.toISOString(),
    configuration: request.configuration,
    configurationSignature: request.configurationSignature,
    populations: request.populations.map((population) => {
      const result = calculateDistribution(population.distributionRequest)
      return {
        compareValue: population.compareValue,
        insufficient: result.sample.summary.count < request.configuration.minimumPopulationSize,
        label: population.label,
        populationId: population.populationId,
        result,
        secondGroupValue: population.secondGroupValue,
        variableKey: population.variableKey,
      }
    }),
    requestedAt: request.requestedAt,
    runId: request.runId,
    runNumber: request.runNumber,
  }
}
