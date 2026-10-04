import type { LocalProjectSnapshot } from './localProjectDb.js'

/** A real empty workspace for local imports, never a seeded demonstration dataset. */
export function emptyOfflineProject(id: string): LocalProjectSnapshot {
  return {
    version: 1,
    project: { id, name: 'Local project', description: 'Local imports and analysis results', isActive: true, canWrite: true, drillholeCount: 0, organizationId: null, organizationName: null },
    datasets: [], drillholes: [], observations: [], variables: [], projection: [], fieldStructures: [], surveysByHoleId: {},
    fieldLogging: { projectId: id, templates: [], submissions: [], datasets: [] },
    refreshedAt: new Date().toISOString(),
  }
}
