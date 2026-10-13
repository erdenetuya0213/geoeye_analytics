import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { EdaDataset } from '../data/edaTypes.js'
import type { EdaObservation } from '../analysis/eda.js'

const state = vi.hoisted(() => ({ datasets: [] as unknown[], pending: false }))
vi.mock('../state/persistentState.js', () => ({ usePersistentState: (_key: string, value: unknown) => [value, vi.fn()] }))
vi.mock('../data/liveEda.js', () => ({ useProjectEdaDatasets: () => ({ data: state.datasets, isPending: state.pending }) }))
vi.mock('../components/GeoEyeChart.js', () => ({ GeoEyeChart: (props: { exportName?: string; option: unknown }) => createElement('div', { 'data-chart': props.exportName, 'data-option': JSON.stringify(props.option) }) }))
vi.mock('../components/SaveExportBar.js', () => ({ SaveExportBar: (props: { tables: { name: string; csv: () => string }[] }) => createElement('footer', { 'data-tables': props.tables.map((table) => `${table.name}:${table.csv().split('\n').length}`).join(',') }) }))

const { StrengthCorrelationPage } = await import('./StrengthCorrelationPage.js')

let counter = 0
const obs = (holeId: string, depthFrom: number, depthTo: number, values: Record<string, number | null>, dimensions: Record<string, string> = {}): EdaObservation => {
  counter += 1
  return { id: `o${counter}`, joinKey: `${holeId}:${depthFrom}:${counter}`, dimensions, sourceObservationId: `s${counter}`, sampleId: `S${counter}`, holeId, depthFrom, depthTo, easting: 0, northing: 0, lithology: 'Sandstone', values }
}
const variable = (key: string, label: string) => ({ dataType: 'numeric' as const, decimals: 1, key, label, shortLabel: label, unit: '' })
const make = (id: string, name: string, observations: EdaObservation[], variables: ReturnType<typeof variable>[], dimensions: { key: string; label: string }[] = []): EdaDataset => ({ dimensions, id, name, observations, producer: 't', project: 't', snapshotAt: '2026-10-07', source: 'live', support: 'interval', variables })

describe('StrengthCorrelationPage', () => {
  it('asks for data when the project has no datasets', () => {
    state.datasets = []
    expect(renderToStaticMarkup(createElement(StrengthCorrelationPage))).toContain('No datasets in this project')
  })

  it('renders the three charts, the findings and the exportable tables from guessed sources', () => {
    const schmidt = [20, 22, 24, 26, 28, 40, 42, 44, 46, 48].map((r, i) => obs('H1', i + 1, i + 2, { smidth: r }))
    const grades = [obs('H1', 0, 6, {}, { field_strength: 'R2 Weak rock' }), obs('H1', 6, 12, {}, { field_strength: 'R4 Strong rock' })]
    const pli = [2.5, 4.5, 7.5, 9.5].map((depth) => obs('H1', depth, depth, { is50: 0.15 }))
    const lab = [obs('Project', Number.NaN, Number.NaN, { ucs: 45 }, { test_type: 'UCS' }), obs('Project', Number.NaN, Number.NaN, { ucs: 55 }, { test_type: 'UCS' })]
    state.datasets = [
      make('neguun', 'Geotechnical by Neguun', [...schmidt, ...grades], [variable('smidth', 'Smidth')], [{ key: 'field_strength', label: 'Field strength' }]),
      make('pli', 'Imported PLI', pli, [variable('is50', 'Is(50)')]),
      make('lab', 'Laboratory strength', lab, [variable('ucs', 'Strength')], [{ key: 'test_type', label: 'Test type' }]),
    ]
    const markup = renderToStaticMarkup(createElement(StrengthCorrelationPage))
    expect(markup).toContain('data-chart="strength-schmidt-by-grade"')
    expect(markup).toContain('data-chart="strength-pli-vs-schmidt"')
    expect(markup).toContain('data-chart="strength-ucs-comparison"')
    expect(markup).toContain('Schmidt R by logged ISRM grade')
    expect(markup).toContain('Median Schmidt R follows the logged ISRM grade')
    expect(markup).toMatch(/lower than the/) // point-load unit warning
    expect(markup).toContain('data-tables="schmidt-by-grade:4,pli-vs-schmidt:6,ucs-summary:5,by-hole:3"')
    expect(markup).toContain('Lab test')
    expect(markup).toContain('identical values on one axis') // constant point-load values → no correlation
    expect(markup).toContain('values do not vary across the pairs')
  })
})
