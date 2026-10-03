import type { SectionId } from '../types.js'

/**
 * The demo workspace (mock project and fixture data) exists for sales
 * demonstrations only. It is never offered, in development or production,
 * unless the build explicitly opts in with VITE_ENABLE_DEMO=true.
 */
export const demoWorkspaceAllowed: boolean = import.meta.env.VITE_ENABLE_DEMO === 'true'

/**
 * Sections that read the signed-in project's data from the Data Pool. Every other
 * section still runs on demo fixtures, so a real project gets that feature's
 * data-free shell instead. Add a section here once it loads live data.
 */
const liveSections: ReadonlySet<SectionId> = new Set(['data-pool', 'drillholes', 'field-logging'])

export function sectionHasLiveData(section: SectionId): boolean {
  return liveSections.has(section)
}
