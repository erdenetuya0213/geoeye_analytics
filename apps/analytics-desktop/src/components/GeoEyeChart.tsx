import { BarChart, BoxplotChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  AriaComponent,
  BrushComponent,
  DataZoomInsideComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  PolarComponent,
  ToolboxComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import { init, use, type EChartsCoreOption, type EChartsType } from 'echarts/core'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Copy, Download, MousePointer2, RotateCcw, Settings2, ZoomIn } from 'lucide-react'
import { chartPng, saveExportFiles } from '../data/exportBundle.js'
import { useChartRegistry } from '../state/ChartRegistryContext.js'
import { useExportTarget } from '../state/ExportContext.js'
import { ExportDialog } from './ExportDialog.js'
import type { ExportFeature, ExportFile } from '../desktop/bridge.js'
import { useChartDesign, useGraphSettings } from '../state/ChartDesignContext.js'
import { useGeoEyeSelection } from '../state/SelectionContext.js'
import { applyChartDesign, chartDesignById, type ChartSurfaceColors } from '../visualization/chartDesigns.js'
import { geoEyeChartColors, geoEyeThemeName } from '../visualization/geoEyeTheme.js'
import { applyGraphSettings } from '../visualization/graphSettings.js'
import { applyViewSettings, chartCsv, nonPositiveCount } from '../visualization/chartBase.js'
import type { ChartKind, ChartSettings } from '../visualization/chartSettings.js'
import { ChartSettingsPanel, type ColorByOption } from './ChartSettingsPanel.js'

use([
  AriaComponent,
  DataZoomInsideComponent,
  GraphicComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  PolarComponent,
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
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
])

type SelectionAction = 'add' | 'none' | 'replace' | 'toggle'
type ExportKind = 'csv' | 'png' | 'svg'
/** Box selection links observations; zoom reads detail. Only one can own the drag. */
type PointerMode = 'select' | 'zoom'

export interface GeoEyeChartProps {
  ariaLabel: string
  brushSelection?: Exclude<SelectionAction, 'toggle'>
  /** Enables the settings popover and decides which groups it offers. */
  chartKind?: ChartKind
  className?: string
  clickSelection?: SelectionAction
  colorByOptions?: readonly ColorByOption[]
  loading?: boolean
  onDatumClick?: (datum: unknown) => void
  onObservationClick?: (sourceObservationIds: readonly string[]) => void
  onObservationSelection?: (sourceObservationIds: readonly string[]) => void
  /** Receives the live chart instance after init (null on dispose). */
  onReady?: (chart: EChartsType | null) => void
  onSettingsChange?: (settings: ChartSettings) => void
  option: EChartsCoreOption
  settings?: ChartSettings
  /** Enables the per-chart ⤓ (transparent PNG) and registers the chart for the page-level Save. */
  exportName?: string
  exportFeature?: ExportFeature
  renderer?: 'canvas' | 'svg'
  /** Keep scientific figure styling (flat marks, exact axes) supplied by the author. */
  publicationStyle?: boolean
  exportFileName?: string
  exportSize?: { width: number; height: number }
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
  if (selectedIds.length === 0) return option
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
  chartKind,
  className = '',
  clickSelection = 'toggle',
  colorByOptions,
  loading = false,
  onDatumClick,
  onObservationClick,
  onObservationSelection,
  onReady,
  onSettingsChange,
  option,
  settings,
  renderer = 'canvas',
  publicationStyle = false,
  exportFileName,
  exportSize,
  exportName,
  exportFeature,
}: GeoEyeChartProps) {
  const registry = useChartRegistry()
  const exportTarget = useExportTarget(exportFeature)
  const graphName = exportName ?? ariaLabel
  const graphSettings = useGraphSettings()
  const [pendingDownload, setPendingDownload] = useState<ExportFile[] | null>(null)
  const [pendingFigure, setPendingFigure] = useState<ExportFile[] | null>(null)
  const [downloadNotice, setDownloadNotice] = useState('')
  const [mode, setMode] = useState<PointerMode>('select')
  const [openMenu, setOpenMenu] = useState<'download' | 'settings' | null>(null)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const designId = useChartDesign()
  const design = chartDesignById(designId)
  const [surfaceColors, setSurfaceColors] = useState<ChartSurfaceColors>()
  const [exporting, setExporting] = useState(false)
  const [exportNotice, setExportNotice] = useState('')
  const { addSelection, replaceSelection, selectedIds, toggleSelection } = useGeoEyeSelection()
  const fallbackSurface = useMemo<ChartSurfaceColors>(() => ({
    grid: design.grid,
    gridStrong: design.gridStrong,
    muted: design.muted,
    surface: design.background,
    text: design.text,
  }), [design])
  const viewOption = useMemo(
    () => settings === undefined ? option : applyViewSettings(option, settings),
    [option, settings],
  )
  const designedOption = useMemo(
    () => publicationStyle ? viewOption : applyGraphSettings(applyChartDesign(viewOption, designId, surfaceColors ?? fallbackSurface), graphSettings),
    [designId, fallbackSurface, graphSettings, publicationStyle, surfaceColors, viewOption],
  )
  const effectiveOption = useMemo(() => selectedOption(designedOption, selectedIds), [designedOption, selectedIds])
  const stableOption = useMemo(() => ({
    ...(effectiveOption as Record<string, unknown>),
    animation: false,
    animationDuration: 0,
    animationDurationUpdate: 0,
    // Wheel zoom and drag pan replace box selection while the chart is in zoom mode.
    ...(mode === 'zoom' ? {
      brush: undefined,
      dataZoom: [
        { filterMode: 'none', moveOnMouseMove: true, type: 'inside', xAxisIndex: 'all', zoomOnMouseWheel: true },
        { filterMode: 'none', moveOnMouseMove: true, type: 'inside', yAxisIndex: 'all', zoomOnMouseWheel: true },
      ],
    } : { dataZoom: undefined }),
  }) as EChartsCoreOption, [effectiveOption, mode])

  const droppedByLog = useMemo(() => {
    if (settings === undefined || (!settings.logX && !settings.logY)) return 0
    return (settings.logX ? nonPositiveCount(option, 'x') : 0) + (settings.logY ? nonPositiveCount(option, 'y') : 0)
  }, [option, settings])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const next = readSurfaceColors(container, fallbackSurface)
    setSurfaceColors((current) => sameSurfaceColors(current, next) ? current : next)
    const shell = container.closest('.app-shell')
    const observer = new MutationObserver(() => {
      const colors = readSurfaceColors(container, fallbackSurface)
      setSurfaceColors(current => sameSurfaceColors(current, colors) ? current : colors)
    })
    if (shell !== null) observer.observe(shell, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [fallbackSurface])

  useEffect(() => {
    const container = containerRef.current
    if (container === null || visible) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '120px' })
    observer.observe(container)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    const container = containerRef.current
    if (container === null || !visible) return undefined
    const chart = init(container, geoEyeThemeName(designId), { renderer })
    chartRef.current = chart
    onReady?.(chart)
    const unregister = registry?.register(graphName, chart)
    const observer = new ResizeObserver(() => {
      if (container.isConnected) chart.resize()
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      unregister?.()
      onReady?.(null)
      chart.dispose()
      chartRef.current = null
    }
  }, [designId, renderer, visible, graphName, registry])

  useEffect(() => {
    const chart = chartRef.current
    if (chart === null) return
    chart.setOption(stableOption, { lazyUpdate: true, notMerge: false, replaceMerge: ['brush', 'dataZoom', 'graphic', 'series'] })
    const optionRecord = stableOption as Record<string, unknown>
    // The global cursor persists once taken, so zoom mode has to hand it back or the brush keeps the drag.
    const brushable = mode === 'select' && typeof optionRecord.brush === 'object' && optionRecord.brush !== null
    chart.dispatchAction({
      brushOption: brushable ? { brushMode: 'single', brushType: 'rect' } : { brushType: false },
      key: 'brush',
      type: 'takeGlobalCursor',
    })
  }, [designId, mode, renderer, stableOption, visible])

  useEffect(() => {
    const chart = chartRef.current
    if (chart === null) return
    if (loading) chart.showLoading('default', { color: design.palette[0], maskColor: 'transparent', textColor: surfaceColors?.muted ?? design.muted })
    else chart.hideLoading()
  }, [designId, design.muted, design.palette, loading, renderer, surfaceColors?.muted, visible])

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
  }, [addSelection, brushSelection, clickSelection, designId, onDatumClick, onObservationClick, onObservationSelection, renderer, replaceSelection, stableOption, toggleSelection, visible])

  // Publication figures: render PNG/SVG at the requested size, then name and save them into <Feature>/export.
  const exportImages = (formats: Array<'png' | 'svg'>) => {
    if (chartRef.current === null || exporting) return
    setExportNotice('')
    const name = exportFileName ?? graphName
    const width = exportSize?.width ?? 1440
    const height = exportSize?.height ?? 900
    // Export the actual current option, including legend state and selection.
    const current = chartRef.current.getOption()
    const exportOption = { ...current, animation: false, tooltip: { show: false }, toolbox: { show: false } }
    setPendingFigure(formats.map((format): ExportFile => {
      const host = document.createElement('div')
      Object.assign(host.style, { position: 'fixed', left: '-100000px', width: `${width}px`, height: `${height}px` })
      document.body.appendChild(host)
      const chart = init(host, undefined, { width, height, renderer: format === 'svg' ? 'svg' : 'canvas' })
      try {
        chart.setOption(exportOption, { notMerge: true, lazyUpdate: false })
        const dataUrl = chart.getDataURL({ type: format, pixelRatio: format === 'png' ? 2 : 1, backgroundColor: String(current.backgroundColor || '#ffffff'), excludeComponents: ['toolbox'] })
        if (format === 'png') return { dataUrl, kind: 'png', name }
        const body = dataUrl.slice(dataUrl.indexOf(',') + 1)
        return { contents: dataUrl.includes(';base64,') ? atob(body) : decodeURIComponent(body), kind: 'svg', name }
      } finally { chart.dispose(); host.remove() }
    }))
  }
  const saveFigure = async (files: ExportFile[], names: string[]) => {
    setPendingFigure(null); setExporting(true)
    try { const result = await saveExportFiles(exportTarget, files.map((file, index) => ({ ...file, name: names[index] ?? file.name }))); setExportNotice(`Saved: ${result.paths.join(' · ')}`) }
    catch (error) { setExportNotice(`Export failed: ${error instanceof Error ? error.message : String(error)}`) }
    finally { setExporting(false) }
  }
  useEffect(() => {
    if (openMenu === null) return undefined
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (toolsRef.current?.contains(target) === true || popoverRef.current?.contains(target) === true) return
      setOpenMenu(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenMenu(null) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [openMenu])

  useLayoutEffect(() => {
    if (openMenu === null) { setAnchor(null); return undefined }
    const update = () => {
      const rect = toolsRef.current?.getBoundingClientRect()
      if (rect !== undefined) setAnchor({ left: rect.right, top: rect.bottom + 6 })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [openMenu])

  /** One SVG of the chart as it stands, matching the transparent background chartPng uses. */
  const chartSvg = () => {
    const chart = chartRef.current
    if (chart === null) return ''
    const host = document.createElement('div')
    Object.assign(host.style, { position: 'fixed', left: '-100000px', width: '640px', height: '420px' })
    document.body.appendChild(host)
    const copy = init(host, undefined, { height: 420, renderer: 'svg', width: 640 })
    try {
      copy.setOption({ ...chart.getOption(), animation: false, backgroundColor: 'transparent', toolbox: { show: false }, tooltip: { show: false } }, { lazyUpdate: false, notMerge: true })
      const dataUrl = copy.getDataURL({ backgroundColor: 'transparent', excludeComponents: ['toolbox'], type: 'svg' })
      const body = dataUrl.slice(dataUrl.indexOf(',') + 1)
      return dataUrl.includes(';base64,') ? atob(body) : decodeURIComponent(body)
    } finally { copy.dispose(); host.remove() }
  }

  const startDownload = (kinds: readonly ExportKind[]) => {
    const chart = chartRef.current
    if (chart === null) return
    setOpenMenu(null)
    setPendingDownload(kinds.map((kind): ExportFile => {
      if (kind === 'png') return { dataUrl: chartPng(chart), kind, name: graphName }
      if (kind === 'svg') return { contents: chartSvg(), kind, name: graphName }
      return { contents: chartCsv(option), kind, name: graphName }
    }))
  }

  const saveDownload = async (files: ExportFile[], names: string[]) => {
    setPendingDownload(null)
    try {
      const result = await saveExportFiles(exportTarget, files.map((file, index) => ({ ...file, name: names[index] ?? file.name })))
      setDownloadNotice(`Saved ${result.paths.join(' · ')}`)
    } catch (error) { setDownloadNotice(`Export failed: ${error instanceof Error ? error.message : String(error)}`) }
    finally { window.setTimeout(() => setDownloadNotice(''), 4000) }
  }

  const copyImage = async () => {
    setOpenMenu(null)
    const chart = chartRef.current
    if (chart === null) return
    try {
      const blob = await (await fetch(chartPng(chart))).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setDownloadNotice('Chart copied.')
    } catch { setDownloadNotice('Copying is not available here; use Download instead.') }
    finally { window.setTimeout(() => setDownloadNotice(''), 4000) }
  }

  const resetView = () => {
    const chart = chartRef.current
    if (chart === null) return
    chart.dispatchAction({ end: 100, start: 0, type: 'dataZoom' })
    chart.dispatchAction({ areas: [], command: 'clear', type: 'brush' })
  }

  const configurable = chartKind !== undefined && settings !== undefined && onSettingsChange !== undefined
  const held = mode === 'zoom' || settings?.logX === true || settings?.logY === true || openMenu !== null
  // The popover is portalled, because every chart card clips its own overflow.
  const popover = (children: React.ReactNode) => anchor === null || typeof document === 'undefined'
    ? null
    : createPortal(
      <div className="geoeye-chart-popover" ref={popoverRef} style={{ left: anchor.left, top: anchor.top }}>{children}</div>,
      document.body,
    )

  const tools = <div className={`geoeye-chart-tools ${held ? 'is-held' : ''}`} onClick={(event) => event.stopPropagation()} ref={toolsRef}>
    <div className="geoeye-chart-tool-group" role="group" aria-label="Pointer mode">
      <button aria-label="Box selection" aria-pressed={mode === 'select'} className={mode === 'select' ? 'is-active' : ''} onClick={() => setMode('select')} title="Box selection" type="button"><MousePointer2 size={13} /></button>
      <button aria-label="Zoom and pan" aria-pressed={mode === 'zoom'} className={mode === 'zoom' ? 'is-active' : ''} onClick={() => setMode('zoom')} title="Zoom and pan (wheel to zoom, drag to pan)" type="button"><ZoomIn size={13} /></button>
      <button aria-label="Reset view" onClick={resetView} title="Reset view" type="button"><RotateCcw size={13} /></button>
    </div>
    {configurable ? <div className="geoeye-chart-tool-group">
      <button aria-label="Log X axis" aria-pressed={settings.logX} className={settings.logX ? 'is-active' : ''} onClick={() => onSettingsChange({ ...settings, logX: !settings.logX })} title="Logarithmic X axis" type="button">log x</button>
      <button aria-label="Log Y axis" aria-pressed={settings.logY} className={settings.logY ? 'is-active' : ''} onClick={() => onSettingsChange({ ...settings, logY: !settings.logY })} title="Logarithmic Y axis" type="button">log y</button>
    </div> : null}
    <div className="geoeye-chart-tool-group">
      {configurable ? <button aria-expanded={openMenu === 'settings'} aria-haspopup="dialog" aria-label="Chart settings" className={openMenu === 'settings' ? 'is-active' : ''} onClick={() => setOpenMenu(openMenu === 'settings' ? null : 'settings')} title="Chart settings" type="button"><Settings2 size={13} /></button> : null}
      <button aria-label="Copy chart" onClick={() => void copyImage()} title="Copy chart image" type="button"><Copy size={13} /></button>
      <button aria-expanded={openMenu === 'download'} aria-haspopup="menu" aria-label={`Download ${graphName}`} className={openMenu === 'download' ? 'is-active' : ''} onClick={() => setOpenMenu(openMenu === 'download' ? null : 'download')} title={`Download to ${exportTarget.folder}/export`} type="button"><Download size={13} /></button>
    </div>
    {droppedByLog === 0 ? null : <span className="geoeye-chart-warning" role="status" title="A logarithmic axis cannot show values of zero or less"><AlertTriangle size={12} /> {droppedByLog.toLocaleString()} hidden</span>}
    {openMenu === 'download' ? popover(<div className="geoeye-chart-menu" role="menu">
      <button onClick={() => startDownload(['png'])} role="menuitem" type="button">PNG image</button>
      <button onClick={() => startDownload(['svg'])} role="menuitem" type="button">SVG image</button>
      <button onClick={() => startDownload(['csv'])} role="menuitem" type="button">CSV values</button>
      <button onClick={() => startDownload(['png', 'svg', 'csv'])} role="menuitem" type="button">All three</button>
    </div>) : null}
    {openMenu === 'settings' && configurable ? popover(<ChartSettingsPanel colorByOptions={colorByOptions} kind={chartKind} onChange={onSettingsChange} settings={settings} />) : null}
  </div>

  if (exportFileName === undefined) return <div className="geoeye-chart-wrap">
    <div aria-label={ariaLabel} className={`geoeye-chart geoeye-chart-${designId} ${className}`.trim()} ref={containerRef} role="img" />
    {tools}
    {downloadNotice ? <span className="chart-download-notice" role="status">{downloadNotice}</span> : null}
    {pendingDownload !== null ? <ExportDialog items={pendingDownload} onCancel={() => setPendingDownload(null)} onConfirm={(names) => { void saveDownload(pendingDownload, names) }} target={exportTarget} title="Download chart" /> : null}
  </div>
  return <div className={`geoeye-chart geoeye-export-chart ${className}`.trim()}>
    <div className="geoeye-export-toolbar" onClick={event => event.stopPropagation()}>
      <span>Export current figure</span>
      <button type="button" disabled={exporting || loading} onClick={() => exportImages(['png'])}>PNG</button>
      <button type="button" disabled={exporting || loading} onClick={() => exportImages(['svg'])}>SVG</button>
      <button type="button" disabled={exporting || loading} onClick={() => exportImages(['png', 'svg'])}>{exporting ? 'Exporting…' : 'PNG + SVG'}</button>
      <span className="geoeye-export-notice" role="status">{exportNotice}</span>
    </div>
    {pendingFigure !== null ? <ExportDialog items={pendingFigure} onCancel={() => setPendingFigure(null)} onConfirm={(names) => { void saveFigure(pendingFigure, names) }} target={exportTarget} title={`Save to export/${exportTarget.folder}`} /> : null}
    <div aria-label={ariaLabel} className={`geoeye-chart-canvas geoeye-chart-${designId}`} ref={containerRef} role="img" />
  </div>
}
