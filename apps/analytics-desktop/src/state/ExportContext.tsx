import { createContext, useContext, type ReactNode } from 'react'
import type { ExportFeature, ProjectStorageAddress } from '../desktop/bridge.js'
import type { SectionId } from '../types.js'
import { projectStorageAddress, useProjectStorage } from './ProjectStorageContext.js'

/** Export folder per app feature, named like the sidebar: <project>/export/<Folder>/. */
export const EXPORT_FOLDERS: Record<ExportFeature, string> = {
  '3d': '3D Analysis', custom: 'Custom', data: 'Data', domain: 'Domain', geotechnical: 'Geotech', grade: 'Grade',
  multivariate: 'Multivariate', operations: 'Operations', statistics: 'Statistics', structure: 'Structure', variography: 'Variography',
}

const sectionFeatures: Partial<Record<SectionId, ExportFeature>> = {
  custom: 'custom', domain: 'domain', explore: 'statistics', geotechnical: 'geotechnical', grade: 'grade',
  multivariate: 'multivariate', operations: 'operations', structure: 'structure', variography: 'variography', 'view-3d': '3d',
}
/** Data pages (pool, drillholes, logging, lab, strength…) share the Data folder. */
export const exportFeatureForSection = (section: SectionId): ExportFeature => sectionFeatures[section] ?? 'data'

const Context = createContext<ExportFeature | null>(null)

export function ExportFeatureProvider({ children, feature }: { children: ReactNode; feature: ExportFeature }) {
  return <Context.Provider value={feature}>{children}</Context.Provider>
}

export interface ExportTarget { address: ProjectStorageAddress | undefined; feature: ExportFeature; folder: string }

/** Where exports from this screen go: the open project and the feature the screen belongs to. */
export function useExportTarget(fallback: ExportFeature = 'statistics'): ExportTarget {
  const feature = useContext(Context) ?? fallback
  return { address: projectStorageAddress(useProjectStorage()), feature, folder: EXPORT_FOLDERS[feature] }
}
