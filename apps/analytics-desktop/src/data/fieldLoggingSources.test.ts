import { describe, expect, it } from 'vitest'
import type { FieldLoggingDataset } from '@geoeye/datapool-client'
import { buildLocalEdaDatasets } from './liveEda.js'
import { numericFromCodedColumns } from './fieldLoggingSources.js'

const HOLE = '0a6c0c5d-1217-4c04-8422-912003ad6de0'

function dataset(smidth: Array<string | null>, grades: Array<string | null> = []): FieldLoggingDataset {
  return {
    category: 'Geotechnical',
    columns: [
      { dataType: 'category', key: 'smidth', label: 'Smidth', unit: null },
      { dataType: 'category', key: 'field_strength', label: 'Field strength (ISRM)', unit: null },
    ],
    id: 'geotech-neguun',
    name: 'Geotechnical by Neguun',
    records: smidth.map((value, index) => ({
      depthFrom: index, depthTo: index + 1, holeId: HOLE, id: `r${index}`,
      values: { smidth: value, field_strength: grades[index] ?? null },
    })),
    updatedAt: '2026-10-07T00:00:00.000Z',
    version: 1,
  }
}

describe('coded numeric logging fields', () => {
  it('turns a dropdown that only holds <prefix>:<number> codes into a numeric column', () => {
    const result = numericFromCodedColumns(dataset(['relog-unassigned:40', 'relog-unassigned:0', null, 'relog-unassigned:52.5']))
    expect(result.columns.find((column) => column.key === 'smidth')?.dataType).toBe('numeric')
    expect(result.records.map((record) => record.values.smidth)).toEqual([40, 0, null, 52.5])
  })

  it('leaves lettered codes, mixed values, real dictionary ids and plain digits as categories', () => {
    for (const values of [
      ['relog-unassigned:S3', 'relog-unassigned:S2'],
      ['relog-unassigned:40', 'e4e912ce-f0d8-453f-a7d3-33456f50ae93'],
      ['relog-unassigned:40', 'other-prefix:41'],
      ['1', '2', '3'],
    ]) {
      const source = dataset(values)
      expect(numericFromCodedColumns(source)).toBe(source)
    }
  })

  it('makes the field usable as a numeric analysis variable and keeps the grade as a category', () => {
    const source = dataset(['relog-unassigned:40', 'relog-unassigned:45'], ['R3 Medium strong rock', 'R3 Medium strong rock'])
    const snapshot = {
      fieldLogging: { datasets: [source], projectId: HOLE, submissions: [], templates: [] },
      datasets: [], drillholes: [], observations: [], project: { id: HOLE, name: 'P' }, variables: [],
    }
    const [eda] = buildLocalEdaDatasets(snapshot as never, null, {}, { id: HOLE, name: 'P' } as never)
      ? buildLocalEdaDatasets(snapshot as never, null, {}, { id: HOLE, name: 'P' } as never).filter((item) => item.name.includes('Neguun') && !item.name.startsWith('All'))
      : []
    expect(eda?.variables.find((variable) => variable.key === 'smidth')?.dataType).toBe('numeric')
    expect(eda?.variables.find((variable) => variable.key === 'field_strength')?.dataType).toBe('category')
    expect(eda?.observations.map((observation) => observation.values.smidth)).toEqual([40, 45])
  })
})
