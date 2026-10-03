import { describe, expect, it } from 'vitest'
import type { AnalysisResultPackage } from '../data/analysisResultStore.js'
import {
  graphViewportPane,
  parseGraphDrag,
  parseSceneViewportContents,
  resolveViewportGraph,
  serializeGraphDrag,
} from './sceneViewportContent.js'

const graph = {
  boreholeId: null,
  chartName: 'PCA scores',
  fileName: 'pca.png',
  imageDataUrl: 'data:image/png;base64,pca',
  mediaType: 'image/png' as const,
  objectKey: 'analytics/multivariate/v3/pca.png',
}
const packages = [{ graphs: [graph], resultId: 'multivariate:template:v3' }] as unknown as AnalysisResultPackage[]

describe('3D scene viewport content', () => {
  it('restores saved graph panes and drops anything else', () => {
    expect(parseSceneViewportContents('{"1":{"kind":"graph","resultId":"r","objectKey":"k"},"2":{"kind":"scene"},"7":{"kind":"graph","resultId":"r","objectKey":"k"}}'))
      .toEqual({ 1: { kind: 'graph', objectKey: 'k', resultId: 'r' } })
    expect(parseSceneViewportContents('{"0":{"kind":"graph","resultId":4}}')).toEqual({})
    expect(parseSceneViewportContents('invalid')).toEqual({})
    expect(parseSceneViewportContents(null)).toEqual({})
  })

  it('resolves a pane to its saved graph and falls back when the graph is gone', () => {
    expect(resolveViewportGraph(packages, { kind: 'graph', objectKey: graph.objectKey, resultId: 'multivariate:template:v3' })?.graph).toBe(graph)
    expect(resolveViewportGraph(packages, { kind: 'graph', objectKey: 'missing.png', resultId: 'multivariate:template:v3' })).toBeNull()
    expect(resolveViewportGraph(packages, { kind: 'graph', objectKey: graph.objectKey, resultId: 'removed' })).toBeNull()
    expect(resolveViewportGraph(packages, { kind: 'scene' })).toBeNull()
    expect(resolveViewportGraph(packages, undefined)).toBeNull()
  })

  it('opens a graph in the viewport the user picked without changing the layout', () => {
    expect(graphViewportPane(1, 0)).toBe(0)
    expect(graphViewportPane(4, 2)).toBe(2)
    expect(graphViewportPane(2, 3)).toBe(0)
    expect(graphViewportPane(4, -1)).toBe(0)
  })

  it('round-trips a dragged graph and rejects foreign drag payloads', () => {
    expect(parseGraphDrag(serializeGraphDrag('result', 'graph.png'))).toEqual({ objectKey: 'graph.png', resultId: 'result' })
    expect(parseGraphDrag('{"resultId":"result"}')).toBeNull()
    expect(parseGraphDrag('plain text')).toBeNull()
  })
})
