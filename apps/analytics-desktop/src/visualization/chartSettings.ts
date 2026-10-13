/**
 * One settings record for every analytical chart. Builders read the fields they understand and
 * GeoEyeChart applies the view-level fields (log axes, marks) to whatever option they return,
 * so a new switch is added in one place rather than per chart.
 */
export type ChartKind = 'box' | 'cdf' | 'generic' | 'histogram' | 'matrix' | 'probability' | 'qq' | 'scatter' | 'swath'
export type AxisTransform = 'log' | 'none' | 'normal-scores' | 'rank'
export type ControlLineMode = 'fixed' | 'none' | 'percent'
export type FitCurve = 'lognormal' | 'none' | 'normal'
export type FrequencyMode = 'count' | 'relative'
export type MatrixShape = 'full' | 'lower' | 'upper'
export type RegressionMethod = 'least-squares' | 'none' | 'reduced-major-axis'
export type RegressionModel = 'exponential' | 'linear' | 'power' | 'quadratic'
export type ScatterSymbol = 'circle' | 'cross' | 'dot' | 'none' | 'plus'
export type StatsCorner = 'auto' | 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'
export type WhiskerMode = 'min-max' | 'percentile' | 'tukey'

export type StatKey =
  | 'coefficientOfVariation' | 'count' | 'geometricMean' | 'kurtosis' | 'logMean' | 'logVariance'
  | 'maximum' | 'mean' | 'median' | 'minimum' | 'missing' | 'p95' | 'q1' | 'q3' | 'skewness'
  | 'standardDeviation' | 'variance'

export type ReferenceLineKey = 'geometricMean' | 'mean' | 'median' | 'p95' | 'q1' | 'q3'

export const statLabels: Record<StatKey, string> = {
  coefficientOfVariation: 'CV',
  count: 'Count',
  geometricMean: 'Geom mean',
  kurtosis: 'Kurtosis (excess)',
  logMean: 'Log mean',
  logVariance: 'Log variance',
  maximum: 'Maximum',
  mean: 'Mean',
  median: 'Median',
  minimum: 'Minimum',
  missing: 'Missing',
  p95: 'P95',
  q1: 'P25',
  q3: 'P75',
  skewness: 'Skewness',
  standardDeviation: 'Std dev',
  variance: 'Variance',
}

export const referenceLineLabels: Record<ReferenceLineKey, string> = {
  geometricMean: 'Geom mean',
  mean: 'Mean',
  median: 'Median',
  p95: 'P95',
  q1: 'P25',
  q3: 'P75',
}

export interface ChartSettings {
  /** Histogram bins; null keeps the Freedman–Diaconis recommendation. */
  binCount: number | null
  /** Dataset dimension or variable key the marks are coloured by; null is a single series. */
  colorBy: string | null
  colorByControlLines: boolean
  controlLineMode: ControlLineMode
  controlLineValue: number
  /** Confidence level for the regression band, e.g. 95; null hides it. */
  confidence: number | null
  cumulative: boolean
  decimals: number
  fitCurve: FitCurve
  frequencyMode: FrequencyMode
  logX: boolean
  logY: boolean
  matrixShape: MatrixShape
  /** Coefficients below this absolute value are dimmed in the matrix. */
  matrixThreshold: number
  opacity: number
  referenceLines: ReferenceLineKey[]
  regressionMethod: RegressionMethod
  regressionModel: RegressionModel
  sameScale: boolean
  showEquation: boolean
  showOneToOne: boolean
  showOutliers: boolean
  showPoints: boolean
  showPopulationSize: boolean
  stats: StatKey[]
  statsBox: boolean
  statsCorner: StatsCorner
  symbol: ScatterSymbol
  symbolSize: number
  transformX: AxisTransform
  transformY: AxisTransform
  whiskerMode: WhiskerMode
  /** Lower percentile for percentile whiskers; the upper end mirrors it. */
  whiskerPercent: number
}

export const defaultChartSettings: ChartSettings = {
  binCount: null,
  colorBy: null,
  colorByControlLines: false,
  confidence: null,
  controlLineMode: 'none',
  controlLineValue: 10,
  cumulative: false,
  decimals: 2,
  fitCurve: 'none',
  frequencyMode: 'relative',
  logX: false,
  logY: false,
  matrixShape: 'full',
  matrixThreshold: 0,
  opacity: 0.78,
  referenceLines: [],
  regressionMethod: 'least-squares',
  regressionModel: 'linear',
  sameScale: false,
  showEquation: true,
  showOneToOne: false,
  showOutliers: true,
  showPoints: false,
  showPopulationSize: true,
  stats: ['count', 'mean', 'median', 'standardDeviation', 'coefficientOfVariation', 'minimum', 'maximum'],
  statsBox: false,
  statsCorner: 'auto',
  symbol: 'circle',
  symbolSize: 7,
  transformX: 'none',
  transformY: 'none',
  whiskerMode: 'min-max',
  whiskerPercent: 5,
}

const kindDefaults: Partial<Record<ChartKind, Partial<ChartSettings>>> = {
  box: { showPopulationSize: true, whiskerMode: 'tukey' },
  histogram: { statsBox: true },
  matrix: { decimals: 2 },
  qq: { showOneToOne: true },
  scatter: { showEquation: true, symbolSize: 7 },
}

export type ChartControlGroup = 'axes' | 'box' | 'distribution' | 'marks' | 'matrix' | 'reference' | 'regression' | 'statistics'

/** Which groups the settings popover offers, in the order they are shown. */
export const chartControlGroups: Record<ChartKind, ChartControlGroup[]> = {
  box: ['axes', 'box', 'marks', 'statistics'],
  cdf: ['axes', 'distribution', 'reference', 'marks'],
  generic: ['axes'],
  histogram: ['axes', 'distribution', 'reference', 'statistics'],
  matrix: ['matrix', 'statistics'],
  probability: ['axes', 'reference', 'marks'],
  qq: ['axes', 'marks', 'regression'],
  scatter: ['axes', 'regression', 'marks', 'statistics'],
  swath: ['axes', 'reference', 'marks'],
}

export function chartSettingsFor(kind: ChartKind, saved?: Partial<ChartSettings> | null): ChartSettings {
  return { ...defaultChartSettings, ...kindDefaults[kind], ...saved }
}

/** Only the fields that differ from the kind's defaults are persisted, so new fields keep their defaults. */
export function chartSettingsDelta(kind: ChartKind, settings: ChartSettings): Partial<ChartSettings> {
  const base = chartSettingsFor(kind)
  const delta: Record<string, unknown> = {}
  for (const key of Object.keys(settings) as Array<keyof ChartSettings>) {
    const value = settings[key]
    const same = Array.isArray(value) && Array.isArray(base[key])
      ? JSON.stringify(value) === JSON.stringify(base[key])
      : value === base[key]
    if (!same) delta[key] = value
  }
  return delta as Partial<ChartSettings>
}
