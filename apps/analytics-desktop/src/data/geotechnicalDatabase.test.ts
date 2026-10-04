import type { Dataset, FieldLoggingDataset, ObservationValue, VariableDefinition } from '@geoeye/datapool-client'
import { describe, expect, it } from 'vitest'
import {
  buildDatabaseRmrSources,
  buildFieldLoggingRmrSources,
  buildMappedRmrDataset,
  isCompleteRmrMapping,
  type Rmr76ColumnMapping,
} from './geotechnicalDatabase.js'

const datasetId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const holeId = '33333333-3333-4333-8333-333333333333'

const dataset: Dataset = {
  createdAt: '2026-10-01T00:00:00.000Z',
  currentVersion: 2,
  description: null,
  id: datasetId,
  name: 'Uploaded geotech CSV',
  producerName: 'Laboratory',
  producerType: 'laboratory',
  projectId,
  sourceSystem: null,
  spatialSupport: 'interval',
  status: 'active',
  updatedAt: '2026-10-02T00:00:00.000Z',
}

function variable(key: string, displayName: string, dataType: VariableDefinition['dataType']): VariableDefinition {
  return {
    canonicalUnit: null,
    compatibleAnalyses: [],
    dataType,
    description: `${displayName} import`,
    displayName,
    key,
    metadata: { sourceColumn: displayName },
    origin: 'primary',
    spatialSupport: 'interval',
  }
}

const variables = [
  variable('strength.ucs_mpa', 'UCS MPa', 'numeric'),
  variable('laboratory.rqd', 'RQD', 'numeric'),
  variable('laboratory.spacing', 'Joint spacing', 'numeric'),
  variable('laboratory.condition', 'Joint condition', 'text'),
  variable('laboratory.water', 'Groundwater', 'text'),
  variable('laboratory.orientation', 'Orientation', 'text'),
]

function observation(variableKey: string, value: number | string, index: number): ObservationValue {
  return {
    booleanValue: null,
    categoryValue: null,
    datasetId,
    datasetVersionId: null,
    datetimeValue: null,
    depthFrom: 10,
    depthTo: 12,
    holeId,
    id: `44444444-4444-4444-8444-4444444444${String(index).padStart(2, '0')}`,
    numericValue: typeof value === 'number' ? value : null,
    observedAt: null,
    projectId,
    quality: 'accepted',
    sourceId: 'uploaded.csv:2',
    sourceType: 'analytics.csv.strength',
    textValue: typeof value === 'string' ? value : null,
    unit: null,
    variableKey,
  }
}

const observations = [
  observation('strength.ucs_mpa', 80, 1),
  observation('laboratory.rqd', 75, 2),
  observation('laboratory.spacing', 0.5, 3),
  observation('laboratory.condition', 'Slightly rough hard wall', 4),
  observation('laboratory.water', 'Moist', 5),
  observation('laboratory.orientation', 'Very favourable', 6),
]

const mapping: Rmr76ColumnMapping = {
  'geotech.ucs': 'strength.ucs_mpa',
  'geotech.rqd': 'laboratory.rqd',
  'structure.joint_spacing': 'laboratory.spacing',
  'geotech.joint_condition': 'laboratory.condition',
  'geotech.groundwater': 'laboratory.water',
  'structure.orientation_rating': 'laboratory.orientation',
}

describe('database RMR column mapping', () => {
  it('keeps uploaded datasets separate and exposes their observed columns', () => {
    const sources = buildDatabaseRmrSources([dataset], observations, variables, new Map([[holeId, 'DH-01']]))
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ recordCount: 1, dataset: { id: datasetId, name: 'Uploaded geotech CSV' } })
    expect(sources[0]?.columns.map((column) => column.key)).toEqual(expect.arrayContaining(variables.map((column) => column.key)))
  })

  it('does not consider an RMR setup complete until the user maps every parameter', () => {
    const { 'geotech.groundwater': _groundwater, ...incomplete } = mapping
    expect(isCompleteRmrMapping(incomplete)).toBe(false)
    expect(isCompleteRmrMapping(mapping)).toBe(true)
  })

  it('uses only the chosen columns and keeps a database row as one calculation interval', () => {
    const [source] = buildDatabaseRmrSources([dataset], observations, variables, new Map([[holeId, 'DH-01']]))
    const mapped = buildMappedRmrDataset(source!, mapping, 'slope')
    expect(mapped.intervals).toHaveLength(1)
    expect(mapped.intervals[0]).toMatchObject({ depthFrom: 10, depthTo: 12, holeId: 'DH-01' })
    expect(mapped.intervals[0]?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalKey: 'geotech.ucs', sourceFieldId: 'strength.ucs_mpa', value: 80 }),
      expect.objectContaining({ canonicalKey: 'geotech.joint_condition', value: 'slightly-rough-hard-wall' }),
      expect.objectContaining({ canonicalKey: 'structure.orientation_rating', value: { excavationType: 'slope', orientation: 'very-favourable' } }),
    ]))
  })

  it('uses exact Field template IDs and its real record count without guessing mappings', () => {
    const fieldDataset: FieldLoggingDataset = {
      category: 'geotechnical',
      columns: [
        { dataType: 'category', key: 'field_strength', label: 'Field strength (ISRM)', unit: null },
        { dataType: 'category', key: 'groundwater_condition', label: 'Seepage condition', unit: null },
      ],
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Geotechnical by Neguun',
      records: [{
        depthFrom: 10,
        depthTo: 12,
        holeId,
        id: 'field-row-1',
        values: { field_strength: 'R4', groundwater_condition: 'Damp' },
      }],
      updatedAt: '2026-10-03T00:00:00.000Z',
      version: 87,
    }
    const [source] = buildFieldLoggingRmrSources([fieldDataset], new Map([[holeId, 'DH-01']]))
    expect(source).toMatchObject({
      columns: [
        { key: 'field_strength', sourceColumn: 'Field strength (ISRM)' },
        { key: 'groundwater_condition', sourceColumn: 'Seepage condition' },
      ],
      recordCount: 1,
    })
    expect(source?.records[0]?.values).toEqual({ field_strength: 'R4', groundwater_condition: 'Damp' })
  })
})
