export interface SceneBackgroundPreferences {
  color: string
  recentColors: string[]
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const DEFAULT_SCENE_BACKGROUND = '#123b36'
export const SCENE_BACKGROUND_STORAGE_KEY = 'geoeye.analytics.scene-background.v1'
export const SCENE_BACKGROUND_HISTORY_STORAGE_KEY = 'geoeye.analytics.scene-background-history.v1'
export const MAX_RECENT_SCENE_BACKGROUNDS = 12

export const sceneBackgroundPresets = [
  { color: '#123b36', label: 'Mineral teal' },
  { color: '#075985', label: 'Ocean blue' },
  { color: '#1e3a8a', label: 'Cobalt' },
  { color: '#312e81', label: 'Core indigo' },
  { color: '#581c87', label: 'Amethyst' },
  { color: '#831843', label: 'Garnet' },
  { color: '#7f1d1d', label: 'Iron oxide' },
  { color: '#9a3412', label: 'Burnt sienna' },
  { color: '#713f12', label: 'Ochre' },
  { color: '#365314', label: 'Field olive' },
  { color: '#14532d', label: 'Forest' },
  { color: '#134e4a', label: 'Deep jade' },
  { color: '#111827', label: 'Slate' },
  { color: '#18181b', label: 'Graphite' },
  { color: '#f4f5f3', label: 'Light neutral' },
  { color: '#ffffff', label: 'White' },
] as const

export function normalizeSceneBackground(color: string): string | null {
  const trimmed = color.trim()
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null
}

export function addRecentSceneBackground(recentColors: readonly string[], color: string): string[] {
  const normalized = normalizeSceneBackground(color)
  if (normalized === null) return recentColors.slice(0, MAX_RECENT_SCENE_BACKGROUNDS)
  const deduplicated = recentColors.flatMap((candidate) => {
    const normalizedCandidate = normalizeSceneBackground(candidate)
    return normalizedCandidate === null || normalizedCandidate === normalized ? [] : [normalizedCandidate]
  })
  return [normalized, ...deduplicated].slice(0, MAX_RECENT_SCENE_BACKGROUNDS)
}

export function loadSceneBackgroundPreferences(storage: Pick<StorageLike, 'getItem'>): SceneBackgroundPreferences {
  const color = normalizeSceneBackground(storage.getItem(SCENE_BACKGROUND_STORAGE_KEY) ?? '') ?? DEFAULT_SCENE_BACKGROUND
  try {
    const parsed = JSON.parse(storage.getItem(SCENE_BACKGROUND_HISTORY_STORAGE_KEY) ?? '[]') as unknown
    const storedColors = Array.isArray(parsed) ? parsed.filter((candidate): candidate is string => typeof candidate === 'string') : []
    return { color, recentColors: addRecentSceneBackground(storedColors, color) }
  } catch {
    return { color, recentColors: [color] }
  }
}

export function saveSceneBackgroundPreferences(storage: Pick<StorageLike, 'setItem'>, preferences: SceneBackgroundPreferences) {
  storage.setItem(SCENE_BACKGROUND_STORAGE_KEY, preferences.color)
  storage.setItem(SCENE_BACKGROUND_HISTORY_STORAGE_KEY, JSON.stringify(preferences.recentColors))
}
