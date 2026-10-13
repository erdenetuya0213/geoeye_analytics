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
  const markup = renderToStaticMarkup(createElement(LiveLoggingPage, { holeNames: new Map(), project, overview, refreshing: false, onRefresh: vi.fn() }))
  expect(markup).toContain('Live template')
  expect(markup).toContain('Last updated')
  expect(markup).toContain('Reference 01')
  expect(markup).not.toContain('987')
  expect(overview.templates[0]?.version).toBe(987)
})

it('exports the active template as one sheet of every logged borehole', () => {
  const project: ProjectSummary = { id: 'project', name: 'Test project', description: null, canWrite: true,
    drillholeCount: 2, isActive: true, organizationId: 'org', organizationName: 'Test' }
  const submission = (holeId: string, holeName: string) => ({ projectId: project.id, holeId, holeName, templateId: 'template',
    templateName: 'Geotechnical', templateVersion: 1, depthFrom: 0, depthTo: 6, selectedRowCount: 2,
    intervalCount: 2, structureCount: 0, generatedLogCount: 0, updatedAt: '2026-10-12T00:00:00Z' })
  const overview = { projectId: project.id,
    templates: [{ id: 'template', name: 'Geotechnical', version: 1 }],
    submissions: [submission('h1', 'DH1'), submission('h2', 'DH2')],
    datasets: [{ category: null, id: 'template', name: 'Geotechnical', updatedAt: '2026-10-12T00:00:00.000Z', version: 1,
      columns: [{ dataType: 'numeric', key: 'rqd', label: 'RQD', unit: '%' }],
      records: [{ depthFrom: 0, depthTo: 3, holeId: 'h1', id: 'r1', values: { rqd: 80 } },
        { depthFrom: 3, depthTo: 6, holeId: 'h2', id: 'r2', values: { rqd: 60 } }] }],
  } as unknown as FieldLoggingOverview
  const markup = renderToStaticMarkup(createElement(LiveLoggingPage, { holeNames: new Map([['h1', 'DH1'], ['h2', 'DH2']]), project, overview, refreshing: false, onRefresh: vi.fn() }))
  expect(markup).toContain('Geotechnical · 2 holes · 2 rows')
  expect(markup).toMatch(/save-export-bar[\s\S]*Save/)
  expect(markup).not.toContain('disabled=""')
})

it('has nothing to save when the template has no logged rows in the local copy', () => {
  const project: ProjectSummary = { id: 'project', name: 'Test project', description: null, canWrite: true,
    drillholeCount: 0, isActive: true, organizationId: 'org', organizationName: 'Test' }
  const overview = { projectId: project.id, templates: [{ id: 'template', name: 'Lithology', version: 1 }], submissions: [], datasets: [] } as unknown as FieldLoggingOverview
  const markup = renderToStaticMarkup(createElement(LiveLoggingPage, { holeNames: new Map(), project, overview, refreshing: false, onRefresh: vi.fn() }))
  expect(markup).toContain('Lithology · no logged rows in the local copy')
  expect(markup).toContain('disabled=""')
})
