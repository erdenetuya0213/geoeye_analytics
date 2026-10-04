import { createContext, useContext, type ReactNode } from 'react'
import type { OfflineLicense } from './bridge.js'

const ActivationContext = createContext<OfflineLicense | null>(null)
export function ActivationProvider({ license, children }: { license: OfflineLicense; children: ReactNode }) {
  return <ActivationContext.Provider value={license}>{children}</ActivationContext.Provider>
}
export function useOfflineLicense() { return useContext(ActivationContext) }
