import type { EChartsCoreOption } from 'echarts/core'
import type { PersistentStorage } from '../state/persistentState.js'

/** User graph preferences from Settings → Charts. Applied to every chart on screen and to its exports. */
export interface GraphSettings {
  axisLabels: boolean
  axisLines: boolean
  axisTitles: boolean
  font: GraphFontId
  fontSize: number
  gridLines: boolean
  legend: boolean
}

export const graphFonts = [
  { id: 'app', label: 'Segoe UI (app)', cssFamily: '"Segoe UI Variable Text", "Segoe UI", Tahoma, system-ui, sans-serif' },
  { id: 'arial', label: 'Arial', cssFamily: 'Arial, Helvetica, sans-serif' },
  { id: 'calibri', label: 'Calibri', cssFamily: 'Calibri, Carlito, sans-serif' },
  { id: 'cambria', label: 'Cambria', cssFamily: 'Cambria, Georgia, serif' },
  { id: 'times', label: 'Times New Roman', cssFamily: '"Times New Roman", Times, serif' },
  { id: 'consolas', label: 'Consolas', cssFamily: 'Consolas, "Cascadia Mono", monospace' },
] as const
export type GraphFontId = (typeof graphFonts)[number]['id']

export const GRAPH_SETTINGS_STORAGE_KEY = 'geoeye.analytics.graph-settings.v1'
export const MIN_GRAPH_FONT_SIZE = 8
export const MAX_GRAPH_FONT_SIZE = 24
export const DEFAULT_GRAPH_SETTINGS: GraphSettings = { axisLabels: true, axisLines: true, axisTitles: true, font: 'app', fontSize: 11, gridLines: true, legend: true }

export function normalizeGraphSettings(value: unknown): GraphSettings {
  const input = typeof value === 'object' && value !== null ? value as Partial<GraphSettings> : {}
  const flag = (key: keyof GraphSettings) => typeof input[key] === 'boolean' ? input[key] as boolean : DEFAULT_GRAPH_SETTINGS[key] as boolean
  const size = Number(input.fontSize)
  return {
    axisLabels: flag('axisLabels'), axisLines: flag('axisLines'), axisTitles: flag('axisTitles'), gridLines: flag('gridLines'), legend: flag('legend'),
    font: graphFonts.some((font) => font.id === input.font) ? input.font as GraphFontId : DEFAULT_GRAPH_SETTINGS.font,
    fontSize: Number.isFinite(size) ? Math.min(MAX_GRAPH_FONT_SIZE, Math.max(MIN_GRAPH_FONT_SIZE, Math.round(size))) : DEFAULT_GRAPH_SETTINGS.fontSize,
  }
}

export function loadGraphSettings(storage: Pick<PersistentStorage, 'getItem'>): GraphSettings {
  try { return normalizeGraphSettings(JSON.parse(storage.getItem(GRAPH_SETTINGS_STORAGE_KEY) ?? 'null')) } catch { return { ...DEFAULT_GRAPH_SETTINGS } }
}

export function saveGraphSettings(storage: Pick<PersistentStorage, 'setItem'>, settings: GraphSettings) {
  storage.setItem(GRAPH_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)
const each = (value: unknown, change: (item: Rec) => Rec) => Array.isArray(value) ? value.map((item) => isRec(item) ? change(item) : item) : isRec(value) ? change(value) : value
const hidden = (value: unknown) => ({ ...(isRec(value) ? value : {}), show: false })

export function applyGraphSettings(option: EChartsCoreOption, settings: GraphSettings): EChartsCoreOption {
  const record = option as Rec
  const fontFamily = graphFonts.find((font) => font.id === settings.font)?.cssFamily
  const font = (style: unknown) => ({ ...(isRec(style) ? style : {}), fontFamily, fontSize: settings.fontSize })
  const axis = (item: Rec): Rec => ({
    ...item,
    axisLabel: { ...font(item.axisLabel), show: settings.axisLabels && (!isRec(item.axisLabel) || item.axisLabel.show !== false) },
    axisLine: settings.axisLines ? item.axisLine : hidden(item.axisLine),
    axisTick: settings.axisLines ? item.axisTick : hidden(item.axisTick),
    name: settings.axisTitles ? item.name : '',
    nameTextStyle: font(item.nameTextStyle),
    splitLine: settings.gridLines ? item.splitLine : hidden(item.splitLine),
  })
  return {
    ...record,
    legend: record.legend === undefined ? (settings.legend ? undefined : { show: false }) : each(record.legend, (legend) => settings.legend ? { ...legend, textStyle: font(legend.textStyle) } : { ...legend, show: false }),
    series: each(record.series, (series) => isRec(series.label) ? { ...series, label: font(series.label) } : series),
    textStyle: font(record.textStyle),
    title: each(record.title, (title) => ({ ...title, textStyle: font(title.textStyle) })),
    visualMap: each(record.visualMap, (map) => ({ ...map, textStyle: font(map.textStyle) })),
    xAxis: each(record.xAxis, axis),
    yAxis: each(record.yAxis, axis),
  } as EChartsCoreOption
}
