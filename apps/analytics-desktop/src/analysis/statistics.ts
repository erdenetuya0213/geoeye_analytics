/**
 * Shape and log statistics shared by the unweighted EDA summary and the weighted DistributionEngine
 * summary, so a stats box reports the same numbers wherever it is drawn.
 */
export interface ShapeStatistics {
  /** Exponential of the weighted mean of ln(value); positive values only. */
  geometricMean: number | null
  /** Excess kurtosis: 0 for a normal distribution, not 3. */
  kurtosis: number | null
  logMean: number | null
  logVariance: number | null
  skewness: number | null
}

const EMPTY: ShapeStatistics = {
  geometricMean: null,
  kurtosis: null,
  logMean: null,
  logVariance: null,
  skewness: null,
}

function weightOf(weights: readonly number[] | undefined, index: number) {
  const weight = weights === undefined ? 1 : weights[index] ?? 0
  return Number.isFinite(weight) && weight > 0 ? weight : 0
}

/**
 * Central moments use weight-normalized denominators so the result is independent of the weight scale.
 * Log statistics ignore non-positive values, which have no logarithm; they are null when none remain.
 */
export function shapeStatistics(values: readonly number[], weights?: readonly number[]): ShapeStatistics {
  const samples = values.flatMap((value, index) => {
    const weight = weightOf(weights, index)
    return Number.isFinite(value) && weight > 0 ? [{ value, weight }] : []
  })
  const weightSum = samples.reduce((sum, sample) => sum + sample.weight, 0)
  if (samples.length < 2 || weightSum <= 0) return EMPTY

  const mean = samples.reduce((sum, sample) => sum + sample.value * sample.weight, 0) / weightSum
  const moment = (power: number) => samples.reduce((sum, sample) => sum + sample.weight * (sample.value - mean) ** power, 0) / weightSum
  const second = moment(2)
  const spread = second > 0 ? second ** 1.5 : 0

  const positive = samples.filter((sample) => sample.value > 0)
  const positiveWeight = positive.reduce((sum, sample) => sum + sample.weight, 0)
  const logMean = positiveWeight > 0
    ? positive.reduce((sum, sample) => sum + Math.log(sample.value) * sample.weight, 0) / positiveWeight
    : null
  const logVariance = logMean === null || positive.length < 2
    ? null
    : positive.reduce((sum, sample) => sum + sample.weight * (Math.log(sample.value) - logMean) ** 2, 0) / positiveWeight

  return {
    geometricMean: logMean === null ? null : Math.exp(logMean),
    kurtosis: second > 0 ? moment(4) / second ** 2 - 3 : null,
    logMean,
    logVariance,
    skewness: spread > 0 ? moment(3) / spread : null,
  }
}
