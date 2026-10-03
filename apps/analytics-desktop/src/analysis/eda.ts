export interface EdaObservation {
  depthFrom: number
  depthTo: number
  dimensions: Record<string, string>
  easting: number
  holeId: string
  id: string
  joinKey: string
  lithology: string
  northing: number
  sampleId: string
  sourceObservationId: string
  sourceObservationIds?: string[]
  values: Record<string, number | null>
}

export interface NumericSample {
  id: string
  value: number
}

export interface SummaryStatistics {
  coefficientOfVariation: number | null
  count: number
  maximum: number | null
  mean: number | null
  median: number | null
  minimum: number | null
  missing: number
  p95: number | null
  q1: number | null
  q3: number | null
  standardDeviation: number | null
}

export interface HistogramBin {
  count: number
  from: number
  ids: string[]
  midpoint: number
  to: number
}

export interface DistributionPoint extends NumericSample {
  probability: number
}

export interface ProbabilityPoint extends NumericSample {
  expectedQuantile: number
}

export interface RegressionLine {
  intercept: number
  rSquared: number
  slope: number
}

export type SwathAxis = 'depth' | 'easting' | 'northing'

export interface SwathBin {
  count: number
  from: number
  ids: string[]
  mean: number
  median: number
  midpoint: number
  to: number
}

export function finiteSamples(observations: readonly EdaObservation[], variableKey: string): NumericSample[] {
  return observations.flatMap((observation) => {
    const value = observation.values[variableKey]
    return typeof value === 'number' && Number.isFinite(value) ? [{ id: observation.sourceObservationId, value }] : []
  })
}

export function quantile(sortedValues: readonly number[], probability: number): number | null {
  if (sortedValues.length === 0) return null
  if (sortedValues.length === 1) return sortedValues[0] ?? null
  const bounded = Math.max(0, Math.min(1, probability))
  const index = (sortedValues.length - 1) * bounded
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)
  const lower = sortedValues[lowerIndex]
  const upper = sortedValues[upperIndex]
  if (lower === undefined || upper === undefined) return null
  return lower + (upper - lower) * (index - lowerIndex)
}

export function summarizeValues(values: readonly number[], total = values.length): SummaryStatistics {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
  const count = sorted.length
  if (count === 0) {
    return {
      coefficientOfVariation: null,
      count: 0,
      maximum: null,
      mean: null,
      median: null,
      minimum: null,
      missing: Math.max(0, total),
      p95: null,
      q1: null,
      q3: null,
      standardDeviation: null,
    }
  }

  const mean = sorted.reduce((sum, value) => sum + value, 0) / count
  const variance = count > 1
    ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1)
    : 0
  const standardDeviation = Math.sqrt(variance)

  return {
    coefficientOfVariation: mean === 0 ? null : standardDeviation / Math.abs(mean),
    count,
    maximum: sorted[count - 1] ?? null,
    mean,
    median: quantile(sorted, 0.5),
    minimum: sorted[0] ?? null,
    missing: Math.max(0, total - count),
    p95: quantile(sorted, 0.95),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    standardDeviation,
  }
}

export function summarizeVariable(observations: readonly EdaObservation[], variableKey: string): SummaryStatistics {
  return summarizeValues(finiteSamples(observations, variableKey).map((sample) => sample.value), observations.length)
}

function recommendedBinCount(values: readonly number[]): number {
  if (values.length < 2) return 1
  const sorted = [...values].sort((left, right) => left - right)
  const minimum = sorted[0] ?? 0
  const maximum = sorted[sorted.length - 1] ?? minimum
  const range = maximum - minimum
  if (range === 0) return 1
  const q1 = quantile(sorted, 0.25) ?? minimum
  const q3 = quantile(sorted, 0.75) ?? maximum
  const freedmanDiaconisWidth = 2 * (q3 - q1) / Math.cbrt(sorted.length)
  const fallback = Math.ceil(Math.log2(sorted.length) + 1)
  const count = freedmanDiaconisWidth > 0 ? Math.ceil(range / freedmanDiaconisWidth) : fallback
  return Math.max(4, Math.min(32, count))
}

export function buildHistogram(samples: readonly NumericSample[], requestedBinCount?: number): HistogramBin[] {
  if (samples.length === 0) return []
  const values = samples.map((sample) => sample.value)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const binCount = Math.max(1, Math.floor(requestedBinCount ?? recommendedBinCount(values)))
  const width = maximum === minimum ? 1 : (maximum - minimum) / binCount
  const bins = Array.from({ length: binCount }, (_, index): HistogramBin => {
    const from = minimum + width * index
    const to = index === binCount - 1 ? maximum : from + width
    return { count: 0, from, ids: [], midpoint: (from + to) / 2, to }
  })

  for (const sample of samples) {
    const rawIndex = width === 0 ? 0 : Math.floor((sample.value - minimum) / width)
    const index = Math.max(0, Math.min(binCount - 1, rawIndex))
    const bin = bins[index]
    if (bin !== undefined) {
      bin.count += 1
      bin.ids.push(sample.id)
    }
  }
  return bins
}

export function buildCdf(samples: readonly NumericSample[]): DistributionPoint[] {
  const sorted = [...samples].sort((left, right) => left.value - right.value)
  return sorted.map((sample, index) => ({ ...sample, probability: (index + 1) / sorted.length }))
}

// Peter J. Acklam's rational approximation of the inverse standard-normal CDF.
export function inverseStandardNormal(probability: number): number {
  const p = Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, probability))
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  const high = 1 - low

  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  }
  if (p > high) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  }
  const q = p - 0.5
  const r = q * q
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
}

export function buildProbabilityPlot(samples: readonly NumericSample[]): ProbabilityPoint[] {
  const sorted = [...samples].sort((left, right) => left.value - right.value)
  return sorted.map((sample, index) => ({
    ...sample,
    expectedQuantile: inverseStandardNormal((index + 0.625) / (sorted.length + 0.25)),
  }))
}

export function linearRegression(points: readonly { x: number; y: number }[]): RegressionLine | null {
  if (points.length < 2) return null
  const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length
  const covariance = points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0)
  const xVariance = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0)
  if (xVariance === 0) return null
  const slope = covariance / xVariance
  const intercept = yMean - slope * xMean
  const totalSumSquares = points.reduce((sum, point) => sum + (point.y - yMean) ** 2, 0)
  const residualSumSquares = points.reduce((sum, point) => sum + (point.y - (intercept + slope * point.x)) ** 2, 0)
  return {
    intercept,
    rSquared: totalSumSquares === 0 ? 1 : Math.max(0, 1 - residualSumSquares / totalSumSquares),
    slope,
  }
}

export function pearsonCorrelation(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
  const covariance = left.reduce((sum, value, index) => sum + (value - leftMean) * ((right[index] ?? rightMean) - rightMean), 0)
  const leftScale = Math.sqrt(left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0))
  const rightScale = Math.sqrt(right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0))
  if (leftScale === 0 || rightScale === 0) return null
  return covariance / (leftScale * rightScale)
}

function averageRanks(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ index, value })).sort((left, right) => left.value - right.value)
  const ranks = Array.from({ length: values.length }, () => 0)
  let start = 0
  while (start < indexed.length) {
    let end = start + 1
    while (end < indexed.length && indexed[end]?.value === indexed[start]?.value) end += 1
    const averageRank = (start + 1 + end) / 2
    for (let index = start; index < end; index += 1) ranks[indexed[index]!.index] = averageRank
    start = end
  }
  return ranks
}

export function spearmanCorrelation(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null
  return pearsonCorrelation(averageRanks(left), averageRanks(right))
}

export function pairedSamples(
  observations: readonly EdaObservation[],
  leftKey: string,
  rightKey: string,
): Array<{ id: string; x: number; y: number }> {
  return observations.flatMap((observation) => {
    const x = observation.values[leftKey]
    const y = observation.values[rightKey]
    return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
      ? [{ id: observation.sourceObservationId, x, y }]
      : []
  })
}

export interface JoinedPair {
  id: string
  joinKey: string
  sourceObservationIds: string[]
  x: number
  y: number
}

/**
 * Joins variables from independently sourced datasets by their canonical
 * interval key. Lineage for both axes is retained for cross-view selection.
 */
export function pairedDatasetSamples(
  leftObservations: readonly EdaObservation[],
  rightObservations: readonly EdaObservation[],
  leftKey: string,
  rightKey: string,
): JoinedPair[] {
  return leftObservations.flatMap((leftObservation) => {
    const rightObservation = rightObservations
      .filter((candidate) => candidate.holeId === leftObservation.holeId)
      .map((candidate) => ({
        candidate,
        overlap: Math.max(0, Math.min(leftObservation.depthTo, candidate.depthTo) - Math.max(leftObservation.depthFrom, candidate.depthFrom)),
      }))
      .filter((match) => match.overlap > 0 || (
        match.candidate.depthFrom === match.candidate.depthTo
        && match.candidate.depthFrom >= leftObservation.depthFrom
        && match.candidate.depthFrom <= leftObservation.depthTo
      ))
      .sort((left, right) => right.overlap - left.overlap)[0]?.candidate
    if (rightObservation === undefined) return []
    const x = leftObservation.values[leftKey]
    const y = rightObservation.values[rightKey]
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return []
    const sourceObservationIds = Array.from(new Set([
      ...(leftObservation.sourceObservationIds ?? [leftObservation.sourceObservationId]),
      ...(rightObservation.sourceObservationIds ?? [rightObservation.sourceObservationId]),
    ]))
    return [{
      id: sourceObservationIds.join('|'),
      joinKey: leftObservation.joinKey,
      sourceObservationIds,
      x,
      y,
    }]
  })
}

export function correlationMatrix(observations: readonly EdaObservation[], variableKeys: readonly string[]): Array<Array<number | null>> {
  return variableKeys.map((leftKey) => variableKeys.map((rightKey) => {
    if (leftKey === rightKey) return finiteSamples(observations, leftKey).length > 0 ? 1 : null
    const pairs = pairedSamples(observations, leftKey, rightKey)
    return pearsonCorrelation(pairs.map((pair) => pair.x), pairs.map((pair) => pair.y))
  }))
}

function axisValue(observation: EdaObservation, axis: SwathAxis): number {
  if (axis === 'depth') return (observation.depthFrom + observation.depthTo) / 2
  return observation[axis]
}

export function buildSwath(
  observations: readonly EdaObservation[],
  variableKey: string,
  axis: SwathAxis,
  requestedBinCount = 8,
): SwathBin[] {
  const samples = observations.flatMap((observation) => {
    const value = observation.values[variableKey]
    return typeof value === 'number' && Number.isFinite(value)
      ? [{ axis: axisValue(observation, axis), id: observation.sourceObservationId, value }]
      : []
  })
  if (samples.length === 0) return []
  const minimum = Math.min(...samples.map((sample) => sample.axis))
  const maximum = Math.max(...samples.map((sample) => sample.axis))
  const binCount = Math.max(1, Math.min(requestedBinCount, new Set(samples.map((sample) => sample.axis)).size))
  const width = maximum === minimum ? 1 : (maximum - minimum) / binCount
  const valuesByBin = Array.from({ length: binCount }, () => [] as Array<{ id: string; value: number }>)
  for (const sample of samples) {
    const rawIndex = Math.floor((sample.axis - minimum) / width)
    const index = Math.max(0, Math.min(binCount - 1, rawIndex))
    valuesByBin[index]?.push({ id: sample.id, value: sample.value })
  }
  return valuesByBin.map((samplesInBin, index) => {
    const from = minimum + width * index
    const to = index === binCount - 1 ? maximum : from + width
    const statistics = summarizeValues(samplesInBin.map((sample) => sample.value))
    return {
      count: samplesInBin.length,
      from,
      ids: samplesInBin.map((sample) => sample.id),
      mean: statistics.mean ?? 0,
      median: statistics.median ?? 0,
      midpoint: (from + to) / 2,
      to,
    }
  }).filter((bin) => bin.count > 0)
}
