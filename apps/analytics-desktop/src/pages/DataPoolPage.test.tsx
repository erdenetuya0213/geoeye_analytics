import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ProjectSummaryPanel } from './DataPoolPage.js'

it('renders the project summary as group names, class names and numbers', () => {
  const markup = renderToStaticMarkup(createElement(ProjectSummaryPanel, {
    title: 'Tömörtolgoi',
    groups: [
      { label: 'Holes', rows: [{ name: 'Holes', value: '42' }] },
      { label: 'Logging', rows: [{ name: 'Geotechnical', note: '18 fields', value: '1,240 m' }] },
      { label: 'Lab', rows: [{ name: 'Au assay', value: '1,204' }] },
    ],
  }))
  expect(markup).toContain('Tömörtolgoi')
  for (const text of ['Holes', '42', 'Geotechnical', '18 fields', '1,240 m', 'Au assay', '1,204']) expect(markup).toContain(text)
  expect(markup).not.toContain('Refresh local copy')
  expect(markup.replace(/<[^>]+>/g, '|')).not.toMatch(/[a-z] [a-z]+ [a-z]+ [a-z]+ [a-z]+ [a-z]+/)
})
