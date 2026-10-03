import { createContext, useContext, type ReactNode } from 'react'
import { DEFAULT_CHART_DESIGN, type ChartDesignId } from '../visualization/chartDesigns.js'

const ChartDesignContext = createContext<ChartDesignId>(DEFAULT_CHART_DESIGN)

export function ChartDesignProvider({ children, designId }: { children: ReactNode; designId: ChartDesignId }) {
  return <ChartDesignContext.Provider value={designId}>{children}</ChartDesignContext.Provider>
}

export function useChartDesign() {
  return useContext(ChartDesignContext)
}
