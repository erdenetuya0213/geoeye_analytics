import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { StrengthPage } from './StrengthPage.js'

const mode = vi.hoisted(() => ({ active: 'schmidt' }))

vi.mock('../state/DataPoolWorkspaceContext.js', () => ({ useDataPoolWorkspace: () => ({ live: false, localTabularDrafts: {} }) }))
vi.mock('../state/ProjectStorageContext.js', () => ({ useProjectStorage: () => ({ getItem: () => null }) }))
vi.mock('../state/persistentState.js', () => ({ usePersistentState: (key: string, value: unknown) => [key === 'strength.activeMethod' ? mode.active : value, vi.fn()] }))
vi.mock('../data/pointLoadStore.js', () => ({
  createPointLoadRecord: vi.fn(), writePointLoadRecords: vi.fn(),
  readPointLoadRecords: () => [{ id: 'pl-1', holeId: 'DH1', sampleId: 'S1', depthFromM: 3, depthToM: 3, testType: 'diametral', peakLoadKn: 0.623, equivalentDiameterMm: 63, isMpa: 0.16, correctionFactor: 1.11, is50Mpa: 0.17, sourceFile: 'lab.csv', validBreak: true }],
}))

vi.mock('../data/schmidtStore.js', () => ({
  writeSchmidtRecords: vi.fn(),
  readSchmidtRecords: () => [{ id: 'record-1', holeId: 'DH-01', depthFromM: 1.01234, depthToM: 2.05678,
    reboundValue: 35.25, sampleId: 'hidden-generated-sample', sourceFile: 'hidden-source.csv', sourceRow: 99 }],
}))

it('shows only the four Smidth data columns without rounding imported values', () => {
  mode.active = 'schmidt'
  const markup = renderToStaticMarkup(createElement(StrengthPage))
  const table = markup.split('aria-label="Smidth records"')[1]!.split('</section>')[0]!
  expect(table).toContain('<span>Hole ID</span><span>From (m)</span><span>To (m)</span><span>Smidth value</span>')
  expect(table).toContain('DH-01')
  expect(table).toContain('1.01234')
  expect(table).toContain('2.05678')
  expect(table).toContain('35.25')
  expect(table).not.toContain('hidden-generated-sample')
  expect(table).not.toContain('hidden-source.csv')
  expect(table).not.toContain('CSV row')
  expect(markup).toContain('Select all shown Strength records')
  expect(table).toContain('Select Smidth reading DH-01')
  expect(table).toContain('Edit Smidth reading DH-01')
  expect(table).toContain('Delete Smidth reading DH-01')
})


it('shows imported point-load values and row actions without a quality column or filter', () => {
  mode.active = 'point-load'
  const markup = renderToStaticMarkup(createElement(StrengthPage))
  expect(markup).toContain('Select point-load test S1')
  expect(markup).toContain('Edit point-load test S1')
  expect(markup).toContain('Delete point-load test S1')
  expect(markup).toContain('0.17')
  expect(markup).not.toContain('<span>Quality</span>')
  expect(markup).not.toContain('strength-quality')
  expect(markup).not.toContain('Valid only')
  expect(markup).not.toContain('valid tests only')
})
