import { BarChart, BoxplotChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  AriaComponent,
  BrushComponent,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import { init, use, type EChartsCoreOption, type EChartsType } from 'echarts/core'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useChartDesign } from '../state/ChartDesignContext.js'
import { useGeoEyeSelection } from '../state/SelectionContext.js'
import { applyChartDesign, chartDesignById, type ChartSurfaceColors } from '../visualization/chartDesigns.js'
import { geoEyeChartColors, geoEyeThemeName } from '../visualization/geoEyeTheme.js'

use([
  AriaComponent,
  BarChart,
  BoxplotChart,
  BrushComponent,
  CanvasRenderer,
  GridComponent,
  HeatmapChart,
  LegendComponent,
  LineChart,
  ScatterChart,
  SVGRenderer,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
])

type SelectionAction = 'add' | 'none' | 'replace' | 'toggle'

export interface GeoEyeChartProps {
  ariaLabel: string
  brushSelection?: Exclude<SelectionAction, 'toggle'>
  className?: string
  clickSelection?: SelectionAction
  loading?: boolean
  onDatumClick?: (datum: unknown) => void
  onObservationClick?: (sourceObservationIds: readonly string[]) => void
  onObservationSelection?: (sourceObservationIds: readonly string[]) => void
  option: EChartsCoreOption
  renderer?: 'canvas' | 'svg'
}

interface SourceDatum {
  itemStyle?: Record<string, unknown>
  sourceObservationIds: string[]
  symbolSize?: number
  value?: unknown
}

interface BrushSelectedEvent {
  batch?: Array<{
    selected?: Array<{
      dataIndex?: number[]
      seriesIndex?: number
    }>
  }>
}

function isSourceDatum(value: unknown): value is SourceDatum {
  if (typeof value !== 'object' || value === null || !('sourceObservationIds' in value)) return false
  return Array.isArray(value.sourceObservationIds)
    && value.sourceObservationIds.every((id) => typeof id === 'string')
}

export function sourceObservationIdsFromDatum(value: unknown): string[] {
  return isSourceDatum(value) ? value.sourceObservationIds : []
}

function selectedOption(option: EChartsCoreOption, selectedIds: readonly string[]): EChartsCoreOption {
  const selected = new Set(selectedIds)
  const optionRecord = option as Record<string, unknown>
  const series = Array.isArray(optionRecord.series) ? optionRecord.series : []
  return {
    ...optionRecord,
    series: series.map((candidate) => {
      if (typeof candidate !== 'object' || candidate === null) return candidate
      const seriesRecord = candidate as Record<string, unknown>
      if (!Array.isArray(seriesRecord.data)) return candidate
      return {
        ...seriesRecord,
        data: seriesRecord.data.map((item) => {
          if (!isSourceDatum(item)) return item
          const isSelected = item.sourceObservationIds.some((id) => selected.has(id))
          if (!isSelected) return item
          return {
            ...item,
            itemStyle: {
              ...item.itemStyle,
              borderColor: geoEyeChartColors.selected,
              borderWidth: 2.5,
              shadowBlur: 5,
              shadowColor: 'rgba(237, 138, 59, 0.52)',
            },
            symbolSize: Math.max(item.symbolSize ?? 0, 10),
          }
        }),
      }
    }),
  } as EChartsCoreOption
}

function idsFromBrush(event: BrushSelectedEvent, option: EChartsCoreOption) {
  const optionRecord = option as Record<string, unknown>
  const series = Array.isArray(optionRecord.series) ? optionRecord.series : []
  const ids = event.batch?.flatMap((batch) => batch.selected?.flatMap((selection) => {
    const seriesIndex = selection.seriesIndex
    if (seriesIndex === undefined) return []
    const selectedSeries = series[seriesIndex]
    if (typeof selectedSeries !== 'object' || selectedSeries === null) return []
    const data = (selectedSeries as Record<string, unknown>).data
    if (!Array.isArray(data)) return []
    return (selection.dataIndex ?? []).flatMap((index) => sourceObservationIdsFromDatum(data[index]))
  }) ?? []) ?? []
  return Array.from(new Set(ids))
}

function resolveCssColor(container: HTMLElement, value: string, fallback: string) {
  const probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.color = value
  probe.style.position = 'absolute'
  probe.style.pointerEvents = 'none'
  probe.style.visibility = 'hidden'
  container.appendChild(probe)
  const resolved = window.getComputedStyle(probe).color
  probe.remove()
  return resolved === '' ? fallback : normalizeCssColor(resolved, fallback)
}

function normalizeCssColor(value: string, fallback: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return fallback
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [red = 0, green = 0, blue = 0, alpha = 255] = context.getImageData(0, 0, 1, 1).data
  return alpha === 255
    ? `rgb(${red}, ${green}, ${blue})`
    : `rgba(${red}, ${green}, ${blue}, ${(alpha / 255).toFixed(3)})`
}

function nearestSurfaceColor(container: HTMLElement, fallback: string) {
  let current: HTMLElement | null = container
  while (current !== null) {
    const background = normalizeCssColor(window.getComputedStyle(current).backgroundColor, 'rgba(0, 0, 0, 0)')
    if (!background.endsWith(', 0.000)')) return background
    current = current.parentElement
  }
  return fallback
}

function readSurfaceColors(container: HTMLElement, fallback: ChartSurfaceColors): ChartSurfaceColors {
  return {
    grid: resolveCssColor(container, 'color-mix(in srgb, var(--foreground) 18%, transparent)', fallback.grid),
    gridStrong: resolveCssColor(container, 'color-mix(in srgb, var(--foreground) 38%, transparent)', fallback.gridStrong),
    muted: resolveCssColor(container, 'color-mix(in srgb, var(--foreground) 76%, transparent)', fallback.muted),
    surface: nearestSurfaceColor(container, fallback.surface),
    text: normalizeCssColor(window.getComputedStyle(container).color, fallback.text),
  }
}

function sameSurfaceColors(left: ChartSurfaceColors | undefined, right: ChartSurfaceColors) {
  return left !== undefined
    && left.grid === right.grid
    && left.gridStrong === right.gridStrong
    && left.muted === right.muted
    && left.surface === right.surface
    && left.text === right.text
}

export function GeoEyeChart({
  ariaLabel,
  brushSelection = 'replace',
  className = '',
  clickSelection = 'toggle',
  loading = false,
  onDatumClick,
  onObservationClick,
  onObservationSelection,
  option,
  renderer = 'canvas',
}: GeoEyeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const designId = useChartDesign()
  const design = chartDesignById(designId)
  const [surfaceColors, setSurfaceColors] = useState<ChartSurfaceColors>()
  const { addSelection, replaceSelection, selectedIds, toggleSelection } = useGeoEyeSelection()
  const fallbackSurface = useMemo<ChartSurfaceColors>(() => ({
    grid: design.grid,
    gridStrong: design.gridStrong,
    muted: design.muted,
    surface: design.background,
    text: design.text,
  }), [design])
  const designedOption = useMemo(
    () => applyChartDesign(option, designId, surfaceColors ?? fallbackSurface),
    [designId, fallbackSurface, option, surfaceColors],
  )
  const effectiveOption = useMemo(() => selectedOption(designedOption, selectedIds), [designedOption, selectedIds])
  const stableOption = useMemo(() => ({
    ...(effectiveOption as Record<string, unknown>),
    animation: false,
    animationDuration: 0,
    animationDurationUpdate: 0,
  }) as EChartsCoreOption, [effectiveOption])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const next = readSurfaceColors(container, fallbackSurface)
    setSurfaceColors((current) => sameSurfaceColors(current, next) ? current : next)
  })

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return undefined
    const chart = init(container, geoEyeThemeName(designId), { renderer })
    chartRef.current = chart
    const observer = new ResizeObserver(() => {
      if (container.isConnected) chart.resize()
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [designId, renderer])

  useEffect(() => {
    const chart = chartRef.current
    if (chart === null) return
    chart.setOption(stableOption, { lazyUpdate: true, notMerge: false, replaceMerge: ['series'] })
    const optionRecord = stableOption as Record<string, unknown>
    if (typeof optionRecord.brush === 'object' && optionRecord.brush !== null) {
      chart.dispatchAction({
        brushOption: { brushMode: 'single', brushType: 'rect' },
        key: 'brush',
        type: 'takeGlobalCursor',
      })
    }
  }, [stableOption])

  useEffect(() => {
    const chart = chartRef.current
    if (chart === null) return
    if (loading) chart.showLoading('default', { color: design.palette[0], maskColor: 'transparent', textColor: surfaceColors?.muted ?? design.muted })
    else chart.hideLoading()
  }, [design.muted, design.palette, loading, surfaceColors?.muted])

  useEffect(() => {
    const chart = chartRef.current
    if (chart === null) return undefined
    const select = (ids: readonly string[], action: SelectionAction) => {
      if (action === 'replace') replaceSelection(ids)
      else if (action === 'add') addSelection(ids)
      else if (action === 'toggle') toggleSelection(ids)
    }
    const handleClick = (event: unknown) => {
      if (typeof event !== 'object' || event === null || !('data' in event)) return
      onDatumClick?.(event.data)
      const ids = sourceObservationIdsFromDatum(event.data)
      if (ids.length === 0) return
      select(ids, clickSelection)
      onObservationClick?.(ids)
    }
    const handleBrush = (event: unknown) => {
      const ids = idsFromBrush(event as BrushSelectedEvent, stableOption)
      select(ids, brushSelection)
      onObservationSelection?.(ids)
    }
    chart.on('click', handleClick)
    chart.on('brushselected', handleBrush)
    return () => {
      chart.off('click', handleClick)
      chart.off('brushselected', handleBrush)
    }
  }, [addSelection, brushSelection, clickSelection, onDatumClick, onObservationClick, onObservationSelection, replaceSelection, stableOption, toggleSelection])

  return <div aria-label={ariaLabel} className={`geoeye-chart geoeye-chart-${designId} ${className}`.trim()} ref={containerRef} role="img" />
}
