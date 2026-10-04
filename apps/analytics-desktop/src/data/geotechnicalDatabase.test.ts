import type { Dataset, FieldLoggingDataset, ObservationValue, VariableDefinition } from '@geoeye/datapool-client'
import { describe, expect, it } from 'vitest'
import {
  buildDatabaseRmrSources,
  buildFieldLoggingRmrSources,
  buildJoinedRmrDataset,
  buildMappedRmrDataset,
  isCompleteRmrMapping,
  rmrSourceOptionLabel,
  type DatabaseRmrSource,
  type Rmr76ColumnMapping,
  type Rmr76ParameterSourceMapping,
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

const sourceMapping: Rmr76ParameterSourceMapping = {
  'geotech.ucs': { columnKey: 'ucs', sourceId: 'source-strength' },
  'geotech.rqd': { columnKey: 'rqd', sourceId: 'source-rqd' },
  'structure.joint_spacing': { columnKey: 'spacing', sourceId: 'source-spacing' },
  'geotech.joint_condition': { columnKey: 'condition', sourceId: 'source-condition' },
  'geotech.groundwater': { columnKey: 'water', sourceId: 'source-water' },
  'structure.orientation_rating': { columnKey: 'orientation', sourceId: 'source-orientation' },
}

function joinSource(id: string, key: string, value: number | string, overrides: Partial<DatabaseRmrSource['records'][number]> = {}): DatabaseRmrSource {
  const numeric = typeof value === 'number'
  return {
    columns: [{ canonicalUnit: null, dataType: numeric ? 'numeric' : 'text', displayName: key, key, sourceColumn: key }],
    coveredHoleCount: 1,
    dataset: { currentVersion: 1, id, name: id, updatedAt: '2026-10-03T00:00:00.000Z' },
    holeNames: new Map([[holeId, 'DH-01']]),
    parentTemplateId: null,
    recordCount: 1,
    records: [{
      depthFrom: 10,
      depthTo: 12,
      holeId,
      id: `${id}:row-1`,
      observationIds: { [key]: `${id}:observation-1` },
      values: { [key]: value },
      ...overrides,
    }],
    sourceKind: 'database',
  }
}

const joinSources = [
  joinSource('source-strength', 'ucs', 80),
  joinSource('source-rqd', 'rqd', 75),
  joinSource('source-spacing', 'spacing', 0.5),
  joinSource('source-condition', 'condition', 'Slightly rough hard wall'),
  joinSource('source-water', 'water', 'Moist'),
  joinSource('source-orientation', 'orientation', 'Very favourable'),
]

describe('database RMR column mapping', () => {
  it('uses a scoped interval mean only for missing joint conditions with estimated lineage', () => {
    const sources = joinSources.map(source => ({ ...source, records: [10, 20, 30, 40].map(depthFrom => ({
      ...source.records[0]!, id: `${source.dataset.id}:${depthFrom}`, depthFrom, depthTo: depthFrom + 2,
      values: source.dataset.id === 'source-condition'
        ? (depthFrom === 20 ? {} : { condition: depthFrom === 10 ? 15 : depthFrom === 30 ? 99 : 25 })
        : source.records[0]!.values,
    })) }))
    const joined = buildJoinedRmrDataset(sources, sourceMapping, 'slope', { useJointConditionMean: true })
    expect(joined.diagnostics).toMatchObject({ jointConditionMean: 20, jointConditionSampleCount: 2, jointConditionEstimatedCount: 1 })
    const candidate = (depth: number) => joined.dataset.intervals.find(interval => interval.depthFrom === depth)
      ?.candidates.find(input => input.canonicalKey === 'geotech.joint_condition')
    expect(candidate(10)).toMatchObject({ availability: 'direct', value: 15 })
    expect(candidate(20)).toMatchObject({ availability: 'fallback', value: 20, sourceLabel: expect.stringContaining('estimated scoped mean') })
    expect(candidate(30)).toMatchObject({ availability: 'direct', value: 99 })
    const scoped = buildJoinedRmrDataset(sources, sourceMapping, 'slope', {
      useJointConditionMean: true, inScope: record => record.depthFrom! < 30,
    })
    expect(scoped.diagnostics).toMatchObject({ jointConditionMean: 15, jointConditionSampleCount: 1, jointConditionEstimatedCount: 1 })
    expect(buildJoinedRmrDataset(sources, sourceMapping, 'slope').dataset.intervals.find(interval => interval.depthFrom === 20)).toBeUndefined()
  })

  it('does not invent a joint-condition mean when no valid ratings exist', () => {
    const sources = joinSources.map(source => source.dataset.id === 'source-condition'
      ? { ...source, records: source.records.map(record => ({ ...record, values: {} })) } : source)
    const joined = buildJoinedRmrDataset(sources, sourceMapping, 'slope', { useJointConditionMean: true })
    expect(joined.diagnostics).toMatchObject({ jointConditionMean: null, jointConditionSampleCount: 0, jointConditionEstimatedCount: 0 })
    expect(joined.dataset.intervals).toHaveLength(0)
  })

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
      sourceKind: 'field-template',
    })
    expect(source?.records[0]?.values).toEqual({ field_strength: 'R4', groundwater_condition: 'Damp' })
  })

  it('links completed CSV versions to their live parent and reports export coverage honestly', () => {
    const templateId = '55555555-5555-4555-8555-555555555555'
    const makeRecord = (id: string, sourceHoleId: string): FieldLoggingDataset['records'][number] => ({
      depthFrom: 10,
      depthTo: 12,
      holeId: sourceHoleId,
      id,
      values: { condition: 'rough' },
    })
    const datasets: FieldLoggingDataset[] = [{
      category: 'geotechnical',
      columns: [{ dataType: 'text', key: 'condition', label: 'Condition', unit: null }],
      id: templateId,
      name: 'Structure auto',
      records: [makeRecord('live-1', holeId), makeRecord('live-2', '66666666-6666-4666-8666-666666666666')],
      updatedAt: '2026-10-03T00:00:00.000Z',
      version: 35,
    }, {
      category: 'geotechnical',
      columns: [{ dataType: 'text', key: 'csv:Condition', label: 'Condition', unit: null }],
      id: `${templateId}:generated:v34`,
      name: 'Structure auto · generated CSV',
      records: [makeRecord('export-1', holeId)],
      updatedAt: '2026-10-02T00:00:00.000Z',
      version: 34,
    }]
    const sources = buildFieldLoggingRmrSources(datasets, new Map())
    expect(sources.map((source) => source.sourceKind)).toEqual(['field-template', 'generated-csv'])
    expect(sources[1]).toMatchObject({ coveredHoleCount: 1, parentTemplateId: templateId })
    expect(rmrSourceOptionLabel(sources[1]!, sources)).toBe('↳ Structure auto · completed CSV v34 · 1 exported rows · 1/2 holes')
  })

  it('retains empty templates and unpopulated fields regardless of template category', () => {
    const templates: FieldLoggingDataset[] = ['geotechnical', 'lithology', null].map((category, index) => ({
      category,
      columns: [{ dataType: 'numeric', key: 'unpopulated', label: 'Unpopulated value', unit: null }],
      id: `template-${index}`,
      name: index === 2 ? 'Colour' : `Template ${index}`,
      records: [],
      updatedAt: '2026-10-03T00:00:00.000Z',
      version: 1,
    }))
    const sources = buildFieldLoggingRmrSources(templates, new Map())
    expect(sources).toHaveLength(3)
    for (const source of sources) {
      expect(source.columns).toEqual([expect.objectContaining({ key: 'unpopulated' })])
      expect(source.recordCount).toBe(0)
      expect(source.records).toEqual([])
    }
  })

  it('joins independently selected source templates only on an exact hole and interval key', () => {
    const joined = buildJoinedRmrDataset(joinSources, sourceMapping, 'tunnel')
    expect(joined.diagnostics).toMatchObject({ complete: true, matchedBoreholeCount: 1, matchedIntervalCount: 1 })
    expect(joined.dataset.intervals).toHaveLength(1)
    expect(joined.dataset.intervals[0]).toMatchObject({ depthFrom: 10, depthTo: 12, holeId: 'DH-01' })
    expect(joined.dataset.intervals[0]?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalKey: 'geotech.ucs', sourceLabel: 'source-strength', value: 80 }),
      expect.objectContaining({ canonicalKey: 'geotech.rqd', sourceLabel: 'source-rqd', value: 75 }),
      expect.objectContaining({ canonicalKey: 'structure.orientation_rating', sourceLabel: 'source-orientation', value: { excavationType: 'tunnel', orientation: 'very-favourable' } }),
    ]))
  })

  it('rejects a different borehole or interval boundary instead of performing a nearest-depth join', () => {
    const mismatched = joinSources.map((source) => source.dataset.id === 'source-rqd'
      ? { ...source, records: [{ ...source.records[0]!, depthTo: 12.01 }] }
      : source)
    const joined = buildJoinedRmrDataset(mismatched, sourceMapping, 'tunnel')
    expect(joined.diagnostics.matchedIntervalCount).toBe(0)
    expect(joined.diagnostics.parameters['geotech.rqd']).toMatchObject({ sourceIntervalCount: 1, unmatchedIntervalCount: 1 })
    expect(joined.dataset.intervals).toEqual([])
  })
})
