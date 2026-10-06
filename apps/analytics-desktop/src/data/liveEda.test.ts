import type { DataPoolClient, ProjectSummary } from '@geoeye/datapool-client'
import { describe, expect, it, vi } from 'vitest'
import { buildLocalEdaDatasets, edaDatasetKind, loadLiveEdaDatasets } from './liveEda.js'
import type { LocalProjectSnapshot } from './localProjectDb.js'

const project: ProjectSummary = {
  canWrite: true,
  description: null,
  drillholeCount: 1,
  id: '00000000-0000-4000-8000-000000000001',
  isActive: true,
  name: 'Connected project',
  organizationId: '00000000-0000-4000-8000-000000000002',
  organizationName: 'GeoEye',
}

describe('live EDA adapter', () => {
  it('preserves concentration units in common underscored import headers for evidence mapping', () => {
    const result = buildLocalEdaDatasets(null, null, {
      laboratory: { columns: ['BHID', 'From', 'To', 'Cu_ppm', 'Au_ppb', 'Mo (mg/kg)', 'Ag_g_t'], dirty: true, fileName: 'assay.csv',
        rows: [['DH-1', '0', '1', '2000', '500', '60', '8']], section: 'laboratory', updatedAt: '2026-10-06T00:00:00Z' },
    }, project)
    const variables = result.find(dataset => dataset.id === 'local-csv-laboratory')!.variables
    expect(variables.find(v => v.label === 'Cu_ppm')?.unit).toBe('ppm')
    expect(variables.find(v => v.label === 'Au_ppb')?.unit).toBe('ppb')
    expect(variables.find(v => v.label === 'Mo (mg/kg)')?.unit).toBe('mg/kg')
    expect(variables.find(v => v.label === 'Ag_g_t')?.unit).toBe('g/t')
  })
  it('indexes imported point depths and leaves missing locations unmatched', () => {
    const result = buildLocalEdaDatasets(null, null, {
      xrf: { columns: ['BHID', 'Depth (m)', 'Cu ppm'], dirty: true, fileName: 'xrf.csv',
        rows: [['DH_001', '12.5', '4'], ['DH_001', '', '9']], section: 'xrf', updatedAt: '2026-10-05T00:00:00Z' },
    }, project)
    const rows = result.find(dataset => dataset.id === 'local-csv-xrf')!.observations
    expect(rows[0]).toMatchObject({ depthFrom: 12.5, depthTo: 12.5, locationValid: true })
    expect(rows[1]?.locationValid).toBe(false)
    expect(rows[1]?.depthFrom).toBeNaN()
    expect(rows[1]?.joinKey).not.toBe(rows[0]?.joinKey)
  })
  it('makes locally imported collars and surveys available to analytical features without a cloud snapshot', () => {
    const result = buildLocalEdaDatasets(null, {
      collar: [{ crs: 'EPSG:32648', easting: 500_100, elevation: 1_420, holeId: 'DH-001', northing: 4_700_200 }],
      dirty: true,
      survey: [
        { azimuth: 125, depth: 0, dip: -60, holeId: 'DH001' },
        { azimuth: 130, depth: 50, dip: -62, holeId: 'DH001' },
      ],
      updatedAt: '2026-10-04T02:00:00.000Z',
    }, {}, project)

    expect(result.map((dataset) => dataset.id)).toEqual(['local-drillhole-collars', 'local-drillhole-surveys'])
    expect(result[0]?.observations[0]).toMatchObject({
      easting: 500_100,
      holeId: 'DH-001',
      northing: 4_700_200,
      values: {
        'collar.easting': 500_100,
        'collar.elevation': 1_420,
        'collar.northing': 4_700_200,
      },
    })
    expect(result[1]?.observations).toHaveLength(2)
    expect(result[1]?.observations[1]).toMatchObject({
      depthFrom: 50,
      holeId: 'DH-001',
      values: { 'survey.azimuth': 130, 'survey.dip': -62, 'survey.measured_depth': 50 },
    })
  })

  it('turns an unsent local CSV draft into an analytical dataset', () => {
    const result = buildLocalEdaDatasets(null, null, {
      laboratory: {
        columns: ['Sample ID', 'Hole ID', 'From', 'To', 'Au g/t', 'Lithology'],
        dirty: true,
        fileName: 'assays.csv',
        rows: [['A-1', 'DH-001', '10', '12', '1.42', 'Diorite']],
        section: 'laboratory',
        updatedAt: '2026-10-04T03:00:00.000Z',
      },
    }, project)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'local-csv-laboratory',
      name: 'Laboratory CSV imports · local',
      project: 'Connected project',
      source: 'live',
    })
    expect(result[0]?.variables).toEqual(expect.arrayContaining([
      expect.objectContaining({ dataType: 'numeric', key: 'laboratory.au_g_t', unit: 'g/t' }),
      expect.objectContaining({ dataType: 'category', key: 'laboratory.lithology' }),
    ]))
    expect(result[0]?.observations[0]).toMatchObject({
      depthFrom: 10,
      depthTo: 12,
      holeId: 'DH-001',
      lithology: 'Diorite',
      sampleId: 'A-1',
      values: { 'laboratory.au_g_t': 1.42 },
    })
  })

  it('exposes cached logging data and a drillhole-depth integrated view alongside lab data', () => {
    const holeId = '00000000-0000-4000-8000-000000000004'
    const snapshot: LocalProjectSnapshot = {
      datasets: [],
      drillholes: [{
        collar: {
          accuracy: null,
          crs: { authority: 'EPSG', code: '32648', name: 'WGS 84 / UTM zone 48N' },
          easting: 500_100,
          elevation: 1_420,
          latitude: null,
          longitude: null,
          northing: 4_700_200,
          source: 'Field',
          surveyMethod: null,
          updatedAt: '2026-10-04T00:00:00.000Z',
        },
        id: holeId,
        name: 'DH-001',
        projectId: project.id,
        surveyStationCount: 0,
      }],
      fieldLogging: {
        datasets: [{
          category: 'Geotechnical',
          columns: [
            { dataType: 'numeric', key: 'logging.rqd', label: 'RQD', unit: '%' },
            { dataType: 'category', key: 'logging.lithology', label: 'Lithology', unit: null },
          ],
          id: 'core-log',
          name: 'Core logging',
          records: [{ depthFrom: 10, depthTo: 12, holeId, id: 'log-row-1', values: { 'logging.lithology': 'Diorite', 'logging.rqd': 88 } }],
          updatedAt: '2026-10-04T03:00:00.000Z',
          version: 2,
        }],
        projectId: project.id,
        submissions: [],
        templates: [],
      },
      fieldStructures: [],
      observations: [],
      project,
      projection: [],
      refreshedAt: '2026-10-04T03:00:00.000Z',
      surveysByHoleId: {},
      variables: [],
      version: 1,
    }
    const result = buildLocalEdaDatasets(snapshot, null, {
      laboratory: {
        columns: ['Sample ID', 'Hole ID', 'From', 'To', 'Au g/t', 'Batch'],
        dirty: true,
        fileName: 'assays.csv',
        rows: [['A-1', 'DH-001', '10', '12', '1.42', 'B-7']],
        section: 'laboratory',
        updatedAt: '2026-10-04T04:00:00.000Z',
      },
    }, project)

    expect(result.map(edaDatasetKind)).toEqual(['integrated', 'laboratory', 'logging', 'drillholes'])
    expect(result.find((dataset) => edaDatasetKind(dataset) === 'logging')).toMatchObject({
      id: 'local-field-logging-core-log',
      observations: [expect.objectContaining({ lithology: 'Diorite', values: { 'logging.rqd': 88 } })],
    })
    expect(result[0]?.variables.map((variable) => variable.key)).toEqual(expect.arrayContaining(['laboratory.au_g_t', 'logging.rqd', 'collar.easting']))
    expect(result[0]?.dimensions.map((dimension) => dimension.key)).toEqual(expect.arrayContaining(['assay_source', 'logging_source', 'logging.lithology']))
    expect(result[0]?.observations[0]).toMatchObject({
      dimensions: expect.objectContaining({ data_coverage: 'Logging + Lab / Assay', 'logging.lithology': 'Diorite' }),
      values: expect.objectContaining({ 'laboratory.au_g_t': 1.42, 'logging.rqd': 88 }),
    })
  })

  it('groups normalized project observations into analytical rows with lineage and collar coordinates', async () => {
    const datasetId = '00000000-0000-4000-8000-000000000003'
    const holeId = '00000000-0000-4000-8000-000000000004'
    const baseObservation = {
      booleanValue: null,
      categoryValue: null,
      datasetId,
      datasetVersionId: null,
      datetimeValue: null,
      depthFrom: 10,
      depthTo: 12,
      holeId,
      observedAt: '2026-10-04T00:00:00.000Z',
      projectId: project.id,
      quality: 'accepted' as const,
      sourceId: 'field-row-1',
      sourceType: 'field.core_row',
      textValue: null,
      unit: null,
    }
    const client = {
      datasets: vi.fn().mockResolvedValue([{
        createdAt: '2026-10-04T00:00:00.000Z',
        currentVersion: 2,
        description: null,
        id: datasetId,
        name: 'Geotechnical log',
        producerName: 'GeoEye Field',
        producerType: 'field',
        projectId: project.id,
        sourceSystem: 'field.core_row',
        spatialSupport: 'interval',
        status: 'active',
        updatedAt: '2026-10-04T01:00:00.000Z',
      }]),
      drillholes: vi.fn().mockResolvedValue([{
        collar: {
          accuracy: null,
          crs: { authority: 'EPSG', code: '32648', name: 'WGS 84 / UTM zone 48N' },
          easting: 500_100,
          elevation: 1_420,
          latitude: null,
          longitude: null,
          northing: 4_700_200,
          source: 'Field',
          surveyMethod: null,
          updatedAt: '2026-10-04T00:00:00.000Z',
        },
        id: holeId,
        name: 'DH-001',
        projectId: project.id,
        surveyStationCount: 2,
      }]),
      queryObservations: vi.fn().mockResolvedValue([
        {
          ...baseObservation,
          id: '00000000-0000-4000-8000-000000000005',
          numericValue: 82,
          variableKey: 'geotech.rqd',
        },
        {
          ...baseObservation,
          categoryValue: 'Diorite',
          id: '00000000-0000-4000-8000-000000000006',
          numericValue: null,
          variableKey: 'geology.lithology',
        },
      ]),
      variables: vi.fn().mockResolvedValue([
        {
          canonicalUnit: '%', compatibleAnalyses: ['geotechnical.rmr'], dataType: 'numeric', description: 'RQD', displayName: 'RQD', key: 'geotech.rqd', origin: 'primary', spatialSupport: 'interval',
        },
        {
          canonicalUnit: null, compatibleAnalyses: ['domain'], dataType: 'category', description: 'Lithology', displayName: 'Lithology', key: 'geology.lithology', origin: 'primary', spatialSupport: 'interval',
        },
      ]),
    } as unknown as DataPoolClient

    const result = await loadLiveEdaDatasets(client, project)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: datasetId, project: project.name, source: 'live' })
    expect(result[0]?.observations).toEqual([
      expect.objectContaining({
        easting: 500_100,
        holeId: 'DH-001',
        lithology: 'Diorite',
        northing: 4_700_200,
        sourceObservationIds: [
          '00000000-0000-4000-8000-000000000005',
          '00000000-0000-4000-8000-000000000006',
        ],
        values: { 'geotech.rqd': 82 },
      }),
    ])
  })

  it('does not fall back to demo snapshots when a connected project has no datasets', async () => {
    const client = {
      datasets: vi.fn().mockResolvedValue([]),
      drillholes: vi.fn().mockResolvedValue([]),
      variables: vi.fn().mockResolvedValue([]),
    } as unknown as DataPoolClient

    await expect(loadLiveEdaDatasets(client, project)).resolves.toEqual([])
  })
})
