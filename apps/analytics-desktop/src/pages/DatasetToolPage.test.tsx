import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { DatasetToolWorkbench } from './DatasetToolPage.js'
vi.mock('../state/persistentState.js', () => ({ usePersistentState: (_key: string, value: unknown) => [value, vi.fn()] }))
it.each(['laboratory', 'xrf', 'spectral'] as const)('keeps imported headers and supplies selection and row actions for %s', section => {
  const markup = renderToStaticMarkup(createElement(DatasetToolWorkbench, {
    section, config: { columns: ['Hole_ID', 'Depth (m)', 'Fe (%)', 'Custom lab note'], rows: [['DH1', '10.5', '4.21', ''], ['DH1', '10.5', '4.21', '']], searchLabel: section }, onChangeRows: vi.fn(),
  }))
  expect(markup).toContain('Select all shown ' + section)
  expect(markup).toContain('Hole_ID')
  expect(markup).toContain('Depth (m)')
  expect(markup).toContain('Fe (%)')
  expect(markup).toContain('Custom lab note')
  expect(markup).toContain('Select ' + section + ' row 1')
  expect(markup).toContain('Select ' + section + ' row 2')
  expect(markup).toContain('Edit ' + section + ' row 1')
  expect(markup).toContain('Delete ' + section + ' row 1')
})
