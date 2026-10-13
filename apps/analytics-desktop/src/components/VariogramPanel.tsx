import { useCallback, useEffect, useRef, useState } from 'react'
import type { EChartsType } from 'echarts/core'
import type { EChartsCoreOption } from 'echarts/core'
import type { VariogramModel } from '../analysis/engineClient.js'
import { withTotalSill } from '../analysis/variogramModel.js'
import { GeoEyeChart } from './GeoEyeChart.js'

interface Handle { kind: 'nugget' | 'structure'; index: number; x: number; y: number }
interface Props { ariaLabel: string; exportName: string; color: string; directionIndex: number; model: VariogramModel | null; onModelChange: (model: VariogramModel) => void; option: EChartsCoreOption }

/** Variogram chart with draggable model handles: nugget (y only) and one per structure (range = x, cumulative sill = y). */
export function VariogramPanel({ ariaLabel, exportName, color, directionIndex, model, onModelChange, option }: Props) {
  const chartRef = useRef<EChartsType | null>(null)
  const [handles, setHandles] = useState<Handle[]>([])
  const drag = useRef<{ handle: Handle; start: VariogramModel } | null>(null)

  const place = useCallback(() => {
    const chart = chartRef.current
    if (chart === null || model === null) { setHandles([]); return }
    const px = (h: number, g: number) => chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [h, g]) as [number, number] | undefined
    const next: Handle[] = []
    const n = px(0, model.nugget); if (n) next.push({ kind: 'nugget', index: -1, x: n[0], y: n[1] })
    let cumulative = model.nugget
    model.structures.forEach((s, i) => { cumulative += s.sill; const p = px(s.ranges[directionIndex] ?? s.ranges[0] ?? 0, cumulative); if (p) next.push({ kind: 'structure', index: i, x: p[0], y: p[1] }) })
    setHandles(next)
  }, [model, directionIndex])

  useEffect(() => { const id = requestAnimationFrame(place); return () => cancelAnimationFrame(id) }, [place, option])
  useEffect(() => { const chart = chartRef.current; if (!chart) return; chart.on('finished', place); return () => { chart.off('finished', place) } }, [place])

  const onPointerDown = (handle: Handle) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (model === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { handle, start: model }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const chart = chartRef.current; const d = drag.current
    if (chart === null || d === null) return
    const rect = event.currentTarget.getBoundingClientRect()
    const data = chart.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [event.clientX - rect.left, event.clientY - rect.top]) as [number, number] | undefined
    if (!data) return
    const [h, g] = [Math.max(0, data[0]), Math.max(0, data[1])]
    const m = d.start
    if (d.handle.kind === 'nugget') {
      const delta = g - m.nugget
      onModelChange(withTotalSill({ ...m, nugget: g, structures: m.structures.map((s, i) => (i === 0 ? { ...s, sill: Math.max(0, s.sill - delta) } : s)) }))
      return
    }
    const i = d.handle.index
    const below = m.nugget + m.structures.slice(0, i).reduce((a, s) => a + s.sill, 0)
    const sill = Math.max(0, g - below)
    onModelChange(withTotalSill({ ...m, structures: m.structures.map((s, k) => (k === i ? { ...s, sill, ranges: s.ranges.map((r, j) => (j === directionIndex ? Math.max(0.1, h) : r)) } : s)) }))
  }
  const onPointerUp = () => { drag.current = null }

  return <div className="vg-drag-layer" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    <GeoEyeChart ariaLabel={ariaLabel} exportFeature="variography" exportName={exportName} onReady={(chart) => { chartRef.current = chart; requestAnimationFrame(place) }} option={option} />
    {handles.map((h) => <button aria-label={h.kind === 'nugget' ? 'Drag to set nugget' : `Drag to set structure ${h.index + 1} range and sill`} className={`vg-handle is-${h.kind}`} key={`${h.kind}${h.index}`} onPointerDown={onPointerDown(h)} style={{ left: h.x, top: h.y, borderColor: color }} type="button" />)}
  </div>
}
