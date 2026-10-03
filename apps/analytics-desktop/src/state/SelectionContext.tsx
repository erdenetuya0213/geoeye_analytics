import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { usePersistentState } from './persistentState.js'

export interface GeoEyeSelectionContextValue {
  addSelection: (ids: readonly string[]) => void
  clearSelection: () => void
  replaceSelection: (ids: readonly string[]) => void
  selectedIds: readonly string[]
  toggleSelection: (ids: readonly string[]) => void
}

const GeoEyeSelectionContext = createContext<GeoEyeSelectionContextValue | null>(null)

function unique(ids: readonly string[]) {
  return Array.from(new Set(ids.filter((id) => id.length > 0)))
}

export function GeoEyeSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedIds, setSelectedIds] = usePersistentState<string[]>('selection.ids', [])
  const clearSelection = useCallback(() => setSelectedIds((current) => current.length === 0 ? current : []), [setSelectedIds])
  const replaceSelection = useCallback((ids: readonly string[]) => setSelectedIds(unique(ids)), [setSelectedIds])
  const addSelection = useCallback((ids: readonly string[]) => {
    setSelectedIds((current) => unique([...current, ...ids]))
  }, [setSelectedIds])
  const toggleSelection = useCallback((ids: readonly string[]) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      ids.forEach((id) => {
        if (next.has(id)) next.delete(id)
        else next.add(id)
      })
      return Array.from(next)
    })
  }, [setSelectedIds])
  const value = useMemo(() => ({
    addSelection,
    clearSelection,
    replaceSelection,
    selectedIds,
    toggleSelection,
  }), [addSelection, clearSelection, replaceSelection, selectedIds, toggleSelection])

  return <GeoEyeSelectionContext.Provider value={value}>{children}</GeoEyeSelectionContext.Provider>
}

export function useGeoEyeSelection() {
  const value = useContext(GeoEyeSelectionContext)
  if (value === null) throw new Error('useGeoEyeSelection must be used within GeoEyeSelectionProvider')
  return value
}

