import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { ClassDataPage } from './ClassDataPage.js'

const tables = vi.hoisted(() => ({ value: [] as unknown[] }))

vi.mock('../state/DataPoolWorkspaceContext.js', () => ({ useDataPoolWorkspace: () => ({ live: false, localTabularDrafts: {} }) }))
vi.mock('../state/ProjectStorageContext.js', () => ({ useProjectStorage: () => ({ getItem: () => null }) }))
vi.mock('../state/persistentState.js', () => ({ usePersistentState: (key: string, value: unknown) => [key.endsWith('.activeClass') ? 't2' : value, vi.fn()] }))
vi.mock('../data/classTableStore.js', () => ({ writeClassTables: vi.fn(), tableFromImport: () => [], readClassTables: () => tables.value }))

it.each([['strength', 'Add test'], ['laboratory', 'Add class']] as const)('starts %s with no built-in classes', (section, addLabel) => {
  tables.value = []
  const markup = renderToStaticMarkup(createElement(ClassDataPage, { section }))
  expect(markup).toContain(addLabel)
  expect(markup).not.toMatch(/role="tab"/)
  expect(markup).not.toMatch(/point.load|schmidt|smidth|au g\/t/i)
  expect(markup).toContain('<span>Hole ID</span><span>Sample ID</span><span>From</span><span>To</span><span>Actions</span>')
})

it('shows one tab per user-named class and the active class with its own columns, unrounded', () => {
  tables.value = [
    { id: 't1', name: 'Point load', columns: ['Hole ID', 'Sample ID', 'From', 'To', 'Is(50) (MPa)'], rows: [['DH1', 'S1', '3', '3', '0.17']] },
    { id: 't2', name: 'My rebound', columns: ['Hole ID', 'Sample ID', 'From', 'To', 'R value'], rows: [['DH-01', 'S9', '1.01234', '2.05678', '35.25']] },
  ]
  const markup = renderToStaticMarkup(createElement(ClassDataPage, { section: 'strength' }))
  expect(markup).toMatch(/aria-selected="false"[^>]*>Point load <span>1<\/span>/)
  expect(markup).toMatch(/aria-selected="true"[^>]*>My rebound <span>1<\/span>/)
  expect(markup).toContain('<span>To</span><span>R value</span><span>Actions</span>')
  for (const value of ['DH-01', 'S9', '1.01234', '2.05678', '35.25']) expect(markup).toContain(value)
  expect(markup).not.toContain('0.17')
  expect(markup).toContain('Rename My rebound')
  expect(markup).toContain('Delete My rebound')
  expect(markup).toContain('Edit strength row 1')
})
