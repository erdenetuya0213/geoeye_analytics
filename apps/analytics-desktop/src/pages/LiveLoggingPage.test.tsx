import type { FieldLoggingOverview, ProjectSummary } from '@geoeye/datapool-client'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { LiveLoggingPage } from './LiveLoggingPage.js'

vi.mock('../state/persistentState.js', () => ({ usePersistentState: (_key: string, value: unknown) => [value, vi.fn()] }))

it('shows live source and last update without displaying the internal template revision', () => {
  const project: ProjectSummary = { id: 'project', name: 'Test project', description: null, canWrite: true,
    drillholeCount: 1, isActive: true, organizationId: 'org', organizationName: 'Test' }
  const overview: FieldLoggingOverview = { projectId: project.id,
    templates: [{ id: 'template', name: 'Structure auto', version: 987 }],
    submissions: [{ projectId: project.id, holeId: 'hole', holeName: 'Reference 01', templateId: 'template',
      templateName: 'Structure auto', templateVersion: 987, depthFrom: 0, depthTo: 3, selectedRowCount: 1,
      intervalCount: 0, structureCount: 2, generatedLogCount: 4, updatedAt: '2026-10-07T00:00:00Z' }],
  }
  const markup = renderToStaticMarkup(createElement(LiveLoggingPage, { project, overview, refreshing: false, onRefresh: vi.fn() }))
  expect(markup).toContain('Live template')
  expect(markup).toContain('Last updated')
  expect(markup).toContain('Reference 01')
  expect(markup).not.toContain('987')
  expect(overview.templates[0]?.version).toBe(987)
})
