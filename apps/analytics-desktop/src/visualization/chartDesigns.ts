import type { EChartsCoreOption } from 'echarts/core'

export const chartDesigns = [
  {
    background: '#ffffff',
    boxFill: '#d9ece9',
    description: 'Quiet grids, restrained teal and blue, optimized for detailed analysis.',
    diverging: ['#bd6c75', '#f3f5f4', '#17766f'],
    grid: '#e7ecef',
    gridStrong: '#cfd8dd',
    id: 'analytical',
    label: 'Analytical',
    mode: 'light',
    muted: '#6b7b84',
    palette: ['#17766f', '#3f7f9f', '#d08745', '#7164a7', '#759b78', '#b56c86'],
    text: '#23343d',
    tooltip: 'rgba(25, 37, 44, 0.96)',
  },
  {
    background: '#fffefd',
    boxFill: '#dff1ed',
    description: 'Presentation-ready color with clearer separation between analytical series.',
    diverging: ['#e76f51', '#fff7e6', '#138a7e'],
    grid: '#ece7df',
    gridStrong: '#d6cec2',
    id: 'executive',
    label: 'Executive color',
    mode: 'light',
    muted: '#6b7280',
    palette: ['#138a7e', '#e9ad3f', '#e76f51', '#315c75', '#7b61a8', '#77a66a'],
    text: '#263238',
    tooltip: 'rgba(29, 36, 40, 0.96)',
  },
  {
    background: '#090d12',
    boxFill: '#153a42',
    description: 'Maximum-separation cyan, magenta, amber, green, violet, and orange for presentations.',
    diverging: ['#ff3d9a', '#17202a', '#00e5ff'],
    grid: '#273442',
    gridStrong: '#5d6b78',
    id: 'high-contrast',
    label: 'High contrast',
    mode: 'dark',
    muted: '#c0cad4',
    palette: ['#00e5ff', '#ff3d9a', '#ffd43b', '#64e572', '#a78bfa', '#ff7a45'],
    text: '#ffffff',
    tooltip: 'rgba(4, 8, 13, 0.98)',
  },
  {
    background: '#fffdf8',
    boxFill: '#ffedbd',
    description: 'Ink-black foundations with amber and cobalt accents for decisive comparisons.',
    diverging: ['#111827', '#f7f0df', '#f59e0b'],
    grid: '#eee8dc',
    gridStrong: '#d2c8b8',
    id: 'obsidian-amber',
    label: 'Obsidian amber',
    mode: 'light',
    muted: '#687078',
    palette: ['#111827', '#f59e0b', '#fbbf24', '#334155', '#2563eb', '#94a3b8'],
    text: '#1b252d',
    tooltip: 'rgba(12, 17, 24, 0.97)',
  },
  {
    background: '#fbfeff',
    boxFill: '#cceff6',
    description: 'A deep navy-to-cyan family for technical, continuous, and spatial analyses.',
    diverging: ['#071a52', '#eefafd', '#00a8cc'],
    grid: '#e1eef3',
    gridStrong: '#c4dbe4',
    id: 'ocean-depths',
    label: 'Ocean depths',
    mode: 'light',
    muted: '#5e7480',
    palette: ['#071a52', '#0b3c91', '#0066b3', '#0099cc', '#36c5dc', '#89deef'],
    text: '#152c38',
    tooltip: 'rgba(5, 25, 48, 0.97)',
  },
  {
    background: '#fffaff',
    boxFill: '#ead6fa',
    description: 'High-energy magenta, violet, and electric blue for categorical separation.',
    diverging: ['#df087f', '#f7edf9', '#2458d3'],
    grid: '#ece4f0',
    gridStrong: '#d8c9df',
    id: 'violet-surge',
    label: 'Violet surge',
    mode: 'light',
    muted: '#746779',
    palette: ['#df087f', '#a21caf', '#6d28d9', '#3949c6', '#1686d9', '#52bfea'],
    text: '#30263a',
    tooltip: 'rgba(35, 17, 49, 0.97)',
  },
  {
    background: '#fffdf8',
    boxFill: '#f6d9cd',
    description: 'Crimson, terracotta, cream, and marine blue with an editorial character.',
    diverging: ['#b20d30', '#f6f0df', '#315f78'],
    grid: '#ece5da',
    gridStrong: '#d3c8b7',
    id: 'editorial-warm',
    label: 'Editorial warm',
    mode: 'light',
    muted: '#736b61',
    palette: ['#b20d30', '#d6402d', '#e98b4a', '#b9a98e', '#16324f', '#547d95'],
    text: '#302a26',
    tooltip: 'rgba(36, 29, 26, 0.97)',
  },
  {
    background: '#fbfcfd',
    boxFill: '#dce3e9',
    description: 'Layered charcoal, navy, and steel tones for understated technical reporting.',
    diverging: ['#172a3a', '#f0f3f5', '#73879a'],
    grid: '#e3e8eb',
    gridStrong: '#c6d0d5',
    id: 'arctic-slate',
    label: 'Arctic slate',
    mode: 'light',
    muted: '#64727b',
    palette: ['#172a3a', '#2f455c', '#536878', '#73879a', '#9aa8b6', '#c0cad2'],
    text: '#1d2a31',
    tooltip: 'rgba(18, 31, 40, 0.97)',
  },
  {
    background: '#fbfffd',
    boxFill: '#ccefdc',
    description: 'Mineral teal through fresh green for environmental and geological populations.',
    diverging: ['#174f57', '#eefbf5', '#65c18c'],
    grid: '#e0eee8',
    gridStrong: '#bfd8cc',
    id: 'viridian',
    label: 'Viridian',
    mode: 'light',
    muted: '#5d756b',
    palette: ['#174f57', '#147d78', '#2ca58d', '#65c18c', '#98e3a4', '#bcefc3'],
    text: '#1d342c',
    tooltip: 'rgba(17, 47, 43, 0.97)',
  },
  {
    background: '#fffdfd',
    boxFill: '#eadde5',
    description: 'Soft slate, rose, and periwinkle for calm reports and dense small multiples.',
    diverging: ['#8792a9', '#fbf3f5', '#aab9e8'],
    grid: '#ece8ec',
    gridStrong: '#d7cfd7',
    id: 'mineral-pastel',
    label: 'Mineral pastel',
    mode: 'light',
    muted: '#756f78',
    palette: ['#69758d', '#929bb0', '#c7a8b7', '#e5c4ce', '#9ba9d8', '#c9d2f2'],
    text: '#34313a',
    tooltip: 'rgba(40, 37, 46, 0.97)',
  },
  {
    background: '#fffdf8',
    boxFill: '#f6d38c',
    description: 'Deep teal, gold, orange, and oxide red inspired by alteration and core logs.',
    diverging: ['#9e1b1b', '#f7edcf', '#006b6b'],
    grid: '#ece7dc',
    gridStrong: '#d5c9b5',
    id: 'core-heat',
    label: 'Core heat',
    mode: 'light',
    muted: '#71695e',
    palette: ['#005f61', '#008c8c', '#e0a526', '#e67e22', '#d1491b', '#9e1b1b'],
    text: '#302b24',
    tooltip: 'rgba(37, 28, 20, 0.97)',
  },
  {
    background: '#fffaf4',
    boxFill: '#f2c79f',
    description: 'Midnight navy, burnished copper, gold, and ice blue for premium technical reporting.',
    diverging: ['#c44d2d', '#f8ead7', '#164e63'],
    grid: '#eee3d8',
    gridStrong: '#d4c2b2',
    id: 'midnight-copper',
    label: 'Midnight copper',
    mode: 'light',
    muted: '#756a62',
    palette: ['#101b2d', '#c44d2d', '#e6a23c', '#164e63', '#4f8ca6', '#8b6f47'],
    text: '#29231f',
    tooltip: 'rgba(14, 24, 39, 0.97)',
  },
  {
    background: '#0b1324',
    boxFill: '#144a54',
    description: 'Deep-space canvas with aurora cyan, emerald, violet, and lime signal colors.',
    diverging: ['#a855f7', '#15233a', '#2dd4bf'],
    grid: '#1e2d46',
    gridStrong: '#344663',
    id: 'aurora-borealis',
    label: 'Aurora borealis',
    mode: 'dark',
    muted: '#9fb2c8',
    palette: ['#22d3ee', '#2dd4bf', '#84cc16', '#8b5cf6', '#ec4899', '#fbbf24'],
    text: '#eef7ff',
    tooltip: 'rgba(3, 8, 20, 0.98)',
  },
  {
    background: '#fffbff',
    boxFill: '#ead6f0',
    description: 'Ruby, amethyst, sapphire, emerald, and topaz for expressive categorical analysis.',
    diverging: ['#b5174b', '#f8eef4', '#146c73'],
    grid: '#eee5ef',
    gridStrong: '#d7c8da',
    id: 'gemstone',
    label: 'Gemstone',
    mode: 'light',
    muted: '#75677a',
    palette: ['#b5174b', '#7b2cbf', '#3155a6', '#147d78', '#d58b16', '#cf4f88'],
    text: '#33233a',
    tooltip: 'rgba(39, 18, 48, 0.97)',
  },
  {
    background: '#fffaf5',
    boxFill: '#f4cfb8',
    description: 'Terracotta, saffron, berry, sage, and dusk blue inspired by desert minerals.',
    diverging: ['#a63d40', '#faeedf', '#3d6b73'],
    grid: '#eee3d9',
    gridStrong: '#d7c4b4',
    id: 'desert-bloom',
    label: 'Desert bloom',
    mode: 'light',
    muted: '#786b61',
    palette: ['#a63d40', '#d96c3f', '#dda33a', '#6f7d4e', '#3d6b73', '#9f5f80'],
    text: '#382922',
    tooltip: 'rgba(46, 29, 23, 0.97)',
  },
  {
    background: '#f9fdff',
    boxFill: '#c9e7ee',
    description: 'Glacial blue through deep lake teal for continuous surfaces and calm comparisons.',
    diverging: ['#173f5f', '#edf8fa', '#35a7a0'],
    grid: '#dcecf1',
    gridStrong: '#b9d5dd',
    id: 'alpine-lake',
    label: 'Alpine lake',
    mode: 'light',
    muted: '#5d7480',
    palette: ['#173f5f', '#206b8c', '#258ea6', '#35a7a0', '#72c7b8', '#9bd7e1'],
    text: '#17323f',
    tooltip: 'rgba(10, 37, 52, 0.97)',
  },
  {
    background: '#fbfdf7',
    boxFill: '#d7e6bd',
    description: 'Canopy green, moss, lagoon teal, ochre, and clay for natural-resource datasets.',
    diverging: ['#8a4f2d', '#f0f3df', '#176b5b'],
    grid: '#e3ead9',
    gridStrong: '#c6d2b7',
    id: 'rainforest',
    label: 'Rainforest',
    mode: 'light',
    muted: '#68725c',
    palette: ['#174c3c', '#2f7d4b', '#63a044', '#167b80', '#c49424', '#9a5b35'],
    text: '#223326',
    tooltip: 'rgba(17, 47, 35, 0.97)',
  },
  {
    background: '#fffbfc',
    boxFill: '#f0d4df',
    description: 'Rose, mulberry, lavender, ink blue, and dusty mauve for refined editorial charts.',
    diverging: ['#a23b72', '#faedf2', '#405b8f'],
    grid: '#eee4e9',
    gridStrong: '#d8c8d0',
    id: 'rose-quartz',
    label: 'Rose quartz',
    mode: 'light',
    muted: '#786a72',
    palette: ['#a23b72', '#d05a88', '#7d5ba6', '#405b8f', '#b88c9e', '#e2a3b8'],
    text: '#382832',
    tooltip: 'rgba(44, 24, 37, 0.97)',
  },
  {
    background: '#fffdf9',
    boxFill: '#f2d19f',
    description: 'Deep blue versus orange and vermilion for anomalies, residuals, and signed variation.',
    diverging: ['#1d4e89', '#f6f1e7', '#d1492e'],
    grid: '#e8e5df',
    gridStrong: '#cbc5bb',
    id: 'seismic',
    label: 'Seismic',
    mode: 'light',
    muted: '#6f6d69',
    palette: ['#173b63', '#2f75a8', '#65a9c4', '#f0a43a', '#e26835', '#b72f2f'],
    text: '#2b3035',
    tooltip: 'rgba(22, 31, 41, 0.97)',
  },
  {
    background: '#232238',
    boxFill: '#274b58',
    description: 'Dark monitoring view with cyan, magenta, and amber signal colors.',
    diverging: ['#ff5a9f', '#343349', '#20d6c7'],
    grid: '#3b3a52',
    gridStrong: '#57556d',
    id: 'night-signal',
    label: 'Night signal',
    mode: 'dark',
    muted: '#a9acc1',
    palette: ['#20d6c7', '#ff5a9f', '#ffc857', '#8d7cff', '#80d85b', '#60a5fa'],
    text: '#f4f2fb',
    tooltip: 'rgba(11, 12, 25, 0.97)',
  },
  {
    background: '#ffffff',
    boxFill: '#e7ebed',
    description: 'High-contrast neutral styling for reports, exports, and grayscale printing.',
    diverging: ['#505b60', '#f3f4f4', '#172126'],
    grid: '#e1e5e7',
    gridStrong: '#bbc4c8',
    id: 'monochrome',
    label: 'Monochrome print',
    mode: 'light',
    muted: '#657178',
    palette: ['#26343a', '#5d6d74', '#8c999e', '#aeb8bc', '#3f4c52', '#748187'],
    text: '#172126',
    tooltip: 'rgba(23, 33, 38, 0.97)',
  },
] as const

export type ChartDesignId = (typeof chartDesigns)[number]['id']
export type ChartDesign = (typeof chartDesigns)[number]

export interface ChartSurfaceColors {
  grid: string
  gridStrong: string
  muted: string
  surface: string
  text: string
}

export const DEFAULT_CHART_DESIGN: ChartDesignId = 'analytical'

export function isChartDesignId(value: string | null): value is ChartDesignId {
  return chartDesigns.some((design) => design.id === value)
}

export function chartDesignById(id: ChartDesignId): ChartDesign {
  return chartDesigns.find((design) => design.id === id) ?? chartDesigns[0]
}

interface RgbColor {
  blue: number
  green: number
  red: number
}

function parseColor(color: string): RgbColor | null {
  const hex = /^#([\da-f]{6})$/i.exec(color.trim())?.[1]
  if (hex !== undefined) {
    return {
      blue: Number.parseInt(hex.slice(4, 6), 16),
      green: Number.parseInt(hex.slice(2, 4), 16),
      red: Number.parseInt(hex.slice(0, 2), 16),
    }
  }
  const rgb = /^rgba?\((.+)\)$/i.exec(color.trim())?.[1]
  if (rgb === undefined) return null
  const channels = rgb.split(/[,/\s]+/).filter(Boolean).slice(0, 3).map(Number)
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) return null
  return { blue: channels[2] ?? 0, green: channels[1] ?? 0, red: channels[0] ?? 0 }
}

function mixColors(color: string, target: string, amount: number) {
  const sourceRgb = parseColor(color)
  const targetRgb = parseColor(target)
  if (sourceRgb === null || targetRgb === null) return color
  const channel = (source: number, destination: number) => Math.round(source + (destination - source) * amount)
  return `rgb(${channel(sourceRgb.red, targetRgb.red)}, ${channel(sourceRgb.green, targetRgb.green)}, ${channel(sourceRgb.blue, targetRgb.blue)})`
}

function relativeLuminance(color: RgbColor) {
  const channel = (value: number) => {
    const normalized = value / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)
}

function contrastRatio(left: RgbColor, right: RgbColor) {
  const brighter = Math.max(relativeLuminance(left), relativeLuminance(right))
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right))
  return (brighter + 0.05) / (darker + 0.05)
}

function ensureContrast(color: string, background: string, minimum = 3.8) {
  const backgroundRgb = parseColor(background)
  const sourceRgb = parseColor(color)
  if (backgroundRgb === null || sourceRgb === null || contrastRatio(sourceRgb, backgroundRgb) >= minimum) return color
  const target = relativeLuminance(backgroundRgb) < 0.42 ? '#f7fbff' : '#101820'
  for (let amount = 0.08; amount <= 0.8; amount += 0.04) {
    const candidate = mixColors(color, target, amount)
    const candidateRgb = parseColor(candidate)
    if (candidateRgb !== null && contrastRatio(candidateRgb, backgroundRgb) >= minimum) return candidate
  }
  return target
}

function bestTextColor(background: string) {
  const backgroundRgb = parseColor(background)
  const light = parseColor('#ffffff')
  const dark = parseColor('#071018')
  if (backgroundRgb === null || light === null || dark === null) return '#ffffff'
  return contrastRatio(light, backgroundRgb) >= contrastRatio(dark, backgroundRgb) ? '#ffffff' : '#071018'
}

function heatmapLabelStyle(background: string) {
  const color = bestTextColor(background)
  const usesLightText = color === '#ffffff'
  return {
    color,
    textBorderColor: usesLightText ? 'rgba(7, 16, 24, 0.72)' : 'rgba(255, 255, 255, 0.72)',
    textBorderWidth: 1.5,
  }
}

function heatmapColor(value: number, colors: readonly string[]) {
  const negative = colors[0] ?? '#b23a5a'
  const middle = colors[1] ?? '#f3f5f4'
  const positive = colors[2] ?? '#087f8c'
  const normalized = Math.max(-1, Math.min(1, value))
  return normalized < 0
    ? mixColors(middle, negative, Math.abs(normalized))
    : mixColors(middle, positive, normalized)
}

function withAlpha(color: string, alpha: number) {
  const parsed = parseColor(color)
  return parsed === null ? color : `rgba(${parsed.red}, ${parsed.green}, ${parsed.blue}, ${alpha})`
}

function verticalGradient(color: string, topAlpha = 1, bottomAlpha = 0.84) {
  return {
    colorStops: [
      { color: withAlpha(color, topAlpha), offset: 0 },
      { color: withAlpha(color, bottomAlpha), offset: 1 },
    ],
    type: 'linear',
    x: 0,
    x2: 0,
    y: 0,
    y2: 1,
  }
}

function radialGradient(color: string) {
  return {
    colorStops: [
      { color: color, offset: 0 },
      { color: withAlpha(color, 0.84), offset: 1 },
    ],
    r: 0.78,
    type: 'radial',
    x: 0.36,
    y: 0.32,
  }
}

function colorSeries(
  series: unknown,
  color: string,
  surface: ChartSurfaceColors,
  addArea: boolean,
  diverging: readonly string[],
) {
  if (typeof series !== 'object' || series === null) return series
  const record = series as Record<string, unknown>
  const type = record.type
  if (type === 'heatmap') {
    const label = typeof record.label === 'object' && record.label !== null
      ? record.label as Record<string, unknown>
      : undefined
    const data = label?.show === true && Array.isArray(record.data)
      ? record.data.map((item) => {
          if (typeof item !== 'object' || item === null) return item
          const itemRecord = item as Record<string, unknown>
          const value = Array.isArray(itemRecord.value) ? itemRecord.value[2] : undefined
          const labelStyle = typeof value === 'number' && Number.isFinite(value)
            ? heatmapLabelStyle(heatmapColor(value, diverging))
            : heatmapLabelStyle(surface.surface)
          return {
            ...itemRecord,
            label: {
              ...(typeof itemRecord.label === 'object' && itemRecord.label !== null ? itemRecord.label : {}),
              ...labelStyle,
            },
          }
        })
      : record.data
    return {
      ...record,
      data,
      itemStyle: {
        ...(record.itemStyle as object | undefined),
        borderColor: surface.surface,
        borderWidth: 2,
      },
      label: label === undefined ? record.label : {
        ...label,
        color: surface.text,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 16,
        opacity: 1,
        position: 'inside',
        show: true,
      },
      labelLayout: {
        ...(typeof record.labelLayout === 'object' && record.labelLayout !== null ? record.labelLayout : {}),
        hideOverlap: false,
      },
    }
  }
  if (type === 'boxplot') {
    return {
      ...record,
      itemStyle: {
        ...(record.itemStyle as object | undefined),
        borderColor: color,
        borderWidth: 2,
        color: verticalGradient(color, 0.72, 0.34),
        shadowBlur: 10,
        shadowColor: withAlpha(color, 0.16),
      },
    }
  }
  if (type === 'bar') {
    return {
      ...record,
      itemStyle: {
        ...(record.itemStyle as object | undefined),
        borderColor: withAlpha(color, 0.92),
        borderRadius: [6, 6, 2, 2],
        borderWidth: 1,
        color: verticalGradient(color),
        shadowBlur: 9,
        shadowColor: withAlpha(color, 0.16),
        shadowOffsetY: 3,
      },
    }
  }
  if (type === 'scatter') {
    const existingStyle = record.itemStyle as Record<string, unknown> | undefined
    const opacity = typeof existingStyle?.opacity === 'number' ? Math.max(existingStyle.opacity, 0.9) : 0.94
    return {
      ...record,
      itemStyle: {
        ...existingStyle,
        borderColor: surface.surface,
        borderWidth: 1.5,
        color: radialGradient(color),
        opacity,
        shadowBlur: 7,
        shadowColor: withAlpha(color, 0.3),
      },
    }
  }
  if (type === 'line') {
    const lineStyle = record.lineStyle as Record<string, unknown> | undefined
    const canFill = addArea && lineStyle?.type !== 'dashed' && record.silent !== true
    return {
      ...record,
      areaStyle: canFill
        ? {
            ...(record.areaStyle as object | undefined),
            color: verticalGradient(color, 0.2, 0.01),
          }
        : record.areaStyle,
      itemStyle: {
        ...(record.itemStyle as object | undefined),
        borderColor: surface.surface,
        borderWidth: 1.5,
        color,
        shadowBlur: 6,
        shadowColor: withAlpha(color, 0.34),
      },
      lineStyle: {
        ...lineStyle,
        color,
        shadowBlur: 7,
        shadowColor: withAlpha(color, 0.22),
        width: lineStyle?.width ?? 2.6,
      },
    }
  }
  return {
    ...record,
    itemStyle: { ...(record.itemStyle as object | undefined), color },
  }
}

function colorAxis(axis: unknown, surface: ChartSurfaceColors, dimension: 'x' | 'y') {
  if (typeof axis !== 'object' || axis === null) return axis
  const record = axis as Record<string, unknown>
  const isValueAxis = record.type === 'value' || (record.type === undefined && !Array.isArray(record.data))
  return {
    ...record,
    axisLabel: {
      ...(record.axisLabel as object | undefined),
      color: surface.text,
      fontSize: 11,
      fontWeight: 500,
      hideOverlap: true,
      margin: 11,
    },
    axisLine: {
      ...(record.axisLine as object | undefined),
      lineStyle: { color: surface.gridStrong, width: 1 },
      show: true,
    },
    axisPointer: {
      ...(record.axisPointer as object | undefined),
      label: { backgroundColor: surface.surface, color: surface.text },
      lineStyle: { color: surface.gridStrong, type: 'dashed' },
    },
    axisTick: { ...(record.axisTick as object | undefined), show: false },
    // An explicit `undefined` overrides the ECharts default and takes category axes off-band, which heatmaps reject.
    ...(record.boundaryGap !== undefined ? {} : isValueAxis ? { boundaryGap: ['3%', '6%'] } : {}),
    nameGap: record.nameGap ?? (dimension === 'x' ? 34 : 46),
    nameLocation: record.name === undefined ? record.nameLocation : (record.nameLocation ?? 'middle'),
    nameTextStyle: {
      ...(record.nameTextStyle as object | undefined),
      color: surface.text,
      fontSize: 11,
      fontWeight: 600,
    },
    scale: record.scale ?? (isValueAxis ? true : undefined),
    splitLine: {
      ...(record.splitLine as object | undefined),
      lineStyle: { color: surface.grid, type: 'dashed', width: 1 },
    },
  }
}

function mapAxis(axis: unknown, surface: ChartSurfaceColors, dimension: 'x' | 'y') {
  return Array.isArray(axis)
    ? axis.map((item) => colorAxis(item, surface, dimension))
    : colorAxis(axis, surface, dimension)
}

function fitGrid(grid: unknown): unknown {
  if (Array.isArray(grid)) return grid.map(fitGrid)
  const record = typeof grid === 'object' && grid !== null ? grid as Record<string, unknown> : {}
  return {
    ...record,
    bottom: record.bottom ?? 14,
    containLabel: record.containLabel ?? false,
    left: record.left ?? 14,
    outerBoundsContain: 'all',
    outerBoundsMode: 'same',
    right: record.right ?? 14,
    top: record.top ?? 52,
  }
}

export function applyChartDesign(
  option: EChartsCoreOption,
  designId: ChartDesignId,
  surfaceColors?: ChartSurfaceColors,
): EChartsCoreOption {
  const design = chartDesignById(designId)
  const surface = surfaceColors ?? {
    grid: design.grid,
    gridStrong: design.gridStrong,
    muted: design.muted,
    surface: design.background,
    text: design.text,
  }
  const record = option as Record<string, unknown>
  const palette = design.palette.map((color) => ensureContrast(color, surface.surface))
  const primaryColor = palette[0] ?? design.palette[0]
  const diverging = [
    ensureContrast(design.diverging[0], surface.surface, 3.2),
    mixColors(surface.surface, surface.text, 0.12),
    ensureContrast(design.diverging[2], surface.surface, 3.2),
  ]
  const rawSeries = Array.isArray(record.series) ? record.series : []
  const lineSeries = rawSeries.filter((item) => typeof item === 'object' && item !== null && (item as Record<string, unknown>).type === 'line')
  const addArea = lineSeries.length > 0 && lineSeries.length <= 2 && lineSeries.length === rawSeries.length
  const series = Array.isArray(record.series)
    ? record.series.map((item, index) => colorSeries(
        item,
        palette[index % palette.length] ?? primaryColor,
        surface,
        addArea,
        diverging,
      ))
    : record.series
  const visualMap = typeof record.visualMap === 'object' && record.visualMap !== null
    ? {
        ...(record.visualMap as Record<string, unknown>),
        borderColor: surface.gridStrong,
        inRange: { color: diverging },
        textStyle: { color: surface.text, fontWeight: 500 },
      }
    : record.visualMap
  const hasCartesianAxes = record.xAxis !== undefined || record.yAxis !== undefined
  return {
    ...record,
    backgroundColor: 'transparent',
    brush: typeof record.brush === 'object' && record.brush !== null
      ? { ...(record.brush as Record<string, unknown>), toolbox: [] }
      : record.brush,
    grid: hasCartesianAxes ? fitGrid(record.grid) : record.grid,
    legend: typeof record.legend === 'object' && record.legend !== null
      ? {
          ...(record.legend as Record<string, unknown>),
          backgroundColor: 'transparent',
          pageIconColor: primaryColor,
          pageIconInactiveColor: surface.gridStrong,
          pageTextStyle: { color: surface.text },
          textStyle: { color: surface.text, fontSize: 11, fontWeight: 600 },
        }
      : record.legend,
    series,
    toolbox: typeof record.toolbox === 'object' && record.toolbox !== null
      ? { ...(record.toolbox as Record<string, unknown>), show: false }
      : record.toolbox,
    tooltip: typeof record.tooltip === 'object' && record.tooltip !== null
      ? {
          ...(record.tooltip as Record<string, unknown>),
          backgroundColor: design.tooltip,
          borderColor: withAlpha(primaryColor, 0.68),
          borderWidth: 1,
          extraCssText: `background:${design.tooltip}!important;color:#fff!important;border-radius:10px;box-shadow:0 14px 34px rgba(0,0,0,.42);padding:10px 12px;`,
          textStyle: { color: '#ffffff', fontSize: 11, fontWeight: 500, lineHeight: 18 },
        }
      : record.tooltip,
    visualMap,
    xAxis: mapAxis(record.xAxis, surface, 'x'),
    yAxis: mapAxis(record.yAxis, surface, 'y'),
  } as EChartsCoreOption
}
