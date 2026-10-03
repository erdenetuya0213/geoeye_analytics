import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCENE_TEXT_PREFERENCES,
  loadSceneTextPreferences,
  MAX_SCENE_TEXT_SIZE,
  MIN_SCENE_TEXT_SIZE,
  normalizeSceneTextPreferences,
  saveSceneTextPreferences,
  SCENE_TEXT_STORAGE_KEY,
  sceneTextFontFamily,
  sceneTextFonts,
} from './sceneTextPreferences.js'

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

describe('3D scene screen-text preferences', () => {
  it('restores valid saved values', () => {
    const storage = memoryStorage({
      [SCENE_TEXT_STORAGE_KEY]: JSON.stringify({
        backgroundColor: '#F3F4F6',
        color: '#172033',
        font: 'mono',
        showBox: false,
        size: 17,
      }),
    })

    expect(loadSceneTextPreferences(storage)).toEqual({
      backgroundColor: '#f3f4f6',
      color: '#172033',
      font: 'mono',
      showBox: false,
      size: 17,
    })
  })

  it('sanitizes malformed values and clamps text size', () => {
    expect(normalizeSceneTextPreferences({
      backgroundColor: 'transparent',
      color: '#123',
      font: 'comic-sans',
      size: 100,
    })).toEqual({
      ...DEFAULT_SCENE_TEXT_PREFERENCES,
      size: MAX_SCENE_TEXT_SIZE,
    })
    expect(normalizeSceneTextPreferences({ size: 1 }).size).toBe(MIN_SCENE_TEXT_SIZE)
    expect(normalizeSceneTextPreferences({ size: '13.6' }).size).toBe(14)
  })

  it('falls back for invalid storage and saves normalized JSON', () => {
    const storage = memoryStorage({ [SCENE_TEXT_STORAGE_KEY]: '{broken' })
    expect(loadSceneTextPreferences(storage)).toEqual(DEFAULT_SCENE_TEXT_PREFERENCES)

    saveSceneTextPreferences(storage, { backgroundColor: '#ABCDEF', color: '#010203', font: 'serif', showBox: true, size: 18 })
    expect(JSON.parse(storage.values.get(SCENE_TEXT_STORAGE_KEY) ?? '')).toEqual({
      backgroundColor: '#abcdef',
      color: '#010203',
      font: 'serif',
      showBox: false,
      size: 18,
    })
  })

  it('provides a CSS family for each unique font choice', () => {
    expect(new Set(sceneTextFonts.map((font) => font.id)).size).toBe(sceneTextFonts.length)
    sceneTextFonts.forEach((font) => expect(sceneTextFontFamily(font.id)).toBe(font.cssFamily))
  })
})
