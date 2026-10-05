import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { calculateRmr76Intervals, type Rmr76CalculationRun } from '../analysis/geotechnicalWorkflow.js'
import { GeotechnicalPage } from './GeotechnicalPage.js'

const saved = vi.hoisted(() => ({ run: null as Rmr76CalculationRun | null }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ isPending: false, isFetching: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('../state/ProjectStorageContext.js', () => ({ useProjectStorage: () => ({ getItem: () => null }) }))
vi.mock('../state/persistentState.js', () => ({ usePersistentState: (key: string, value: unknown) => [key === 'geotechnical.run' ? saved.run : value, vi.fn()] }))
vi.mock('../data/localProjectDb.js', () => ({ effectiveDrillholes: () => [] }))
vi.mock('../state/DataPoolWorkspaceContext.js', () => ({ useDataPoolWorkspace: () => ({ live: true, project: { id: 'project' }, localDrillholeDraft: null, localTabularDrafts: {}, localSnapshot: { datasets: [], observations: [], variables: [], fieldLogging: { datasets: [] } } }) }))

it('opens Input without results and keeps the Result panel separate', () => {
  saved.run = null
  const html = renderToStaticMarkup(createElement(GeotechnicalPage, { onNavigate: vi.fn() }))
  expect(html).toContain('id="rmr-tab-input" role="tab" aria-selected="true"')
  expect(html).toContain('id="rmr-tab-result" role="tab" aria-selected="false"')
  expect(html).toContain('id="rmr-result-panel" role="tabpanel" aria-labelledby="rmr-tab-result" hidden=""')
  expect(html).not.toContain('geotech-empty-hero')
})

it('opens saved results as one table without the large setup or snapshot identifier', () => {
  saved.run = calculateRmr76Intervals([{ id: 'interval', holeId: 'DH-1', depthFrom: 0, depthTo: 3, candidates: [], lithology: '' }], new Set(), 'saved-run', '2026-10-05', 'internal-snapshot-must-not-be-visible')
  const html = renderToStaticMarkup(createElement(GeotechnicalPage, { onNavigate: vi.fn() }))
  expect(html).toContain('id="rmr-tab-result" role="tab" aria-selected="true"')
  expect(html).toContain('id="rmr-input-panel" role="tabpanel" aria-labelledby="rmr-tab-input" hidden=""')
  expect(html.match(/class="rmr-values-table"/g)).toHaveLength(1)
  expect(html).toContain('Missing: UCS, RQD, Joint spacing, Joint condition, Groundwater')
  expect(html).not.toContain('internal-snapshot-must-not-be-visible')
  expect(html).not.toContain('rmr-table-help')
})
