export type SceneTextFontId = 'mono' | 'sans' | 'serif'

export interface SceneTextPreferences {
  backgroundColor: string
  color: string
  font: SceneTextFontId
  showBox: boolean
  size: number
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const SCENE_TEXT_STORAGE_KEY = 'geoeye.analytics.scene-text.v1'
export const MIN_SCENE_TEXT_SIZE = 8
export const MAX_SCENE_TEXT_SIZE = 24

export const sceneTextFonts = [
  {
    cssFamily: '"Segoe UI Variable Text", "Segoe UI", Tahoma, system-ui, sans-serif',
    id: 'sans',
    label: 'UI sans',
  },
  {
    cssFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
    id: 'mono',
    label: 'Technical mono',
  },
  {
    cssFamily: 'Georgia, "Times New Roman", serif',
    id: 'serif',
    label: 'Serif',
  },
] as const satisfies readonly { cssFamily: string; id: SceneTextFontId; label: string }[]

export const DEFAULT_SCENE_TEXT_PREFERENCES: SceneTextPreferences = {
  backgroundColor: '#111917',
  color: '#e8f0ed',
  font: 'sans',
  showBox: false,
  size: 12,
}

function normalizeColor(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback
}

function normalizeFont(value: unknown): SceneTextFontId {
  return sceneTextFonts.some((font) => font.id === value) ? value as SceneTextFontId : DEFAULT_SCENE_TEXT_PREFERENCES.font
}

function normalizeSize(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_SCENE_TEXT_PREFERENCES.size
  return Math.round(Math.min(MAX_SCENE_TEXT_SIZE, Math.max(MIN_SCENE_TEXT_SIZE, parsed)))
}

export function normalizeSceneTextPreferences(value: unknown): SceneTextPreferences {
  const candidate = typeof value === 'object' && value !== null ? value as Partial<SceneTextPreferences> : {}
  return {
    backgroundColor: normalizeColor(candidate.backgroundColor, DEFAULT_SCENE_TEXT_PREFERENCES.backgroundColor),
    color: normalizeColor(candidate.color, DEFAULT_SCENE_TEXT_PREFERENCES.color),
    font: normalizeFont(candidate.font),
    showBox: false,
    size: normalizeSize(candidate.size),
  }
}

export function sceneTextFontFamily(font: SceneTextFontId) {
  return sceneTextFonts.find((candidate) => candidate.id === font)?.cssFamily ?? sceneTextFonts[0].cssFamily
}

export function loadSceneTextPreferences(storage: Pick<StorageLike, 'getItem'>): SceneTextPreferences {
  try {
    return normalizeSceneTextPreferences(JSON.parse(storage.getItem(SCENE_TEXT_STORAGE_KEY) ?? 'null'))
  } catch {
    return { ...DEFAULT_SCENE_TEXT_PREFERENCES }
  }
}

export function saveSceneTextPreferences(storage: Pick<StorageLike, 'setItem'>, preferences: SceneTextPreferences) {
  storage.setItem(SCENE_TEXT_STORAGE_KEY, JSON.stringify(normalizeSceneTextPreferences(preferences)))
}
