import { init, type EChartsType } from 'echarts/core'
import { desktopBridge, type ExportFile } from '../desktop/bridge.js'
import type { ExportTarget } from '../state/ExportContext.js'

/**
 * Re-render the chart off-screen with a transparent background. The logical canvas is report-sized (640 px wide,
 * on-screen aspect) and rendered at 5× so the Settings font size reads as print size (11 px ≈ 8 pt on a 16 cm figure).
 */
export function chartPng(chart: EChartsType): string {
  const width = 640
  const height = Math.round(Math.min(640, Math.max(320, width * (chart.getHeight() / Math.max(1, chart.getWidth())))))
  const host = document.createElement('div')
  Object.assign(host.style, { position: 'fixed', left: '-100000px', width: `${width}px`, height: `${height}px` })
  document.body.appendChild(host)
  const copy = init(host, undefined, { width, height, renderer: 'canvas' })
  try {
    copy.setOption({ ...chart.getOption(), animation: false, tooltip: { show: false }, toolbox: { show: false }, backgroundColor: 'transparent' }, { notMerge: true, lazyUpdate: false })
    return copy.getDataURL({ type: 'png', pixelRatio: 5, backgroundColor: 'transparent', excludeComponents: ['toolbox'] })
  } finally { copy.dispose(); host.remove() }
}

/** Next free "<name> <n>" for each file in the target folder (Histogram 1, Histogram 2, …). */
export async function suggestExportNames(target: ExportTarget, files: Array<Pick<ExportFile, 'name' | 'kind'>>): Promise<{ directory: string; names: string[] }> {
  const bridge = desktopBridge()
  if (bridge?.suggestExportNames && target.address) return bridge.suggestExportNames({ address: target.address, feature: target.feature, files })
  const counts = new Map<string, number>()
  return {
    directory: `${target.folder}/export`,
    names: files.map((file) => { const base = file.name.trim() || 'Graph'; const n = (counts.get(base) ?? 0) + 1; counts.set(base, n); return `${base} ${n}` }),
  }
}

export async function saveExportFiles(target: ExportTarget, files: ExportFile[]): Promise<{ directory: string; paths: string[] }> {
  const bridge = desktopBridge()
  if (bridge?.saveExportBundle) {
    if (!target.address) throw new Error('Open a project before exporting.')
    return bridge.saveExportBundle({ address: target.address, feature: target.feature, files })
  }
  // Browser fallback: download each file.
  for (const file of files) {
    const href = file.kind === 'png' ? file.dataUrl ?? '' : URL.createObjectURL(new Blob([file.contents ?? ''], { type: 'text/plain' }))
    Object.assign(document.createElement('a'), { href, download: `${file.name}.${file.kind}` }).click()
  }
  return { directory: 'downloads', paths: files.map((file) => `${file.name}.${file.kind}`) }
}
