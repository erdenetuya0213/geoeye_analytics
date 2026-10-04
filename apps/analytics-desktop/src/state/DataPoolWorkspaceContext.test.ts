import type { ProjectSummary } from '@geoeye/datapool-client'
import { describe, expect, it } from 'vitest'
import { resolveWorkspaceProject } from './DataPoolWorkspaceContext.js'

const cachedProject: ProjectSummary = {
  canWrite: true,
  description: null,
  drillholeCount: 9,
  id: 'a5e74f4f-7df8-42d3-8188-b95826705d1f',
  isActive: true,
  name: 'Cached project',
  organizationId: null,
  organizationName: 'Local workspace',
}

describe('offline project resolution', () => {
  it('opens the cached project without a Database session', () => {
    expect(resolveWorkspaceProject([], cachedProject.id, cachedProject)).toEqual(cachedProject)
  })

  it('prefers the current Database project after sign-in', () => {
    const onlineProject = { ...cachedProject, name: 'Current project' }
    expect(resolveWorkspaceProject([onlineProject], onlineProject.id, cachedProject)).toEqual(onlineProject)
  })
})
