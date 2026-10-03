import { describe, expect, it } from 'vitest'
import { DEFAULT_STEREONET_THEME, isStereonetThemeId, stereonetThemeById, stereonetThemes } from './stereonetThemes.js'

describe('GeoEye stereonet themes', () => {
  it('exposes unique persistent theme identifiers', () => {
    expect(stereonetThemes).toHaveLength(8)
    expect(new Set(stereonetThemes.map((theme) => theme.id))).toHaveProperty('size', 8)
    expect(isStereonetThemeId(DEFAULT_STEREONET_THEME)).toBe(true)
    expect(isStereonetThemeId('unknown')).toBe(false)
  })

  it('provides complete presentation colors for every preset', () => {
    stereonetThemes.forEach((theme) => {
      expect(theme.surface).toBe('transparent')
      expect(theme.grid).toMatch(/^#[0-9a-f]{6}$/i)
      expect(theme.gridStrong).toMatch(/^#[0-9a-f]{6}$/i)
      expect(theme.outline).toMatch(/^#[0-9a-f]{6}$/i)
      expect(theme.labelColor).toMatch(/^#[0-9a-f]{6}$/i)
      expect(theme.pointHalo).toMatch(/^#[0-9a-f]{6}$/i)
      expect(theme.selected).toMatch(/^#[0-9a-f]{6}$/i)
      expect(theme.pointPalette.length).toBeGreaterThanOrEqual(5)
      expect(theme.densityGeoeye.length).toBeGreaterThanOrEqual(6)
      expect(theme.densitySpectrum.length).toBeGreaterThanOrEqual(6)
      expect(theme.pointScale).toBeGreaterThan(0)
      expect(theme.lineScale).toBeGreaterThan(0)
      expect(theme.gridWidth).toBeGreaterThan(0)
      expect(theme.gridStrongWidth).toBeGreaterThan(theme.gridWidth)
      expect(theme.outlineWidth).toBeGreaterThan(theme.gridWidth)
    })
    expect(stereonetThemeById('survey-blueprint').label).toBe('Survey blueprint')
  })
})
