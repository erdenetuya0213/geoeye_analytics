import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetPersistedStateMemory } from '../state/persistentState.js'
import { DrillholesPage } from './DrillholesPage.js'

vi.mock('../state/DataPoolWorkspaceContext.js', () => ({
  useDataPoolWorkspace: () => ({
    live: true,
    client: { drillholes: vi.fn() },
    localDrillholeDraft: {
      collar: [{ holeId: 'CSV-HOLE-001', easting: 500100, northing: 5300100, elevation: 1420 }],
      dirty: true,
      survey: [{ holeId: 'CSV-HOLE-001', depth: 125, azimuth: 42, dip: -60 }],
      updatedAt: '2026-10-04T00:00:00.000Z',
    },
    localLoading: false,
    localSnapshot: null,
    projectsLoading: false,
    project: { canWrite: true, id: 'project-1', name: 'Database project' },
    publishLocalDrillholes: vi.fn(),
    saveDrillholesLocally: vi.fn(),
    scope: 'test-user',
  }),
}))

const imported = {
  collar: [{ holeId: 'CSV-HOLE-001', easting: 500100, northing: 5300100, elevation: 1420 }],
  survey: [{ holeId: 'CSV-HOLE-001', depth: 125, azimuth: 42, dip: -60 }],
}

describe('DrillholesPage', () => {
  beforeEach(() => {
    resetPersistedStateMemory()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => key === 'geoeye.analytics.drillhole-import.v1' ? JSON.stringify(imported) : null,
          removeItem: vi.fn(),
          setItem: vi.fn(),
        },
      },
    })
  })

  it('shows imported CSV records instead of the Data Pool borehole list when signed in', () => {
    const queryClient = new QueryClient()
    const markup = renderToStaticMarkup(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(DrillholesPage),
    ))

    expect(markup).toContain('CSV-HOLE-001')
    expect(markup).toContain('Import CSV')
    expect(markup).toContain('Survey-derived drill trace for CSV-HOLE-001')
    expect(markup).toContain('125.0 m')
    expect(markup).toContain('42.0°')
    expect(markup).toContain('-60.0°')
    expect(markup).toContain('Survey stations')
    expect(markup).toContain('CRS not supplied')
    expect(markup).not.toContain('42.6°')
    expect(markup).not.toContain('GOR-DD-018')
  })
})
