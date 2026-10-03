export const DEFAULT_SCENE_SPLIT_RATIO = 50
export const MIN_SCENE_SPLIT_RATIO = 25
export const MAX_SCENE_SPLIT_RATIO = 75

export type ScenePaneCount = 1 | 2 | 3 | 4
export type SceneSplitAxis = 'column' | 'row'

export interface SceneSplitLayout {
  column: number
  count: ScenePaneCount
  row: number
}

export const DEFAULT_SCENE_SPLIT_LAYOUT: SceneSplitLayout = {
  column: DEFAULT_SCENE_SPLIT_RATIO,
  count: 1,
  row: DEFAULT_SCENE_SPLIT_RATIO,
}

export function clampSceneSplitRatio(value: number) {
  return Math.max(MIN_SCENE_SPLIT_RATIO, Math.min(MAX_SCENE_SPLIT_RATIO, value))
}

export function parseSceneSplitRatio(value: string | null) {
  if (value === null) return DEFAULT_SCENE_SPLIT_RATIO
  const parsed = Number(value)
  return Number.isFinite(parsed) ? clampSceneSplitRatio(parsed) : DEFAULT_SCENE_SPLIT_RATIO
}

export function parseSceneSplitLayout(value: string | null): SceneSplitLayout {
  try {
    const parsed = JSON.parse(value ?? 'null') as Partial<SceneSplitLayout> | null
    if (parsed === null || ![1, 2, 3, 4].includes(parsed.count ?? 0)) return DEFAULT_SCENE_SPLIT_LAYOUT
    if (!Number.isFinite(parsed.column) || !Number.isFinite(parsed.row)) return DEFAULT_SCENE_SPLIT_LAYOUT
    return {
      column: clampSceneSplitRatio(parsed.column as number),
      count: parsed.count as ScenePaneCount,
      row: clampSceneSplitRatio(parsed.row as number),
    }
  } catch {
    return DEFAULT_SCENE_SPLIT_LAYOUT
  }
}
