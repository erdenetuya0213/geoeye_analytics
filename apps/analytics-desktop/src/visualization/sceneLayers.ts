import type { EdaObservation } from '../analysis/eda.js'
import type { AnalysisResultPackage } from '../data/analysisResultStore.js'
import { numericClassBreaks, type NumericClassification, type SceneStructureObservation } from './scene3dAnalysis.js'

export type SceneLayerGroup = 'Drilling' | 'Geology' | 'Geotech' | 'Structure' | 'Analytics'

/**
 * What a layer contributes to a viewport. `attribute` layers have no geometry of
 * their own yet: they colour the interval tubes by `colorBy`.
 */
export type SceneLayerGeometry = 'collars' | 'trajectories' | 'tubes' | 'discs' | 'attribute' | 'highlight'

export interface SceneLayer {
  colorBy?: string
  count: number
  geometry: SceneLayerGeometry
  group: SceneLayerGroup
  id: string
  label: string
  result?: AnalysisResultPackage
  source: string
}

export interface SceneLayerInput {
  datasetName: string
  handoff: { count: number; label: string; sourceModule: string } | null
  holeCount: number
  results: readonly { count: number; result: AnalysisResultPackage }[]
  rows: readonly EdaObservation[]
  selectedCount: number
  structures: readonly Pick<SceneStructureObservation, 'jointSet' | 'kind'>[]
}

export function buildSceneLayers(input: SceneLayerInput): SceneLayer[] {
  const { rows, structures } = input
  const countValues = (key: string) => rows.filter((row) => typeof row.values[key] === 'number').length
  const countDimension = (key: string) => rows.filter((row) => row.dimensions[key] !== undefined).length
  return [
    { count: input.holeCount, geometry: 'collars', group: 'Drilling', id: 'collars', label: 'Collars', source: 'Data Pool · collar' },
    { count: input.holeCount, geometry: 'trajectories', group: 'Drilling', id: 'trajectories', label: 'Trajectories', source: 'Data Pool · survey' },
    { count: rows.length, geometry: 'tubes', group: 'Drilling', id: 'intervals', label: 'Intervals', source: input.datasetName },
    { colorBy: 'lithology', count: rows.length, geometry: 'attribute', group: 'Geology', id: 'lithology', label: 'Lithology', source: 'Logging · lithology' },
    { colorBy: 'alteration', count: countDimension('alteration'), geometry: 'attribute', group: 'Geology', id: 'alteration', label: 'Alteration', source: 'Logging · alteration' },
    { colorBy: 'assay.au', count: rows.filter((row) => (row.values['assay.au'] ?? 0) > 1).length, geometry: 'attribute', group: 'Geology', id: 'mineralisation', label: 'Mineralisation', source: 'Assay · Au > 1 g/t' },
    { colorBy: 'domain', count: countDimension('domain'), geometry: 'attribute', group: 'Geology', id: 'saved-domains', label: 'Saved domains', source: 'Domain memberships' },
    { colorBy: 'geotech.rmr76', count: countValues('geotech.rmr76'), geometry: 'attribute', group: 'Geotech', id: 'rmr', label: 'RMR', source: 'Geotech · RMR76' },
    { colorBy: 'geotech.rqd', count: countValues('geotech.rqd'), geometry: 'attribute', group: 'Geotech', id: 'rqd', label: 'RQD', source: 'Geotech · RQD' },
    { count: 0, geometry: 'attribute', group: 'Geotech', id: 'fracture-frequency', label: 'Fracture frequency', source: 'No linked source' },
    { count: 0, geometry: 'attribute', group: 'Geotech', id: 'geotech-domains', label: 'Geotech domains', source: 'No saved membership' },
    { count: structures.filter((item) => item.kind === 'discontinuity').length, geometry: 'discs', group: 'Structure', id: 'discontinuities', label: 'Discontinuities', source: 'Structure · true XYZ' },
    { colorBy: 'joint_set', count: structures.filter((item) => item.jointSet !== 'Unclassified').length, geometry: 'discs', group: 'Structure', id: 'joint-sets', label: 'J1 / J2 / J3 planes', source: 'Structure · true dip / direction' },
    { count: structures.filter((item) => item.kind === 'fault').length, geometry: 'discs', group: 'Structure', id: 'faults', label: 'Faults', source: 'Structure interpretation' },
    { colorBy: 'multivariate.pc1', count: countValues('multivariate.pc1'), geometry: 'attribute', group: 'Analytics', id: 'pca', label: 'PCA scores', source: 'Saved multivariate scores' },
    { colorBy: 'multivariate.cluster_id', count: countValues('multivariate.cluster_id'), geometry: 'attribute', group: 'Analytics', id: 'clusters', label: 'Cluster membership', source: 'Saved cluster ID' },
    { count: input.selectedCount, geometry: 'highlight', group: 'Analytics', id: 'statistics', label: 'Statistics populations', source: 'Linked selection' },
    ...(input.handoff === null ? [] : [{
      count: input.handoff.count, geometry: 'highlight' as const, group: 'Analytics' as const, id: 'candidate',
      label: input.handoff.label, source: `${input.handoff.sourceModule} · linked IDs`,
    }]),
    ...input.results.map(({ count, result }): SceneLayer => ({
      count,
      geometry: 'attribute',
      group: 'Analytics',
      id: `result:${result.resultId}`,
      label: `${result.feature} · v${result.templateVersion}`,
      result,
      source: `${result.sourceFileName} · ${result.inputName} · ${result.graphs.length} graph${result.graphs.length === 1 ? '' : 's'}`,
    })),
  ]
}

/** The field a layer colours by, limited to fields the dataset actually offers. */
export function sceneLayerColorField(layer: SceneLayer, availableKeys: ReadonlySet<string>): string | undefined {
  const candidates = layer.result === undefined
    ? (layer.colorBy === undefined ? [] : [layer.colorBy])
    : layer.result.derivedFieldKeys
  return candidates.find((key) => availableKeys.has(key))
}

/** What one viewport shows: its own visible layers and its own colour field. */
export interface ScenePaneView {
  colorBy: string
  layers: string[]
}

export type ScenePaneViews = Record<number, ScenePaneView>

// A viewport the user has not customised follows Viewport 1, so a new split
// opens showing the scene the user was already looking at.
export function scenePaneView(views: ScenePaneViews, pane: number, fallback: ScenePaneView): ScenePaneView {
  const view = views[pane] ?? views[0]
  if (view === undefined || typeof view.colorBy !== 'string' || !Array.isArray(view.layers)) return fallback
  return view
}

export function withScenePaneLayers(
  views: ScenePaneViews,
  pane: number,
  fallback: ScenePaneView,
  update: (current: Set<string>) => Set<string>,
): ScenePaneViews {
  const current = scenePaneView(views, pane, fallback)
  return { ...views, [pane]: { colorBy: current.colorBy, layers: [...update(new Set(current.layers))] } }
}

export function withScenePaneColor(views: ScenePaneViews, pane: number, fallback: ScenePaneView, colorBy: string): ScenePaneViews {
  const current = scenePaneView(views, pane, fallback)
  return { ...views, [pane]: { colorBy, layers: [...current.layers] } }
}

/** Identical views share one scene build; this key says when two views are identical. */
export function scenePaneViewKey(view: ScenePaneView) {
  return `${view.colorBy}\u0000${[...view.layers].sort().join('\u0000')}`
}

export type SceneClassification = NumericClassification | 'categorical'

export interface SceneColorScale {
  categories: string[]
  classification: SceneClassification
  color: (value: string | number | null) => string
  maximum: number
  minimum: number
  values: (string | number)[]
}

export interface SceneColorScaleInput {
  categorical: boolean
  categoryPalette: readonly string[]
  classification: SceneClassification
  customBreaks: readonly number[]
  palette: readonly string[]
  values: readonly (string | number | null)[]
}

export function buildSceneColorScale(input: SceneColorScaleInput): SceneColorScale {
  const { categoryPalette, palette } = input
  const values = input.values.filter((value): value is string | number => value !== null)
  const categories = [...new Set(values.filter((value): value is string => typeof value === 'string'))].sort()
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b)
  const minimum = numbers[0] ?? 0
  const maximum = numbers.at(-1) ?? 1
  const classification: SceneClassification = input.categorical || categories.length > 0 ? 'categorical' : input.classification
  const breaks = numericClassBreaks(numbers, classification === 'categorical' ? 'continuous' : classification, palette.length, [...input.customBreaks])
  const lastClass = palette.length - 1
  const color = (value: string | number | null) => {
    if (typeof value === 'string') return categoryPalette[Math.max(0, categories.indexOf(value)) % categoryPalette.length] ?? '#70847d'
    if (typeof value !== 'number') return '#67756f'
    const index = classification === 'continuous'
      ? Math.min(lastClass, Math.floor((value - minimum) / Math.max(Number.EPSILON, maximum - minimum) * palette.length))
      : Math.max(0, breaks.findIndex((item, breakIndex) => breakIndex > 0 && value <= item) - 1)
    return palette[Math.min(lastClass, index)] ?? palette[0] ?? '#315f78'
  }
  return { categories, classification, color, maximum, minimum, values }
}
