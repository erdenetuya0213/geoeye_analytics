import type { UnsavedGraphImage } from './analysisResultStore.js'

export interface GraphSeries {
  label: string
  value: number
}

const width = 1200
const height = 720
const fallbackPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1WQAAAABJRU5ErkJggg=='

function canvasContext(canvasWidth = width, canvasHeight = height) {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const context = canvas.getContext('2d')
  return context === null ? null : { canvas, context }
}

function initialize(context: CanvasRenderingContext2D, title: string) {
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#23343d'
  context.font = '700 30px system-ui, sans-serif'
  context.fillText(title, 92, 48)
  context.fillStyle = '#73818a'
  context.font = '15px system-ui, sans-serif'
  context.fillText('GeoEye Analytics · saved PNG graph artifact', 92, height - 24)
}

function pngDataUrl(canvas: HTMLCanvasElement | undefined) {
  return canvas?.toDataURL('image/png') ?? fallbackPng
}

export function barGraphImage(
  chartName: string,
  title: string,
  series: readonly GraphSeries[],
  boreholeId: string | null = null,
): UnsavedGraphImage {
  const drawing = canvasContext()
  if (drawing !== null) {
    const { context } = drawing
    const left = 92
    const right = 42
    const top = 96
    const bottom = 116
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom
    const maximum = Math.max(1, ...series.map((item) => Math.max(0, item.value)))
    const slot = plotWidth / Math.max(1, series.length)
    initialize(context, title)
    context.strokeStyle = '#cfd8dd'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(left, top + plotHeight)
    context.lineTo(width - right, top + plotHeight)
    context.stroke()

    series.forEach((item, index) => {
      const barWidth = Math.max(10, slot * .62)
      const barHeight = Math.max(0, item.value) / maximum * plotHeight
      const x = left + slot * index + (slot - barWidth) / 2
      const y = top + plotHeight - barHeight
      context.fillStyle = '#17766f'
      context.fillRect(x, y, barWidth, barHeight)
      context.fillStyle = '#23343d'
      context.font = '19px system-ui, sans-serif'
      context.textAlign = 'center'
      context.fillText(Number.isInteger(item.value) ? String(item.value) : item.value.toFixed(2), x + barWidth / 2, Math.max(78, y - 10))
      context.save()
      context.translate(x + barWidth / 2, top + plotHeight + 30)
      context.rotate(28 * Math.PI / 180)
      context.fillStyle = '#5f7079'
      context.font = '16px system-ui, sans-serif'
      context.textAlign = 'center'
      context.fillText(item.label.slice(0, 28), 0, 0)
      context.restore()
    })
  }
  return {
    boreholeId,
    chartName,
    imageDataUrl: pngDataUrl(drawing?.canvas),
    mediaType: 'image/png',
  }
}

export function scatterGraphImage(
  chartName: string,
  title: string,
  points: readonly { x: number; y: number }[],
): UnsavedGraphImage {
  const drawing = canvasContext()
  if (drawing !== null) {
    const { context } = drawing
    const left = 86
    const top = 82
    const plotWidth = 1060
    const plotHeight = 540
    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    const minX = Math.min(0, ...xs)
    const maxX = Math.max(1, ...xs)
    const minY = Math.min(0, ...ys)
    const maxY = Math.max(1, ...ys)
    initialize(context, title)
    context.fillStyle = '#f8faf9'
    context.fillRect(left, top, plotWidth, plotHeight)
    context.strokeStyle = '#cfd8dd'
    context.strokeRect(left, top, plotWidth, plotHeight)
    context.fillStyle = 'rgba(49, 95, 120, .7)'
    points.slice(0, 1500).forEach((point) => {
      const x = left + (point.x - minX) / Math.max(Number.EPSILON, maxX - minX) * plotWidth
      const y = top + plotHeight - (point.y - minY) / Math.max(Number.EPSILON, maxY - minY) * plotHeight
      context.beginPath()
      context.arc(x, y, 4.2, 0, Math.PI * 2)
      context.fill()
    })
  }
  return { chartName, imageDataUrl: pngDataUrl(drawing?.canvas), mediaType: 'image/png' }
}

export async function svgElementPngGraphImage(
  chartName: string,
  element: SVGSVGElement | null,
): Promise<UnsavedGraphImage | null> {
  if (element === null) return null
  const drawing = canvasContext(1200, 1200)
  if (drawing === null || typeof Image === 'undefined') {
    return { chartName, imageDataUrl: fallbackPng, mediaType: 'image/png' }
  }

  const clone = element.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', '1200')
  clone.setAttribute('height', '1200')
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      try {
        drawing.context.fillStyle = '#ffffff'
        drawing.context.fillRect(0, 0, 1200, 1200)
        drawing.context.drawImage(image, 0, 0, 1200, 1200)
        resolve({ chartName, imageDataUrl: pngDataUrl(drawing.canvas), mediaType: 'image/png' })
      } catch {
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = source
  })
}
