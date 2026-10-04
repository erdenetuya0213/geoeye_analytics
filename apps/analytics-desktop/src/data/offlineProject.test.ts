import { describe, expect, it } from 'vitest'
import { emptyOfflineProject } from './offlineProject.js'

describe('empty offline project', () => {
  it('creates a writable local project without sample records or a database tenant', () => {
    const snapshot = emptyOfflineProject('local-project-id')
    expect(snapshot.project).toMatchObject({ id: 'local-project-id', canWrite: true, organizationId: null, drillholeCount: 0 })
    expect(snapshot.fieldLogging).toEqual({ projectId: 'local-project-id', templates: [], submissions: [], datasets: [] })
    for (const rows of [snapshot.datasets, snapshot.drillholes, snapshot.observations, snapshot.variables, snapshot.projection, snapshot.fieldStructures]) {
      expect(rows).toEqual([])
    }
    expect(snapshot.surveysByHoleId).toEqual({})
    expect(Number.isFinite(Date.parse(snapshot.refreshedAt))).toBe(true)
  })
})
