import { BarChart3, Check, CircleDot, Cuboid, Palette, RotateCcw, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { chartDesigns, type ChartDesignId } from '../visualization/chartDesigns.js'
import { normalizeSceneBackground, sceneBackgroundPresets } from '../visualization/sceneBackgrounds.js'
import {
  DEFAULT_SCENE_TEXT_PREFERENCES,
  MAX_SCENE_TEXT_SIZE,
  MIN_SCENE_TEXT_SIZE,
  sceneTextFontFamily,
  sceneTextFonts,
  type SceneTextFontId,
  type SceneTextPreferences,
} from '../visualization/sceneTextPreferences.js'
import { stereonetThemes, type StereonetThemeId } from '../visualization/stereonetThemes.js'
import { usePersistentState } from '../state/persistentState.js'

type SettingsSection = 'charts' | 'scene3d' | 'stereonet'

interface SettingsDialogProps {
  chartDesign: ChartDesignId
  onChartDesignChange: (design: ChartDesignId) => void
  onClose: () => void
  onSceneBackgroundChange: (color: string) => void
  onSceneTextChange: (preferences: SceneTextPreferences) => void
  onStereonetThemeChange: (theme: StereonetThemeId) => void
  sceneBackground: string
  sceneBackgroundHistory: readonly string[]
  sceneText: SceneTextPreferences
  stereonetTheme: StereonetThemeId
}

function ChartDesignPreview({ design }: { design: (typeof chartDesigns)[number] }) {
  const style = {
    '--preview-background': design.background,
    '--preview-grid': design.grid,
    '--preview-one': design.palette[0],
    '--preview-three': design.palette[2],
    '--preview-two': design.palette[1],
  } as CSSProperties
  return <div aria-hidden="true" className="chart-design-preview" style={style}><div className="chart-design-swatches">{design.palette.map((color) => <b key={color} style={{ backgroundColor: color }} />)}</div><i /><i /><i /><i /><span /></div>
}

function StereonetThemePreview({ theme }: { theme: (typeof stereonetThemes)[number] }) {
  return <div aria-hidden="true" className="stereonet-theme-preview"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" fill="none" r="38" stroke={theme.outline} strokeWidth={theme.outlineWidth * 2.4} /><path d="M29 55C35 37 50 29 68 36C77 40 80 51 74 61C65 76 40 77 29 55Z" fill={theme.densitySpectrum[2]} opacity=".18" /><path d="M38 55C42 44 52 40 63 44C69 48 69 56 64 62C56 69 43 67 38 55Z" fill={theme.densitySpectrum[4]} opacity=".3" /><g fill="none" stroke={theme.grid} strokeWidth={theme.gridWidth * 3.2}><circle cx="50" cy="50" r="13" /><circle cx="50" cy="50" r="25" /><line x1="12" x2="88" y1="50" y2="50" /><line x1="50" x2="50" y1="12" y2="88" /></g><g stroke="var(--foreground)" strokeWidth="1.3"><circle cx="39" cy="31" fill={theme.pointPalette[0]} r={3.3 * theme.pointScale} /><circle cx="64" cy="43" fill={theme.pointPalette[1]} r={3.3 * theme.pointScale} /><circle cx="48" cy="66" fill={theme.pointPalette[2]} r={3.3 * theme.pointScale} /><circle cx="72" cy="66" fill={theme.pointPalette[3]} r={3.3 * theme.pointScale} /></g><text fill={theme.labelColor} fontSize="7" fontWeight="700" textAnchor="middle" x="50" y="8">N</text></svg></div>
}

function swatchForeground(color: string) {
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  return red * .299 + green * .587 + blue * .114 > 160 ? '#111827' : '#ffffff'
}

function SceneBackgroundSwatch({ color, label, onSelect, selected }: { color: string; label: string; onSelect: (color: string) => void; selected: boolean }) {
  return <button aria-checked={selected} aria-label={label} className={selected ? 'is-selected' : ''} onClick={() => onSelect(color)} role="radio" style={{ backgroundColor: color, color: swatchForeground(color) }} title={`${label} · ${color.toUpperCase()}`} type="button">{selected ? <Check size={13} /> : null}</button>
}

const sceneTextColorPresets = [
  { color: '#ffffff', label: 'White' },
  { color: '#111827', label: 'Black' },
  { color: '#e8f0ed', label: 'Pale mineral' },
  { color: '#ef4444', label: 'Red' },
  { color: '#f59e0b', label: 'Amber' },
  { color: '#22c55e', label: 'Green' },
  { color: '#38bdf8', label: 'Blue' },
] as const

function SceneTextColorControl({ label, onChange, value }: { label: string; onChange: (color: string) => void; value: string }) {
  return <div className="scene-text-colour-control">
    <span>{label}</span>
    <div className="scene-text-colour-value">
      <input aria-label={`Choose custom ${label.toLowerCase()}`} onChange={(event) => onChange(event.target.value)} title={`Choose custom ${label.toLowerCase()}`} type="color" value={value} />
      <output>{value.toUpperCase()}</output>
    </div>
    <div aria-label={`${label} presets`} className="scene-text-colour-presets" role="radiogroup">{sceneTextColorPresets.map((preset) => <button aria-checked={value === preset.color} aria-label={preset.label} className={value === preset.color ? 'is-selected' : ''} key={preset.color} onClick={() => onChange(preset.color)} role="radio" style={{ backgroundColor: preset.color }} title={`${preset.label} · ${preset.color.toUpperCase()}`} type="button">{value === preset.color ? <Check color={swatchForeground(preset.color)} size={12} /> : null}</button>)}</div>
  </div>
}

function SceneTextPreview({ backgroundColor, preferences }: { backgroundColor: string; preferences: SceneTextPreferences }) {
  const style = {
    '--scene-text-background': 'transparent',
    '--scene-text-color': preferences.color,
    '--scene-text-font': sceneTextFontFamily(preferences.font),
    '--scene-text-size': `${preferences.size}px`,
    backgroundColor,
  } as CSSProperties
  return <div aria-hidden="true" className="scene-text-preview" data-text-box="false" style={style}>
    <i /><i /><i />
    <span className="is-hole">DH-001</span>
    <span className="is-depth">−164.8 m</span>
    <span className="is-axis">498 X</span>
  </div>
}

export function SettingsDialog({
  chartDesign,
  onChartDesignChange,
  onClose,
  onSceneBackgroundChange,
  onSceneTextChange,
  onStereonetThemeChange,
  sceneBackground,
  sceneBackgroundHistory,
  sceneText,
  stereonetTheme,
}: SettingsDialogProps) {
  const [section, setSection] = usePersistentState<SettingsSection>('settings.section', 'charts')
  const [sceneColorDraft, setSceneColorDraft] = useState(sceneBackground.toUpperCase())
  const presetColors = new Set(sceneBackgroundHistory)
  const unusedPresets = sceneBackgroundPresets.filter((preset) => !presetColors.has(preset.color))

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  useEffect(() => {
    setSceneColorDraft(sceneBackground.toUpperCase())
  }, [sceneBackground])

  const changeSceneColor = (color: string) => {
    const normalized = normalizeSceneBackground(color)
    if (normalized === null) return
    setSceneColorDraft(normalized.toUpperCase())
    onSceneBackgroundChange(normalized)
  }
  const changeSceneText = (change: Partial<SceneTextPreferences>) => {
    onSceneTextChange({ ...sceneText, ...change })
  }
  const sceneColorDraftIsValid = normalizeSceneBackground(sceneColorDraft) !== null

  return <div className="dialog-backdrop settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} role="presentation">
    <section aria-labelledby="settings-title" aria-modal="true" className="settings-dialog" role="dialog">
      <header className="settings-dialog-header"><div className="settings-dialog-icon"><Palette size={18} /></div><div><p className="eyebrow">Preferences</p><h2 id="settings-title">Settings</h2></div><button aria-label="Close settings" className="icon-button" onClick={onClose} type="button"><X size={18} /></button></header>
      <div className="settings-dialog-body">
        <nav aria-label="Settings sections"><button aria-current={section === 'charts' ? 'page' : undefined} className={section === 'charts' ? 'is-active' : ''} onClick={() => setSection('charts')} type="button"><BarChart3 size={16} /><span><strong>Charts</strong></span></button><button aria-current={section === 'scene3d' ? 'page' : undefined} className={section === 'scene3d' ? 'is-active' : ''} onClick={() => setSection('scene3d')} type="button"><Cuboid size={16} /><span><strong>3D scene</strong></span></button><button aria-current={section === 'stereonet' ? 'page' : undefined} className={section === 'stereonet' ? 'is-active' : ''} onClick={() => setSection('stereonet')} type="button"><CircleDot size={16} /><span><strong>Stereonet</strong></span></button></nav>
        {section === 'charts' ? <div className="settings-content"><div className="settings-section-heading"><div><h3>Chart design</h3></div></div>
          <div aria-label="Chart design" className="chart-design-grid" role="radiogroup">{chartDesigns.map((design) => { const selected = design.id === chartDesign; return <button aria-checked={selected} className={selected ? 'is-selected' : ''} key={design.id} onClick={() => onChartDesignChange(design.id)} role="radio" type="button"><ChartDesignPreview design={design} /><span><strong>{design.label}</strong></span>{selected ? <em><Check size={12} /> Active</em> : null}</button> })}</div>
        </div> : null}
        {section === 'scene3d' ? <div className="settings-content"><div className="settings-section-heading"><div><h3>3D scene</h3><p>Choose the canvas and screen-text appearance.</p></div></div>
          <div className="scene-settings-stack">
            <section className="scene-setting-group"><header><div><h4>Background</h4><p>Canvas colour used by every 3D viewport.</p></div></header>
              <div className="scene-background-preference"><div aria-hidden="true" className="scene-background-preview" style={{ backgroundColor: sceneBackground }}><i /><i /><i /></div><div className="scene-background-options"><div className="scene-custom-color"><div><strong>Custom colour</strong><label className="scene-color-well"><span className="sr-only">Open 3D scene background colour picker</span><input aria-label="Open 3D scene background colour picker" onChange={(event) => changeSceneColor(event.target.value)} type="color" value={sceneBackground} /></label></div><label className="scene-color-hex"><span>Hex value</span><input aria-invalid={!sceneColorDraftIsValid} maxLength={7} onBlur={() => { if (!sceneColorDraftIsValid) setSceneColorDraft(sceneBackground.toUpperCase()) }} onChange={(event) => { const value = event.target.value.toUpperCase(); setSceneColorDraft(value); if (normalizeSceneBackground(value) !== null) onSceneBackgroundChange(value) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} spellCheck={false} value={sceneColorDraft} /></label></div><div aria-label="3D scene background colours" className="scene-background-color-groups" role="radiogroup"><section><header><h4>Recent colours</h4><span>Newest first</span></header><div className="scene-background-presets">{sceneBackgroundHistory.map((color) => <SceneBackgroundSwatch color={color} key={color} label={`Recently used ${color.toUpperCase()}`} onSelect={changeSceneColor} selected={color === sceneBackground} />)}</div></section><section><header><h4>Rich palette</h4><span>{unusedPresets.length} colours</span></header><div className="scene-background-presets">{unusedPresets.map((preset) => <SceneBackgroundSwatch color={preset.color} key={preset.color} label={preset.label} onSelect={changeSceneColor} selected={preset.color === sceneBackground} />)}</div></section></div></div></div>
            </section>
            <section className="scene-setting-group"><header><div><h4>Screen text</h4><p>Labels for drillholes, selected intervals, and scene axes.</p></div><button className="scene-setting-reset" onClick={() => onSceneTextChange({ ...DEFAULT_SCENE_TEXT_PREFERENCES })} type="button"><RotateCcw size={13} /> Reset</button></header>
              <div className="scene-text-preference">
                <SceneTextPreview backgroundColor={sceneBackground} preferences={sceneText} />
                <div className="scene-text-options">
                  <label><span>Font</span><select aria-label="Screen text font" onChange={(event) => changeSceneText({ font: event.target.value as SceneTextFontId })} value={sceneText.font}>{sceneTextFonts.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}</select></label>
                  <label className="scene-text-size"><span>Size</span><div><input aria-label="Screen text size" max={MAX_SCENE_TEXT_SIZE} min={MIN_SCENE_TEXT_SIZE} onChange={(event) => changeSceneText({ size: Number(event.target.value) })} step="1" type="range" value={sceneText.size} /><output>{sceneText.size} px</output></div></label>
                  <div className="scene-text-colours">
                    <SceneTextColorControl label="Screen text colour" onChange={(color) => changeSceneText({ color })} value={sceneText.color} />
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div> : null}
        {section === 'stereonet' ? <div className="settings-content"><div className="settings-section-heading"><div><h3>Stereonet design</h3></div></div>
          <div aria-label="Stereonet design" className="chart-design-grid stereonet-theme-grid" role="radiogroup">{stereonetThemes.map((theme) => { const selected = theme.id === stereonetTheme; return <button aria-checked={selected} className={selected ? 'is-selected' : ''} key={theme.id} onClick={() => onStereonetThemeChange(theme.id)} role="radio" type="button"><StereonetThemePreview theme={theme} /><span><strong>{theme.label}</strong></span>{selected ? <em><Check size={12} /> Active</em> : null}</button> })}</div>
        </div> : null}
      </div>
      <footer className="settings-dialog-footer"><button className="button button-primary" onClick={onClose} type="button">Done</button></footer>
    </section>
  </div>
}
