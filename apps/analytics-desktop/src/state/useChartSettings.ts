import { useCallback, useMemo } from 'react'
import { chartSettingsDelta, chartSettingsFor, type ChartKind, type ChartSettings } from '../visualization/chartSettings.js'
import { usePersistentState } from './persistentState.js'

export interface ChartSettingsBinding {
  chartKind: ChartKind
  onSettingsChange: (settings: ChartSettings) => void
  settings: ChartSettings
}

/**
 * Chart settings that survive navigation and reload, shaped so the result spreads straight into
 * GeoEyeChart. One binding can drive a detail chart and its facets, which keeps a facet grid on
 * the same axes and statistics as the chart it was opened from.
 */
export function useChartSettings(kind: ChartKind, key: string): ChartSettingsBinding {
  const [saved, setSaved] = usePersistentState<Partial<ChartSettings>>(`chart.${key}`, {})
  const settings = useMemo(() => chartSettingsFor(kind, saved), [kind, saved])
  const onSettingsChange = useCallback((next: ChartSettings) => setSaved(chartSettingsDelta(kind, next)), [kind, setSaved])
  return { chartKind: kind, onSettingsChange, settings }
}
