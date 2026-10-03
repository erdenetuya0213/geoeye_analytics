export type WeightingMethod = 'equal-hole' | 'cell-declustering' | 'interval-support'
export type BootstrapMethod = 'hole' | 'group' | 'spatial'

export interface DistributionObservation {
  groupId: string
  holeId: string
  sourceObservationId: string
  support: number
  value: number
  x: number
  y: number
  z: number
}

export interface DistributionRequest {
  algorithmVersion: 'geoeye-distribution-1.0.0'
  bootstrap: {
    blockSize: number
    iterations: number
    method: BootstrapMethod
    seed: number
  }
  datasetId: string
  filterSignature: string
  missingCount: number
  observations: DistributionObservation[]
  snapshotAt: string
  supportLabel: string
  variableKey: string
  weighting: {
    cellSize: number
    method: WeightingMethod
  }
}

export interface DistributionSummaryResult {
  coefficientOfVariation: number | null
  count: number
  effectiveCount: number
  maximum: number
  mean: number
  median: number
  minimum: number
  missing: number
  p95: number
  q1: number
  q3: number
  standardDeviation: number
  variance: number
  weightSum: number
}

export interface DistributionCurvePoint {
  probability: number
  sourceObservationId: string
  value: number
  weight: number
}

export interface DistributionProbabilityPoint extends DistributionCurvePoint {
  expectedQuantile: number
}

export interface DistributionHistogramBin {
  from: number
  midpoint: number
  rawCount: number
  representativeCount: number
  sourceObservationIds: string[]
  to: number
}

export interface BootstrapInterval {
  estimate: number
  lower: number
  upper: number
}

export interface DistributionResult {
  diagnostics: {
    normalProbabilityRSquared: number | null
    normalProbabilityRSquaredRole: 'secondary diagnostic; not probability or confidence'
    weightedPlottingPosition: 'centered-cumulative-weight'
    weightedVarianceEstimator: 'frequency-unbiased'
  }
  histogram: DistributionHistogramBin[]
  provenance: {
    algorithmVersion: string
    bootstrapMethod: BootstrapMethod
    datasetId: string
    filterSignature: string
    snapshotAt: string
    supportLabel: string
    variableKey: string
    weightingMethod: WeightingMethod
  }
  representative: {
    ecdf: DistributionCurvePoint[]
    probabilityPlot: DistributionProbabilityPoint[]
    summary: DistributionSummaryResult
  }
  sample: {
    ecdf: DistributionCurvePoint[]
    probabilityPlot: DistributionProbabilityPoint[]
    summary: DistributionSummaryResult
  }
  uncertainty: {
    band: Array<{ lower: number; upper: number; value: number }>
    intervals: {
      mean: BootstrapInterval
      median: BootstrapInterval
      p95: BootstrapInterval
    }
    iterations: number
    method: BootstrapMethod
    resamplingUnits: number
    seed: number
  }
}

function quantile(sortedValues: readonly number[], probability: number) {
  if (sortedValues.length === 1) return sortedValues[0] ?? 0
  const index = (sortedValues.length - 1) * Math.max(0, Math.min(1, probability))
  const lower = sortedValues[Math.floor(index)] ?? 0
  const upper = sortedValues[Math.ceil(index)] ?? lower
  return lower + (upper - lower) * (index - Math.floor(index))
}

function weightedQuantile(sorted: readonly DistributionObservation[], weights: readonly number[], probability: number) {
  if (sorted.length === 1) return sorted[0]?.value ?? 0
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const positions: number[] = []
  let cumulative = 0
  weights.forEach((weight) => {
    cumulative += weight
    positions.push((cumulative - 0.5 * weight) / total)
  })
  const bounded = Math.max(0, Math.min(1, probability))
  if (bounded <= (positions[0] ?? 0)) return sorted[0]?.value ?? 0
  const finalPosition = positions.at(-1) ?? 1
  if (bounded >= finalPosition) return sorted.at(-1)?.value ?? 0
  const upperIndex = positions.findIndex((position) => position >= bounded)
  const lowerIndex = Math.max(0, upperIndex - 1)
  const lowerPosition = positions[lowerIndex] ?? 0
  const upperPosition = positions[upperIndex] ?? lowerPosition
  const lowerValue = sorted[lowerIndex]?.value ?? 0
  const upperValue = sorted[upperIndex]?.value ?? lowerValue
  const fraction = upperPosition === lowerPosition ? 0 : (bounded - lowerPosition) / (upperPosition - lowerPosition)
  return lowerValue + (upperValue - lowerValue) * fraction
}

function summarize(observations: readonly DistributionObservation[], weights: readonly number[], missing: number): DistributionSummaryResult {
  const ordered = observations.map((observation, index) => ({ observation, weight: weights[index] ?? 0 }))
    .sort((left, right) => left.observation.value - right.observation.value)
  const sorted = ordered.map((item) => item.observation)
  const sortedWeights = ordered.map((item) => item.weight)
  const weightSum = sortedWeights.reduce((sum, weight) => sum + weight, 0)
  const weightSquareSum = sortedWeights.reduce((sum, weight) => sum + weight ** 2, 0)
  const mean = ordered.reduce((sum, item) => sum + item.observation.value * item.weight, 0) / weightSum
  const varianceNumerator = ordered.reduce((sum, item) => sum + item.weight * (item.observation.value - mean) ** 2, 0)
  const varianceDenominator = weightSum - weightSquareSum / weightSum
  const variance = varianceDenominator > 0 ? varianceNumerator / varianceDenominator : 0
  const standardDeviation = Math.sqrt(variance)
  return {
    coefficientOfVariation: mean === 0 ? null : standardDeviation / Math.abs(mean),
    count: sorted.length,
    effectiveCount: weightSum ** 2 / weightSquareSum,
    maximum: sorted.at(-1)?.value ?? 0,
    mean,
    median: weightedQuantile(sorted, sortedWeights, 0.5),
    minimum: sorted[0]?.value ?? 0,
    missing,
    p95: weightedQuantile(sorted, sortedWeights, 0.95),
    q1: weightedQuantile(sorted, sortedWeights, 0.25),
    q3: weightedQuantile(sorted, sortedWeights, 0.75),
    standardDeviation,
    variance,
    weightSum,
  }
}

function normalizedWeights(observations: readonly DistributionObservation[], request: DistributionRequest) {
  const holeCounts = new Map<string, number>()
  const cellCounts = new Map<string, number>()
  const cellFor = (observation: DistributionObservation) => `${Math.floor(observation.x / request.weighting.cellSize)}:${Math.floor(observation.y / request.weighting.cellSize)}`
  observations.forEach((observation) => {
    holeCounts.set(observation.holeId, (holeCounts.get(observation.holeId) ?? 0) + 1)
    const cell = cellFor(observation)
    cellCounts.set(cell, (cellCounts.get(cell) ?? 0) + 1)
  })
  const rawWeights = observations.map((observation) => {
    if (request.weighting.method === 'interval-support') return Math.max(Number.EPSILON, observation.support)
    if (request.weighting.method === 'cell-declustering') {
      return 1 / (cellCounts.get(cellFor(observation)) ?? 1)
    }
    return 1 / (holeCounts.get(observation.holeId) ?? 1)
  })
  const total = rawWeights.reduce((sum, weight) => sum + weight, 0)
  return rawWeights.map((weight) => weight * observations.length / total)
}

function ecdf(observations: readonly DistributionObservation[], weights: readonly number[]): DistributionCurvePoint[] {
  const ordered = observations.map((observation, index) => ({ observation, weight: weights[index] ?? 0 }))
    .sort((left, right) => left.observation.value - right.observation.value)
  const total = ordered.reduce((sum, item) => sum + item.weight, 0)
  let cumulative = 0
  return ordered.map((item) => {
    cumulative += item.weight
    return {
      probability: cumulative / total,
      sourceObservationId: item.observation.sourceObservationId,
      value: item.observation.value,
      weight: item.weight,
    }
  })
}

// Peter J. Acklam's rational inverse-normal approximation.
function inverseStandardNormal(probability: number) {
  const p = Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, probability))
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  }
  if (p > 0.97575) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  }
  const q = p - 0.5
  const r = q * q
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
}

function probabilityPlot(observations: readonly DistributionObservation[], weights: readonly number[]): DistributionProbabilityPoint[] {
  const ordered = observations.map((observation, index) => ({ observation, weight: weights[index] ?? 0 }))
    .sort((left, right) => left.observation.value - right.observation.value)
  const total = ordered.reduce((sum, item) => sum + item.weight, 0)
  let cumulative = 0
  return ordered.map((item) => {
    cumulative += item.weight
    const probability = (cumulative - 0.5 * item.weight) / total
    return {
      expectedQuantile: inverseStandardNormal(probability),
      probability,
      sourceObservationId: item.observation.sourceObservationId,
      value: item.observation.value,
      weight: item.weight,
    }
  })
}

function recommendedBinCount(values: readonly number[]) {
  if (values.length < 2) return 1
  const sorted = [...values].sort((left, right) => left - right)
  const range = (sorted.at(-1) ?? 0) - (sorted[0] ?? 0)
  if (range === 0) return 1
  const width = 2 * ((quantile(sorted, 0.75)) - quantile(sorted, 0.25)) / Math.cbrt(sorted.length)
  const fallback = Math.ceil(Math.log2(sorted.length) + 1)
  return Math.max(4, Math.min(32, width > 0 ? Math.ceil(range / width) : fallback))
}

function histogram(observations: readonly DistributionObservation[], representativeWeights: readonly number[]): DistributionHistogramBin[] {
  const values = observations.map((observation) => observation.value)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const binCount = recommendedBinCount(values)
  const width = maximum === minimum ? 1 : (maximum - minimum) / binCount
  const bins = Array.from({ length: binCount }, (_, index): DistributionHistogramBin => {
    const from = minimum + width * index
    const to = index === binCount - 1 ? maximum : from + width
    return { from, midpoint: (from + to) / 2, rawCount: 0, representativeCount: 0, sourceObservationIds: [], to }
  })
  observations.forEach((observation, observationIndex) => {
    const rawIndex = Math.floor((observation.value - minimum) / width)
    const index = Math.max(0, Math.min(binCount - 1, rawIndex))
    const bin = bins[index]
    if (bin !== undefined) {
      bin.rawCount += 1
      bin.representativeCount += representativeWeights[observationIndex] ?? 0
      bin.sourceObservationIds.push(observation.sourceObservationId)
    }
  })
  return bins
}

function linearRSquared(points: readonly DistributionProbabilityPoint[]) {
  if (points.length < 2) return null
  const xMean = points.reduce((sum, point) => sum + point.expectedQuantile, 0) / points.length
  const yMean = points.reduce((sum, point) => sum + point.value, 0) / points.length
  const covariance = points.reduce((sum, point) => sum + (point.expectedQuantile - xMean) * (point.value - yMean), 0)
  const xVariance = points.reduce((sum, point) => sum + (point.expectedQuantile - xMean) ** 2, 0)
  if (xVariance === 0) return null
  const slope = covariance / xVariance
  const intercept = yMean - slope * xMean
  const total = points.reduce((sum, point) => sum + (point.value - yMean) ** 2, 0)
  const residual = points.reduce((sum, point) => sum + (point.value - intercept - slope * point.expectedQuantile) ** 2, 0)
  return total === 0 ? 1 : Math.max(0, 1 - residual / total)
}

function randomGenerator(seed: number) {
  let state = seed >>> 0
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

function bootstrap(observations: readonly DistributionObservation[], weights: readonly number[], request: DistributionRequest) {
  const unitFor = (observation: DistributionObservation) => {
    if (request.bootstrap.method === 'hole') return observation.holeId
    if (request.bootstrap.method === 'group') return observation.groupId
    return `${Math.floor(observation.x / request.bootstrap.blockSize)}:${Math.floor(observation.y / request.bootstrap.blockSize)}:${Math.floor(observation.z / request.bootstrap.blockSize)}`
  }
  const unitKeys = [...new Set(observations.map(unitFor))]
  const representative = summarize(observations, weights, request.missingCount)
  const grid = Array.from({ length: 41 }, (_, index) => representative.minimum + (representative.maximum - representative.minimum) * index / 40)
  if (unitKeys.length < 2) {
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    return {
      band: grid.map((value) => {
        const estimate = observations.reduce((sum, observation, index) => observation.value <= value ? sum + (weights[index] ?? 0) : sum, 0) / total
        return { lower: estimate, upper: estimate, value }
      }),
      intervals: {
        mean: { estimate: representative.mean, lower: representative.mean, upper: representative.mean },
        median: { estimate: representative.median, lower: representative.median, upper: representative.median },
        p95: { estimate: representative.p95, lower: representative.p95, upper: representative.p95 },
      },
      iterations: 0,
      method: request.bootstrap.method,
      resamplingUnits: unitKeys.length,
      seed: request.bootstrap.seed,
    }
  }
  const byUnit = new Map(unitKeys.map((unit) => [unit, observations.map((observation, index) => ({ observation, index })).filter((item) => unitFor(item.observation) === unit)]))
  const replicates = { mean: [] as number[], median: [] as number[], p95: [] as number[], band: grid.map(() => [] as number[]) }
  const random = randomGenerator(request.bootstrap.seed)
  for (let iteration = 0; iteration < request.bootstrap.iterations; iteration += 1) {
    const sample = Array.from({ length: unitKeys.length }, () => unitKeys[Math.floor(random() * unitKeys.length)] ?? unitKeys[0]!)
      .flatMap((unit) => byUnit.get(unit) ?? [])
    const sampledObservations = sample.map((item) => item.observation)
    const sampledWeights = sample.map((item) => weights[item.index] ?? 0)
    const summary = summarize(sampledObservations, sampledWeights, 0)
    replicates.mean.push(summary.mean)
    replicates.median.push(summary.median)
    replicates.p95.push(summary.p95)
    const total = sampledWeights.reduce((sum, weight) => sum + weight, 0)
    grid.forEach((value, index) => {
      const cumulative = sampledObservations.reduce((sum, observation, observationIndex) => observation.value <= value ? sum + (sampledWeights[observationIndex] ?? 0) : sum, 0)
      replicates.band[index]?.push(cumulative / total)
    })
  }
  const interval = (values: number[], estimate: number): BootstrapInterval => {
    const sorted = values.sort((left, right) => left - right)
    return { estimate, lower: quantile(sorted, 0.025), upper: quantile(sorted, 0.975) }
  }
  return {
    band: grid.map((value, index) => {
      const values = (replicates.band[index] ?? []).sort((left, right) => left - right)
      return { lower: quantile(values, 0.025), upper: quantile(values, 0.975), value }
    }),
    intervals: {
      mean: interval(replicates.mean, representative.mean),
      median: interval(replicates.median, representative.median),
      p95: interval(replicates.p95, representative.p95),
    },
    iterations: request.bootstrap.iterations,
    method: request.bootstrap.method,
    resamplingUnits: unitKeys.length,
    seed: request.bootstrap.seed,
  }
}

export function calculateDistribution(request: DistributionRequest): DistributionResult {
  if (request.observations.length === 0) throw new Error('At least one finite observation is required')
  const sampleWeights = request.observations.map(() => 1)
  const representativeWeights = normalizedWeights(request.observations, request)
  const sampleProbabilityPlot = probabilityPlot(request.observations, sampleWeights)
  const representativeProbabilityPlot = probabilityPlot(request.observations, representativeWeights)
  return {
    diagnostics: {
      normalProbabilityRSquared: linearRSquared(representativeProbabilityPlot),
      normalProbabilityRSquaredRole: 'secondary diagnostic; not probability or confidence',
      weightedPlottingPosition: 'centered-cumulative-weight',
      weightedVarianceEstimator: 'frequency-unbiased',
    },
    histogram: histogram(request.observations, representativeWeights),
    provenance: {
      algorithmVersion: request.algorithmVersion,
      bootstrapMethod: request.bootstrap.method,
      datasetId: request.datasetId,
      filterSignature: request.filterSignature,
      snapshotAt: request.snapshotAt,
      supportLabel: request.supportLabel,
      variableKey: request.variableKey,
      weightingMethod: request.weighting.method,
    },
    representative: {
      ecdf: ecdf(request.observations, representativeWeights),
      probabilityPlot: representativeProbabilityPlot,
      summary: summarize(request.observations, representativeWeights, request.missingCount),
    },
    sample: {
      ecdf: ecdf(request.observations, sampleWeights),
      probabilityPlot: sampleProbabilityPlot,
      summary: summarize(request.observations, sampleWeights, request.missingCount),
    },
    uncertainty: bootstrap(request.observations, representativeWeights, request),
  }
}
