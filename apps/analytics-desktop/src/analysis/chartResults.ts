import {
  buildSwath,
  finiteSamples,
  linearRegression,
  pairedDatasetSamples,
  pearsonCorrelation,
  spearmanCorrelation,
  type EdaObservation,
  type JoinedPair,
  type RegressionLine,
  type SwathAxis,
  type SwathBin,
} from './eda.js'

export interface ScatterAnalysisResult {
  correlation: number | null
  kind: 'scatter'
  matchMetadata: {
    matchedObservationCount: number
    method: 'interval-overlap'
  }
  points: JoinedPair[]
  regression: RegressionLine | null
  sourceObservationIds: string[]
  spearman: number | null
}

export interface CorrelationCell {
  column: number
  count: number
  row: number
  sourceObservationIds: string[]
  value: number | null
}

export interface CorrelationAnalysisResult {
  cells: CorrelationCell[]
  kind: 'correlation'
  labels: string[]
  method: 'pearson' | 'spearman'
}

export interface CorrelationVariableInput {
  id: string
  label: string
  observations: readonly EdaObservation[]
  variableKey: string
}

export interface QqPointResult {
  probability: number
  sourceObservationIds: string[]
  x: number
  y: number
}

export interface QqAnalysisResult {
  kind: 'qq-plot'
  points: QqPointResult[]
  regression: RegressionLine | null
  sourceObservationIds: string[]
}

export interface SwathAnalysisResult {
  axis: SwathAxis
  bins: SwathBin[]
  kind: 'swath'
  sourceObservationIds: string[]
  variableKey: string
}

export interface BoxPlotGroupResult {
  category: string
  high: number
  low: number
  median: number
  q1: number
  q3: number
  sourceObservationIds: string[]
}

export interface BoxPlotAnalysisResult {
  groups: BoxPlotGroupResult[]
  kind: 'box-plot'
}

export interface HeatmapCellResult {
  column: number
  row: number
  sourceObservationIds: string[]
  value: number
}

export interface HeatmapAnalysisResult {
  cells: HeatmapCellResult[]
  columns: string[]
  kind: 'heatmap'
  rows: string[]
}

export interface VariogramPointResult {
  lag: number
  semivariance: number
  sourceObservationIds: string[]
}

export interface VariogramAnalysisResult {
  experimental: VariogramPointResult[]
  kind: 'variogram'
  model: VariogramPointResult[]
}

export interface DownholeTrackPointResult {
  depth: number
  sourceObservationIds: string[]
  value: number
}

export interface DownholeTrackResult {
  holeId: string
  kind: 'downhole-track'
  tracks: Array<{
    colorRole?: 'accent' | 'muted' | 'primary' | 'violet'
    name: string
    points: DownholeTrackPointResult[]
  }>
}

export interface AnalyticalSeriesResult {
  kind: 'analytical-series'
  series: Array<{
    name: string
    points: Array<{
      sourceObservationIds: string[]
      x: number
      y: number
    }>
    style: 'bar' | 'line'
  }>
}

export function analyzeRelationship(
  leftObservations: readonly EdaObservation[],
  rightObservations: readonly EdaObservation[],
  leftVariableKey: string,
  rightVariableKey: string,
): ScatterAnalysisResult {
  const points = pairedDatasetSamples(leftObservations, rightObservations, leftVariableKey, rightVariableKey)
  const leftValues = points.map((point) => point.x)
  const rightValues = points.map((point) => point.y)
  return {
    correlation: pearsonCorrelation(leftValues, rightValues),
    kind: 'scatter',
    matchMetadata: { matchedObservationCount: points.length, method: 'interval-overlap' },
    points,
    regression: linearRegression(points),
    sourceObservationIds: Array.from(new Set(points.flatMap((point) => point.sourceObservationIds))),
    spearman: spearmanCorrelation(leftValues, rightValues),
  }
}

export function correlationResult(labels: readonly string[], scatter: ScatterAnalysisResult): CorrelationAnalysisResult {
  const correlation = scatter.correlation
  const ids = scatter.sourceObservationIds
  return {
    cells: [
      { column: 0, count: scatter.points.length, row: 0, sourceObservationIds: ids, value: 1 },
      { column: 1, count: scatter.points.length, row: 0, sourceObservationIds: ids, value: correlation },
      { column: 0, count: scatter.points.length, row: 1, sourceObservationIds: ids, value: correlation },
      { column: 1, count: scatter.points.length, row: 1, sourceObservationIds: ids, value: 1 },
    ],
    kind: 'correlation',
    labels: [...labels],
    method: 'pearson',
  }
}

export function analyzeCorrelationMatrix(
  variables: readonly CorrelationVariableInput[],
  method: 'pearson' | 'spearman',
): CorrelationAnalysisResult {
  return {
    cells: variables.flatMap((rowVariable, row) => variables.map((columnVariable, column) => {
      const relationship = analyzeRelationship(
        columnVariable.observations,
        rowVariable.observations,
        columnVariable.variableKey,
        rowVariable.variableKey,
      )
      return {
        column,
        count: relationship.matchMetadata.matchedObservationCount,
        row,
        sourceObservationIds: relationship.sourceObservationIds,
        value: method === 'pearson' ? relationship.correlation : relationship.spearman,
      }
    })),
    kind: 'correlation',
    labels: variables.map((variable) => variable.label),
    method,
  }
}

export function analyzeQq(
  leftObservations: readonly EdaObservation[],
  rightObservations: readonly EdaObservation[],
  leftVariableKey: string,
  rightVariableKey: string,
): QqAnalysisResult {
  const left = finiteSamples(leftObservations, leftVariableKey).sort((a, b) => a.value - b.value)
  const right = finiteSamples(rightObservations, rightVariableKey).sort((a, b) => a.value - b.value)
  const count = Math.min(left.length, right.length, 200)
  const points = Array.from({ length: count }, (_, index): QqPointResult => {
    const probability = (index + 0.5) / count
    const leftSample = left[Math.min(left.length - 1, Math.floor(probability * left.length))]!
    const rightSample = right[Math.min(right.length - 1, Math.floor(probability * right.length))]!
    return {
      probability,
      sourceObservationIds: Array.from(new Set([leftSample.id, rightSample.id])),
      x: leftSample.value,
      y: rightSample.value,
    }
  })

  return {
    kind: 'qq-plot',
    points,
    regression: linearRegression(points),
    sourceObservationIds: Array.from(new Set(points.flatMap((point) => point.sourceObservationIds))),
  }
}

export function analyzeSwath(
  observations: readonly EdaObservation[],
  variableKey: string,
  axis: SwathAxis,
): SwathAnalysisResult {
  const bins = buildSwath(observations, variableKey, axis)
  return {
    axis,
    bins,
    kind: 'swath',
    sourceObservationIds: Array.from(new Set(bins.flatMap((bin) => bin.ids))),
    variableKey,
  }
}
