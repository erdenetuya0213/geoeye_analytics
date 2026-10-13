import { createContext, useContext, type ReactNode } from 'react'
import { DEFAULT_CHART_DESIGN, type ChartDesignId } from '../visualization/chartDesigns.js'
import { DEFAULT_GRAPH_SETTINGS, type GraphSettings } from '../visualization/graphSettings.js'

const ChartDesignContext = createContext<ChartDesignId>(DEFAULT_CHART_DESIGN)
const GraphSettingsContext = createContext<GraphSettings>(DEFAULT_GRAPH_SETTINGS)

export function ChartDesignProvider({ children, designId, graphSettings = DEFAULT_GRAPH_SETTINGS }: { children: ReactNode; designId: ChartDesignId; graphSettings?: GraphSettings }) {
  return <ChartDesignContext.Provider value={designId}><GraphSettingsContext.Provider value={graphSettings}>{children}</GraphSettingsContext.Provider></ChartDesignContext.Provider>
}

export function useChartDesign() {
  return useContext(ChartDesignContext)
}

export function useGraphSettings() {
  return useContext(GraphSettingsContext)
}
