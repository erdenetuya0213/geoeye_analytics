import type { AnalysisGraphImage, AnalysisResultPackage } from '../data/analysisResultStore.js'
import type { ScenePaneCount } from './sceneSplitLayout.js'

export type SceneViewportContent =
  | { kind: 'scene' }
  | { kind: 'graph'; objectKey: string; resultId: string }

export type SceneViewportContents = Record<number, SceneViewportContent>

export interface ResolvedViewportGraph {
  graph: AnalysisGraphImage
  result: AnalysisResultPackage
}

export const SCENE_VIEWPORT_CONTENT_STORAGE_KEY = 'geoeye.analytics.scene-viewport-content.v1'

const paneIndexes = [0, 1, 2, 3] as const

export function parseSceneViewportContents(value: string | null): SceneViewportContents {
  try {
    const parsed = JSON.parse(value ?? 'null') as Record<string, Partial<{ kind: string; objectKey: unknown; resultId: unknown }>> | null
    if (parsed === null || typeof parsed !== 'object') return {}
    const contents: SceneViewportContents = {}
    paneIndexes.forEach((index) => {
      const item = parsed[index]
      if (item?.kind !== 'graph' || typeof item.objectKey !== 'string' || typeof item.resultId !== 'string') return
      contents[index] = { kind: 'graph', objectKey: item.objectKey, resultId: item.resultId }
    })
    return contents
  } catch {
    return {}
  }
}

// A saved graph disappears when its result package is overwritten or evicted;
// the pane then falls back to the live scene instead of showing a broken image.
export function resolveViewportGraph(
  packages: readonly AnalysisResultPackage[],
  content: SceneViewportContent | undefined,
): ResolvedViewportGraph | null {
  if (content?.kind !== 'graph') return null
  const result = packages.find((candidate) => candidate.resultId === content.resultId)
  const graph = result?.graphs.find((candidate) => candidate.objectKey === content.objectKey)
  return result === undefined || graph === undefined ? null : { graph, result }
}

export const SCENE_GRAPH_DRAG_TYPE = 'application/x-geoeye-scene-graph'

export function serializeGraphDrag(resultId: string, objectKey: string) {
  return JSON.stringify({ objectKey, resultId })
}

export function parseGraphDrag(value: string): { objectKey: string; resultId: string } | null {
  try {
    const parsed = JSON.parse(value) as Partial<{ objectKey: unknown; resultId: unknown }> | null
    if (typeof parsed?.objectKey !== 'string' || typeof parsed.resultId !== 'string') return null
    return { objectKey: parsed.objectKey, resultId: parsed.resultId }
  } catch {
    return null
  }
}

// A graph only ever opens in the viewport the user picked; the layout is never changed for it.
export function graphViewportPane(count: ScenePaneCount, requestedPane: number) {
  return Number.isInteger(requestedPane) && requestedPane >= 0 && requestedPane < count ? requestedPane : 0
}
