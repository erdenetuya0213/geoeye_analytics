import { describe, expect, it } from 'vitest'
import type { EdaObservation } from '../analysis/eda.js'
import type { AnalysisResultPackage } from '../data/analysisResultStore.js'
import {
  buildSceneColorScale,
  buildSceneLayers,
  sceneLayerColorField,
  scenePaneView,
  scenePaneViewKey,
  withScenePaneColor,
  withScenePaneLayers,
  type ScenePaneView,
} from './sceneLayers.js'

const row = (id: string, values: Record<string, number | null>, dimensions: Record<string, string> = {}): EdaObservation => ({
  depthFrom: 0, depthTo: 1, dimensions, easting: 0, holeId: 'DH-001', id, joinKey: id, lithology: 'Diorite',
  northing: 0, sampleId: id, sourceObservationId: id, values,
})
const rows = [
  row('a', { 'assay.au': 2.4, 'geotech.rqd': 80, 'multivariate.pc1': 0.4 }, { alteration: 'Sericite' }),
  row('b', { 'assay.au': 0.2, 'geotech.rqd': null }),
]
const result = {
  derivedFieldKeys: ['multivariate.missing', 'multivariate.pc1'], feature: 'multivariate', graphs: [{}, {}],
  inputName: 'Au Cu', resultId: 'multivariate:template:v3', sourceFileName: 'gold.csv', templateVersion: 3,
} as unknown as AnalysisResultPackage
const layers = buildSceneLayers({
  datasetName: 'Integrated gold', handoff: { count: 1, label: 'Candidate C2', sourceModule: 'domain' }, holeCount: 1,
  results: [{ count: 2, result }], rows, selectedCount: 0,
  structures: [{ jointSet: 'J1', kind: 'discontinuity' }, { jointSet: 'Unclassified', kind: 'fault' }],
})
const layer = (id: string) => layers.find((item) => item.id === id)!
const fallback: ScenePaneView = { colorBy: 'lithology', layers: ['collars', 'intervals'] }
const palette = ['#1', '#2', '#3', '#4', '#5']
const categoryPalette = ['#a', '#b']

describe('3D scene layer registry', () => {
  it('declares the geometry and colour field of every layer', () => {
    expect(layer('intervals')).toMatchObject({ count: 2, geometry: 'tubes', group: 'Drilling' })
    expect(layer('mineralisation')).toMatchObject({ colorBy: 'assay.au', count: 1, geometry: 'attribute' })
    expect(layer('alteration').count).toBe(1)
    expect(layer('rqd').count).toBe(1)
    expect(layer('joint-sets')).toMatchObject({ count: 1, geometry: 'discs' })
    expect(layer('faults').count).toBe(1)
    expect(layer('candidate')).toMatchObject({ count: 1, geometry: 'highlight', source: 'domain · linked IDs' })
    expect(layer('result:multivariate:template:v3')).toMatchObject({ count: 2, label: 'multivariate · v3', source: 'gold.csv · Au Cu · 2 graphs' })
  })

  it('colours by a layer field only when the dataset offers it', () => {
    const available = new Set(['lithology', 'multivariate.pc1'])
    expect(sceneLayerColorField(layer('lithology'), available)).toBe('lithology')
    expect(sceneLayerColorField(layer('rqd'), available)).toBeUndefined()
    expect(sceneLayerColorField(layer('collars'), available)).toBeUndefined()
    expect(sceneLayerColorField(layer('result:multivariate:template:v3'), available)).toBe('multivariate.pc1')
  })
})

describe('3D scene viewport views', () => {
  it('follows Viewport 1 until a viewport is customised', () => {
    expect(scenePaneView({}, 2, fallback)).toBe(fallback)
    const first = withScenePaneColor({}, 0, fallback, 'assay.au')
    expect(scenePaneView(first, 2, fallback)).toEqual({ colorBy: 'assay.au', layers: ['collars', 'intervals'] })
  })

  it('changes layers and colour for one viewport only', () => {
    let views = withScenePaneColor({}, 0, fallback, 'assay.au')
    views = withScenePaneLayers(views, 1, fallback, (current) => { current.delete('collars'); current.add('faults'); return current })
    views = withScenePaneColor(views, 1, fallback, 'multivariate.cluster_id')
    expect(views[0]).toEqual({ colorBy: 'assay.au', layers: ['collars', 'intervals'] })
    expect(views[1]).toEqual({ colorBy: 'multivariate.cluster_id', layers: ['intervals', 'faults'] })
  })

  it('ignores unusable saved views and keys identical views alike', () => {
    expect(scenePaneView({ 0: { colorBy: 4, layers: 'x' } as unknown as ScenePaneView }, 0, fallback)).toBe(fallback)
    expect(scenePaneViewKey({ colorBy: 'a', layers: ['x', 'y'] })).toBe(scenePaneViewKey({ colorBy: 'a', layers: ['y', 'x'] }))
    expect(scenePaneViewKey({ colorBy: 'a', layers: ['x'] })).not.toBe(scenePaneViewKey({ colorBy: 'b', layers: ['x'] }))
  })
})

describe('3D scene colour scale', () => {
  it('spreads a continuous variable across the palette', () => {
    const scale = buildSceneColorScale({ categorical: false, categoryPalette, classification: 'continuous', customBreaks: [], palette, values: [0, 5, 10, null] })
    expect(scale).toMatchObject({ classification: 'continuous', maximum: 10, minimum: 0 })
    expect(scale.values).toEqual([0, 5, 10])
    expect([scale.color(0), scale.color(5), scale.color(10)]).toEqual(['#1', '#3', '#5'])
    expect(scale.color(null)).toBe('#67756f')
  })

  it('treats text values as categories regardless of the requested classification', () => {
    const scale = buildSceneColorScale({ categorical: false, categoryPalette, classification: 'quantile', customBreaks: [], palette, values: ['Diorite', 'Andesite', 'Diorite', 'Tuff'] })
    expect(scale.classification).toBe('categorical')
    expect(scale.categories).toEqual(['Andesite', 'Diorite', 'Tuff'])
    expect([scale.color('Andesite'), scale.color('Diorite'), scale.color('Tuff')]).toEqual(['#a', '#b', '#a'])
  })
})
