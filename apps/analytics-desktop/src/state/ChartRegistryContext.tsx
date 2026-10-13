import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'
import type { EChartsType } from 'echarts/core'

export interface ChartRegistry { register: (name: string, chart: EChartsType) => () => void; snapshot: () => Array<{ name: string; chart: EChartsType }> }
const Context = createContext<ChartRegistry | null>(null)

/** Charts on the current page register here (keyed by instance, so equal names are kept) for the page-level Save. */
export function ChartRegistryProvider({ children }: { children: ReactNode }) {
  const charts = useRef(new Map<EChartsType, string>())
  const value = useMemo<ChartRegistry>(() => ({
    register: (name, chart) => { charts.current.set(chart, name); return () => { charts.current.delete(chart) } },
    snapshot: () => [...charts.current.entries()].filter(([chart]) => !chart.isDisposed()).map(([chart, name]) => ({ chart, name })),
  }), [])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export const useChartRegistry = () => useContext(Context)
