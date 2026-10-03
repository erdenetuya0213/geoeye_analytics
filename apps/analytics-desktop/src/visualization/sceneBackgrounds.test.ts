import { describe, expect, it } from 'vitest'
import {
  addRecentSceneBackground,
  DEFAULT_SCENE_BACKGROUND,
  loadSceneBackgroundPreferences,
  MAX_RECENT_SCENE_BACKGROUNDS,
  normalizeSceneBackground,
  saveSceneBackgroundPreferences,
  SCENE_BACKGROUND_HISTORY_STORAGE_KEY,
  SCENE_BACKGROUND_STORAGE_KEY,
  sceneBackgroundPresets,
} from './sceneBackgrounds.js'

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

describe('3D scene background preferences', () => {
  it('normalizes valid colours and rejects incomplete values', () => {
    expect(normalizeSceneBackground(' #A12b3C ')).toBe('#a12b3c')
    expect(normalizeSceneBackground('#123')).toBeNull()
    expect(normalizeSceneBackground('blue')).toBeNull()
  })

  it('keeps recent colours unique with the last used colour first', () => {
    const colors = Array.from({ length: MAX_RECENT_SCENE_BACKGROUNDS + 3 }, (_, index) => `#${index.toString(16).padStart(6, '0')}`)
    const recent = addRecentSceneBackground(colors, colors[4] ?? '#000004')

    expect(recent[0]).toBe('#000004')
    expect(recent.filter((color) => color === '#000004')).toHaveLength(1)
    expect(recent).toHaveLength(MAX_RECENT_SCENE_BACKGROUNDS)
  })

  it('restores the active colour and sanitizes persisted history', () => {
    const storage = memoryStorage({
      [SCENE_BACKGROUND_STORAGE_KEY]: '#A12B3C',
      [SCENE_BACKGROUND_HISTORY_STORAGE_KEY]: JSON.stringify(['invalid', '#abcdef', '#a12b3c', 42]),
    })

    expect(loadSceneBackgroundPreferences(storage)).toEqual({
      color: '#a12b3c',
      recentColors: ['#a12b3c', '#abcdef'],
    })
  })

  it('falls back safely and saves both the active colour and recent list', () => {
    const storage = memoryStorage({ [SCENE_BACKGROUND_HISTORY_STORAGE_KEY]: '{broken' })
    const preferences = loadSceneBackgroundPreferences(storage)
    expect(preferences).toEqual({ color: DEFAULT_SCENE_BACKGROUND, recentColors: [DEFAULT_SCENE_BACKGROUND] })

    saveSceneBackgroundPreferences(storage, { color: '#581c87', recentColors: ['#581c87', '#123b36'] })
    expect(storage.values.get(SCENE_BACKGROUND_STORAGE_KEY)).toBe('#581c87')
    expect(storage.values.get(SCENE_BACKGROUND_HISTORY_STORAGE_KEY)).toBe('["#581c87","#123b36"]')
  })

  it('offers a broad, unique palette of valid colours', () => {
    const colors = sceneBackgroundPresets.map((preset) => preset.color)
    expect(colors).toHaveLength(16)
    expect(new Set(colors).size).toBe(colors.length)
    colors.forEach((color) => expect(normalizeSceneBackground(color)).toBe(color))
  })
})
