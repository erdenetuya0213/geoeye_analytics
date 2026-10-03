import type { EdaDataset } from '../data/edaDemo.js'

export type MultivariateMethod = 'full' | 'correlation' | 'pca' | 'clustering'
export type MultivariateCorrelationMethod = 'pearson' | 'spearman'
export type MultivariateMissingPolicy = 'complete-case' | 'median-impute'
export type MultivariateScaling = 'standard' | 'robust' | 'none'

export interface MultivariateConfiguration {
  activeFilterKeys: string[]
  clusterCount: number
  correlationMethod: MultivariateCorrelationMethod
  datasetId: string
  datasetName: string
  filterValues: Record<string, string>
  groupBy: string | null
  method: MultivariateMethod
  missingPolicy: MultivariateMissingPolicy
  scaling: MultivariateScaling
  snapshotAt: string
  supportLabel: string
  variableKeys: string[]
}

export interface MultivariateInputRow {
  depthFrom?: number
  depthTo?: number
  dimensions?: Record<string, string>
  group: string
  holeId?: string
  observationId: string
  sourceDatasetIds?: string[]
  sourceObservationIds: string[]
  values: Record<string, number | null>
}

export interface MultivariateRunRequest {
  configuration: MultivariateConfiguration
  configurationSignature: string
  requestedAt: string
  rows: MultivariateInputRow[]
  runId: string
  runNumber: number
}

export interface MultivariateCorrelationResult {
  counts: number[][]
  pearson: Array<Array<number | null>>
  spearman: Array<Array<number | null>>
}

export interface MultivariatePcaResult {
  componentCount: number
  cumulativeVarianceRatio: number[]
  eigenvalues: number[]
  explainedVarianceRatio: number[]
  loadings: number[][]
}

export interface MultivariateClusterResult {
  centroids: number[][]
  clusterCount: number
  counts: number[]
  inertia: number
  requestedClusterCount: number
}

export interface MultivariateResultRow extends MultivariateInputRow {
  cluster: number
  clusterDistance?: number
  imputed: boolean
  membershipStrength?: number
  scores: number[]
}

export interface MultivariateGroupComparison {
  clusterCounts: number[]
  count: number
  group: string
  scoreMeans: number[]
}

export interface MultivariateRunResult {
  completedAt: string
  configuration: MultivariateConfiguration
  configurationSignature: string
  correlation: MultivariateCorrelationResult
  groupComparison: MultivariateGroupComparison[]
  missing: {
    analysisCount: number
    completeCount: number
    excludedOrImputedCount: number
    inputCount: number
    policy: MultivariateMissingPolicy
  }
  pca: MultivariatePcaResult
  clustering: MultivariateClusterResult
  provenance: {
    algorithmVersion: string
    engine: 'GeoEye MultivariateEngine'
    randomSeed: number
  }
  requestedAt: string
  rows: MultivariateResultRow[]
  runId: string
  runNumber: number
  scaling: {
    centers: number[]
    method: MultivariateScaling
    scales: number[]
  }
}

export const MULTIVARIATE_ALGORITHM_VERSION = 'geoeye-multivariate-1.0.0'
export const MULTIVARIATE_RANDOM_SEED = 20_261_001

export function multivariateConfigurationSignature(configuration: MultivariateConfiguration) {
  return JSON.stringify({
    ...configuration,
    activeFilterKeys: [...configuration.activeFilterKeys].sort(),
    filterValues: Object.fromEntries(Object.entries(configuration.filterValues).sort(([left], [right]) => left.localeCompare(right))),
    variableKeys: [...configuration.variableKeys].sort(),
  })
}

export function buildMultivariateRunRequest(
  configuration: MultivariateConfiguration,
  dataset: EdaDataset,
  runNumber: number,
  now = new Date(),
): MultivariateRunRequest {
  const rows = dataset.observations
    .filter((observation) => configuration.activeFilterKeys.every((key) => {
      const selected = configuration.filterValues[key]
      return selected === undefined || selected === 'all' || observation.dimensions[key] === selected
    }))
    .map((observation): MultivariateInputRow => ({
      depthFrom: observation.depthFrom,
      depthTo: observation.depthTo,
      dimensions: { ...observation.dimensions },
      group: configuration.groupBy === null ? 'All observations' : observation.dimensions[configuration.groupBy] ?? 'Unassigned',
      holeId: observation.holeId,
      observationId: observation.id,
      sourceDatasetIds: 'analyticalLineage' in observation && Array.isArray(observation.analyticalLineage)
        ? [...new Set(observation.analyticalLineage.map((entry) => entry.datasetId))]
        : [configuration.datasetId],
      sourceObservationIds: [...new Set(observation.sourceObservationIds ?? [observation.sourceObservationId])],
      values: Object.fromEntries(configuration.variableKeys.map((key) => [key, observation.values[key] ?? null])),
    }))
  return {
    configuration,
    configurationSignature: multivariateConfigurationSignature(configuration),
    requestedAt: now.toISOString(),
    rows,
    runId: `multivariate-run-${now.getTime()}-${runNumber}`,
    runNumber,
  }
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function quantile(values: readonly number[], probability: number) {
  const sorted = [...values].sort((left, right) => left - right)
  if (sorted.length === 1) return sorted[0] ?? 0
  const index = (sorted.length - 1) * probability
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return (sorted[lower] ?? 0) + ((sorted[upper] ?? 0) - (sorted[lower] ?? 0)) * (index - lower)
}

function standardDeviation(values: readonly number[]) {
  if (values.length < 1) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length)
}

function pearson(left: readonly number[], right: readonly number[]): number | null {
  if (left.length < 2 || left.length !== right.length) return null
  const leftMean = mean(left)
  const rightMean = mean(right)
  let numerator = 0
  let leftSquare = 0
  let rightSquare = 0
  left.forEach((value, index) => {
    const leftDelta = value - leftMean
    const rightDelta = (right[index] ?? 0) - rightMean
    numerator += leftDelta * rightDelta
    leftSquare += leftDelta ** 2
    rightSquare += rightDelta ** 2
  })
  const denominator = Math.sqrt(leftSquare * rightSquare)
  return denominator === 0 ? null : numerator / denominator
}

function ranks(values: readonly number[]) {
  const ordered = values.map((value, index) => ({ index, value })).sort((left, right) => left.value - right.value)
  const result = Array<number>(values.length)
  let start = 0
  while (start < ordered.length) {
    let end = start + 1
    while (end < ordered.length && ordered[end]?.value === ordered[start]?.value) end += 1
    const rank = (start + end - 1) / 2 + 1
    for (let index = start; index < end; index += 1) {
      const originalIndex = ordered[index]?.index
      if (originalIndex !== undefined) result[originalIndex] = rank
    }
    start = end
  }
  return result
}

function correlation(rows: readonly MultivariateInputRow[], variables: readonly string[]): MultivariateCorrelationResult {
  const counts: number[][] = []
  const pearsonMatrix: Array<Array<number | null>> = []
  const spearmanMatrix: Array<Array<number | null>> = []
  variables.forEach((left) => {
    const countRow: number[] = []
    const pearsonRow: Array<number | null> = []
    const spearmanRow: Array<number | null> = []
    variables.forEach((right) => {
      const pairs = rows.flatMap((row) => {
        const leftValue = row.values[left]
        const rightValue = row.values[right]
        return typeof leftValue === 'number' && Number.isFinite(leftValue) && typeof rightValue === 'number' && Number.isFinite(rightValue)
          ? [[leftValue, rightValue] as const]
          : []
      })
      const leftValues = pairs.map((pair) => pair[0])
      const rightValues = pairs.map((pair) => pair[1])
      countRow.push(pairs.length)
      pearsonRow.push(pearson(leftValues, rightValues))
      spearmanRow.push(pearson(ranks(leftValues), ranks(rightValues)))
    })
    counts.push(countRow)
    pearsonMatrix.push(pearsonRow)
    spearmanMatrix.push(spearmanRow)
  })
  return { counts, pearson: pearsonMatrix, spearman: spearmanMatrix }
}

interface PreparedMatrix {
  centers: number[]
  completeCount: number
  imputed: boolean[]
  matrix: number[][]
  rows: MultivariateInputRow[]
  scales: number[]
}

function prepareMatrix(request: MultivariateRunRequest): PreparedMatrix {
  const { missingPolicy, scaling, variableKeys } = request.configuration
  const completeCount = request.rows.filter((row) => variableKeys.every((key) => typeof row.values[key] === 'number' && Number.isFinite(row.values[key]))).length
  const medians = variableKeys.map((key) => {
    const values = request.rows.flatMap((row) => typeof row.values[key] === 'number' && Number.isFinite(row.values[key]) ? [row.values[key] as number] : [])
    if (values.length === 0) throw new Error(`${key} has no finite values`)
    return quantile(values, 0.5)
  })
  const prepared = request.rows.flatMap((row) => {
    const raw = variableKeys.map((key) => row.values[key])
    const hasMissing = raw.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    if (missingPolicy === 'complete-case' && hasMissing) return []
    return [{
      imputed: hasMissing,
      row,
      values: raw.map((value, index) => typeof value === 'number' && Number.isFinite(value) ? value : medians[index] ?? 0),
    }]
  })
  if (prepared.length < 2) throw new Error('Fewer than two rows remain after applying the missing-data policy')
  const columns = variableKeys.map((_, index) => prepared.map((item) => item.values[index] ?? 0))
  const centers = columns.map((column) => scaling === 'robust' ? quantile(column, 0.5) : scaling === 'standard' ? mean(column) : 0)
  const scales = columns.map((column) => {
    if (scaling === 'none') return 1
    const value = scaling === 'robust' ? quantile(column, 0.75) - quantile(column, 0.25) : standardDeviation(column)
    return value === 0 || !Number.isFinite(value) ? 1 : value
  })
  return {
    centers,
    completeCount,
    imputed: prepared.map((item) => item.imputed),
    matrix: prepared.map((item) => item.values.map((value, index) => (value - (centers[index] ?? 0)) / (scales[index] ?? 1))),
    rows: prepared.map((item) => item.row),
    scales,
  }
}

function identity(size: number): number[][] {
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (__, column) => row === column ? 1 : 0))
}

function jacobiEigen(matrix: number[][]) {
  const size = matrix.length
  const values = matrix.map((row) => [...row])
  const vectors = identity(size)
  for (let iteration = 0; iteration < size * size * 40; iteration += 1) {
    let pivotRow = 0
    let pivotColumn = Math.min(1, size - 1)
    let maximum = 0
    for (let row = 0; row < size; row += 1) {
      for (let column = row + 1; column < size; column += 1) {
        const candidate = Math.abs(values[row]?.[column] ?? 0)
        if (candidate > maximum) { maximum = candidate; pivotRow = row; pivotColumn = column }
      }
    }
    if (maximum < 1e-12) break
    const app = values[pivotRow]?.[pivotRow] ?? 0
    const aqq = values[pivotColumn]?.[pivotColumn] ?? 0
    const apq = values[pivotRow]?.[pivotColumn] ?? 0
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app)
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    for (let index = 0; index < size; index += 1) {
      if (index === pivotRow || index === pivotColumn) continue
      const aip = values[index]?.[pivotRow] ?? 0
      const aiq = values[index]?.[pivotColumn] ?? 0
      if (values[index] !== undefined) {
        values[index]![pivotRow] = cosine * aip - sine * aiq
        values[index]![pivotColumn] = sine * aip + cosine * aiq
      }
      if (values[pivotRow] !== undefined) values[pivotRow]![index] = values[index]?.[pivotRow] ?? 0
      if (values[pivotColumn] !== undefined) values[pivotColumn]![index] = values[index]?.[pivotColumn] ?? 0
    }
    if (values[pivotRow] !== undefined && values[pivotColumn] !== undefined) {
      values[pivotRow]![pivotRow] = cosine ** 2 * app - 2 * sine * cosine * apq + sine ** 2 * aqq
      values[pivotColumn]![pivotColumn] = sine ** 2 * app + 2 * sine * cosine * apq + cosine ** 2 * aqq
      values[pivotRow]![pivotColumn] = 0
      values[pivotColumn]![pivotRow] = 0
    }
    for (let index = 0; index < size; index += 1) {
      const vip = vectors[index]?.[pivotRow] ?? 0
      const viq = vectors[index]?.[pivotColumn] ?? 0
      if (vectors[index] !== undefined) {
        vectors[index]![pivotRow] = cosine * vip - sine * viq
        vectors[index]![pivotColumn] = sine * vip + cosine * viq
      }
    }
  }
  const ordered = Array.from({ length: size }, (_, index) => ({ index, value: Math.max(0, values[index]?.[index] ?? 0) }))
    .sort((left, right) => right.value - left.value)
  return {
    eigenvalues: ordered.map((item) => item.value),
    eigenvectors: Array.from({ length: size }, (_, row) => ordered.map((item) => vectors[row]?.[item.index] ?? 0)),
  }
}

function calculatePca(matrix: number[][]): { pca: MultivariatePcaResult; scores: number[][] } {
  const rowCount = matrix.length
  const variableCount = matrix[0]?.length ?? 0
  const columnMeans = Array.from({ length: variableCount }, (_, column) => mean(matrix.map((row) => row[column] ?? 0)))
  const centered = matrix.map((row) => row.map((value, column) => value - (columnMeans[column] ?? 0)))
  const covariance = Array.from({ length: variableCount }, (_, left) => Array.from({ length: variableCount }, (__, right) => (
    centered.reduce((sum, row) => sum + (row[left] ?? 0) * (row[right] ?? 0), 0) / Math.max(1, rowCount - 1)
  )))
  const eigen = jacobiEigen(covariance)
  const componentCount = Math.min(variableCount, rowCount)
  const eigenvalues = eigen.eigenvalues.slice(0, componentCount)
  const eigenvectors = eigen.eigenvectors.map((row) => row.slice(0, componentCount))
  const total = eigenvalues.reduce((sum, value) => sum + value, 0)
  const explainedVarianceRatio = eigenvalues.map((value) => total === 0 ? 0 : value / total)
  let cumulative = 0
  const cumulativeVarianceRatio = explainedVarianceRatio.map((value) => { cumulative += value; return cumulative })
  const scores = centered.map((row) => eigenvalues.map((_, component) => row.reduce((sum, value, variable) => sum + value * (eigenvectors[variable]?.[component] ?? 0), 0)))
  return {
    pca: {
      componentCount,
      cumulativeVarianceRatio,
      eigenvalues,
      explainedVarianceRatio,
      loadings: eigenvectors,
    },
    scores,
  }
}

function squaredDistance(left: readonly number[], right: readonly number[]) {
  return left.reduce((sum, value, index) => sum + (value - (right[index] ?? 0)) ** 2, 0)
}

function clusterMembership(matrix: readonly number[][], centroids: readonly number[][], memberships: readonly number[]) {
  return matrix.map((row, rowIndex) => {
    const clusterIndex = memberships[rowIndex] ?? 0
    const ownDistance = Math.sqrt(squaredDistance(row, centroids[clusterIndex] ?? []))
    const alternativeDistances = centroids
      .filter((_, index) => index !== clusterIndex)
      .map((centroid) => Math.sqrt(squaredDistance(row, centroid)))
    const nearestAlternative = alternativeDistances.length === 0 ? ownDistance : Math.min(...alternativeDistances)
    const denominator = ownDistance + nearestAlternative
    return {
      distance: ownDistance,
      strength: denominator === 0 ? 1 : Math.max(0, Math.min(1, nearestAlternative / denominator)),
    }
  })
}

function calculateKMeans(matrix: number[][], requestedCount: number) {
  const clusterCount = Math.max(1, Math.min(requestedCount, matrix.length))
  const centroids: number[][] = [[...(matrix[MULTIVARIATE_RANDOM_SEED % matrix.length] ?? matrix[0] ?? [])]]
  while (centroids.length < clusterCount) {
    const next = matrix.reduce((best, row, index) => {
      const distance = Math.min(...centroids.map((centroid) => squaredDistance(row, centroid)))
      return distance > best.distance ? { distance, index } : best
    }, { distance: -1, index: 0 })
    centroids.push([...(matrix[next.index] ?? matrix[0] ?? [])])
  }
  let memberships = Array(matrix.length).fill(0) as number[]
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const nextMemberships = matrix.map((row) => centroids.reduce((best, centroid, index) => {
      const distance = squaredDistance(row, centroid)
      return distance < best.distance ? { distance, index } : best
    }, { distance: Number.POSITIVE_INFINITY, index: 0 }).index)
    const changed = nextMemberships.some((value, index) => value !== memberships[index])
    memberships = nextMemberships
    for (let cluster = 0; cluster < clusterCount; cluster += 1) {
      const members = matrix.filter((_, index) => memberships[index] === cluster)
      if (members.length === 0) continue
      centroids[cluster] = Array.from({ length: matrix[0]?.length ?? 0 }, (_, column) => mean(members.map((row) => row[column] ?? 0)))
    }
    if (!changed && iteration > 0) break
  }
  const ordering = centroids.map((centroid, index) => ({ index, value: centroid[0] ?? 0 })).sort((left, right) => left.value - right.value)
  const displayIndex = new Map(ordering.map((item, index) => [item.index, index]))
  const orderedMemberships = memberships.map((cluster) => displayIndex.get(cluster) ?? cluster)
  const orderedCentroids = ordering.map((item) => centroids[item.index] ?? [])
  const counts = Array.from({ length: clusterCount }, (_, cluster) => orderedMemberships.filter((value) => value === cluster).length)
  const inertia = matrix.reduce((sum, row, index) => sum + squaredDistance(row, orderedCentroids[orderedMemberships[index] ?? 0] ?? []), 0)
  return { centroids: orderedCentroids, clusterCount, counts, inertia, memberships: orderedMemberships, requestedClusterCount: requestedCount }
}

export class GeoEyeMultivariateEngine {
  readonly algorithmVersion = MULTIVARIATE_ALGORITHM_VERSION

  run(request: MultivariateRunRequest, completedAt = new Date()): MultivariateRunResult {
    if (request.configuration.variableKeys.length < 2) throw new Error('Select at least two numeric variables')
    if (request.rows.length < 2) throw new Error('Fewer than two observations match the current filters')
    const pairwise = correlation(request.rows, request.configuration.variableKeys)
    const prepared = prepareMatrix(request)
    const { pca, scores } = calculatePca(prepared.matrix)
    const clusters = calculateKMeans(prepared.matrix, request.configuration.clusterCount)
    const membership = clusterMembership(prepared.matrix, clusters.centroids, clusters.memberships)
    const rows = prepared.rows.map((row, index): MultivariateResultRow => ({
      ...row,
      cluster: (clusters.memberships[index] ?? 0) + 1,
      clusterDistance: membership[index]?.distance ?? 0,
      imputed: prepared.imputed[index] ?? false,
      membershipStrength: membership[index]?.strength ?? 1,
      scores: scores[index] ?? [],
    }))
    const groups = Array.from(new Set(rows.map((row) => row.group))).sort()
    const groupComparison = groups.map((group): MultivariateGroupComparison => {
      const members = rows.filter((row) => row.group === group)
      return {
        clusterCounts: Array.from({ length: clusters.clusterCount }, (_, cluster) => members.filter((row) => row.cluster === cluster + 1).length),
        count: members.length,
        group,
        scoreMeans: Array.from({ length: pca.componentCount }, (_, component) => mean(members.map((row) => row.scores[component] ?? 0))),
      }
    })
    return {
      clustering: {
        centroids: clusters.centroids,
        clusterCount: clusters.clusterCount,
        counts: clusters.counts,
        inertia: clusters.inertia,
        requestedClusterCount: clusters.requestedClusterCount,
      },
      completedAt: completedAt.toISOString(),
      configuration: request.configuration,
      configurationSignature: request.configurationSignature,
      correlation: pairwise,
      groupComparison,
      missing: {
        analysisCount: rows.length,
        completeCount: prepared.completeCount,
        excludedOrImputedCount: request.rows.length - prepared.completeCount,
        inputCount: request.rows.length,
        policy: request.configuration.missingPolicy,
      },
      pca,
      provenance: { algorithmVersion: this.algorithmVersion, engine: 'GeoEye MultivariateEngine', randomSeed: MULTIVARIATE_RANDOM_SEED },
      requestedAt: request.requestedAt,
      rows,
      runId: request.runId,
      runNumber: request.runNumber,
      scaling: { centers: prepared.centers, method: request.configuration.scaling, scales: prepared.scales },
    }
  }
}

export function calculateMultivariateRun(request: MultivariateRunRequest, completedAt = new Date()) {
  return new GeoEyeMultivariateEngine().run(request, completedAt)
}
