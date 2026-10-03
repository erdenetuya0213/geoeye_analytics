import { registerTheme } from 'echarts/core'
import { chartDesigns, type ChartDesignId } from './chartDesigns.js'

export const GEOEYE_THEME_NAME = 'geoeye-analytical'
export const GEOEYE_LINE_SMOOTHING = 0.35

export function geoEyeThemeName(designId: ChartDesignId) {
  return `geoeye-${designId}`
}

export const geoEyeChartColors = {
  accent: '#d08745',
  blue: '#3f7f9f',
  danger: '#b25f68',
  grid: '#e7ecef',
  gridStrong: '#cfd8dd',
  muted: '#6b7b84',
  primary: '#17766f',
  primarySoft: '#d9ece9',
  selected: '#f09a4a',
  surface: '#ffffff',
  text: '#23343d',
  violet: '#7164a7',
} as const

function createGeoEyeTheme(design: (typeof chartDesigns)[number]) {
  return {
  animationDuration: 360,
  animationDurationUpdate: 220,
  animationEasing: 'cubicOut',
  animationEasingUpdate: 'cubicOut',
  backgroundColor: 'transparent',
  color: [...design.palette],
  bar: {
    barMaxWidth: 42,
    itemStyle: { borderRadius: [6, 6, 2, 2] },
  },
  categoryAxis: {
    axisLabel: { color: design.muted, fontSize: 11, margin: 12 },
    axisLine: { lineStyle: { color: design.gridStrong, width: 1 } },
    axisTick: { show: false },
    nameTextStyle: { color: design.text, fontSize: 11, fontWeight: 500 },
    splitLine: { show: false },
  },
  legend: {
    icon: 'roundRect',
    itemGap: 18,
    itemHeight: 8,
    itemWidth: 12,
    pageIconColor: design.palette[0],
    pageTextStyle: { color: design.muted },
    textStyle: { color: design.muted, fontSize: 11, fontWeight: 500 },
  },
  line: {
    lineStyle: { cap: 'round', join: 'round', width: 2.6 },
    symbol: 'circle',
    symbolSize: 7,
  },
  scatter: {
    itemStyle: { borderColor: '#ffffff', borderWidth: 1 },
  },
  textStyle: {
    color: design.text,
    // Match the UI face used by Statistics Summary and the rest of the shell.
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", Tahoma, system-ui, sans-serif',
    fontSize: 12,
  },
  timeAxis: {
    axisLabel: { color: design.muted, fontSize: 11, margin: 12 },
    axisLine: { lineStyle: { color: design.gridStrong } },
    axisTick: { show: false },
    nameTextStyle: { color: design.text, fontSize: 11, fontWeight: 500 },
    splitLine: { lineStyle: { color: design.grid, width: 1 } },
  },
  tooltip: {
    backgroundColor: design.tooltip,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    extraCssText: 'border-radius:8px;box-shadow:0 10px 28px rgba(20,32,38,.22);padding:9px 11px;',
    textStyle: { color: '#f5f7f7', fontSize: 11, lineHeight: 18 },
  },
  valueAxis: {
    axisLabel: { color: design.muted, fontSize: 11, margin: 10 },
    axisLine: { lineStyle: { color: design.gridStrong } },
    axisTick: { show: false },
    nameTextStyle: { color: design.text, fontSize: 11, fontWeight: 500 },
    splitLine: { lineStyle: { color: design.grid, width: 1 } },
  },
}
}

chartDesigns.forEach((design) => registerTheme(geoEyeThemeName(design.id), createGeoEyeTheme(design)))
