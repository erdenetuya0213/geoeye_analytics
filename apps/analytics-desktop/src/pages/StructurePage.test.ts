import type { DataPoolClient, ProjectSummary } from '@geoeye/datapool-client'
import { describe, expect, it, vi } from 'vitest'
import { loadLiveStructureData } from './StructurePage.js'

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

const alphaKey = {
  canonicalUnit: 'deg',
  compatibleAnalyses: ['structure.stereonet'],
  dataType: 'numeric',
  description: 'Alpha',
  displayName: 'Alpha',
  key: 'structure.alpha',
  origin: 'primary',
  spatialSupport: 'orientation',
}

const betaKey = { ...alphaKey, description: 'Beta', displayName: 'Beta', key: 'structure.beta' }
const structureTypeKey = {
  ...alphaKey,
  canonicalUnit: null,
  dataType: 'category',
  description: 'Structure type',
  displayName: 'Structure type',
  key: 'structure.type',
}

function dataset(id: string, name: string) {
  return {
    createdAt: '2026-10-04T00:00:00.000Z',
    currentVersion: 3,
    description: null,
    id,
    name,
    producerName: 'GeoEye Field',
    producerType: 'field',
    projectId: project.id,
    sourceSystem: 'field.logging_structure',
    spatialSupport: 'orientation',
    status: 'active',
    updatedAt: '2026-10-04T01:00:00.000Z',
  }
}

describe('live structure adapter', () => {
  it('uses every live Field logging template and keeps its observations selectable', async () => {
    const structureDatasetId = '00000000-0000-4000-8000-000000000003'
    const firstTemplateId = '00000000-0000-4000-8000-000000000004'
    const secondTemplateId = '00000000-0000-4000-8000-000000000005'
    const emptyTemplateId = '00000000-0000-4000-8000-000000000006'
    const holeId = '00000000-0000-4000-8000-000000000007'
    const observations = [firstTemplateId, secondTemplateId].flatMap((sourceTemplateId, datasetIndex) => (
      ['structure.alpha', 'structure.beta', 'structure.type'].map((variableKey, variableIndex) => ({
        categoryValue: variableKey === 'structure.type' ? (datasetIndex === 0 ? 'Joint' : 'Fault') : null,
        datasetId: structureDatasetId,
        depthFrom: 10 + datasetIndex,
        holeId,
        id: `30000000-0000-4000-8000-${String(8 + datasetIndex * 3 + variableIndex).padStart(12, '0')}`,
        numericValue: variableKey === 'structure.alpha'
          ? 35 + datasetIndex
          : variableKey === 'structure.beta' ? 120 + datasetIndex : null,
        sourceId: `structure-${datasetIndex + 1}`,
        sourceTemplateId,
        textValue: null,
        variableKey,
      }))
    ))
    const client = {
      datasets: vi.fn().mockResolvedValue([dataset(structureDatasetId, 'GeoEye Field structural logging')]),
      drillholes: vi.fn().mockResolvedValue([{
        collar: { easting: 500_000, elevation: 1_400, northing: 4_700_000 },
        id: holeId,
        name: 'DH-001',
      }]),
      fieldLogging: vi.fn().mockResolvedValue({
        projectId: project.id,
        submissions: [{
          depthFrom: 22,
          depthTo: 23,
          generatedLogCount: 0,
          holeId,
          holeName: 'DH-001',
          intervalCount: 0,
          projectId: project.id,
          selectedRowCount: 0,
          structureCount: 2,
          templateId: emptyTemplateId,
          templateName: 'New structure campaign',
          templateVersion: 1,
          updatedAt: '2026-10-04T01:00:00.000Z',
        }],
        templates: [
          { id: firstTemplateId, name: 'Oriented core structures', version: 7 },
          { id: secondTemplateId, name: 'Geotechnical joints', version: 4 },
          { id: emptyTemplateId, name: 'New structure campaign', version: 1 },
        ],
      }),
      fieldLoggingStructures: vi.fn().mockResolvedValue([]),
      queryObservations: vi.fn().mockResolvedValue(observations),
      surveys: vi.fn().mockResolvedValue([{ azimuth: 45, dip: -60, measuredDepth: 0 }]),
      variables: vi.fn().mockResolvedValue([alphaKey, betaKey, structureTypeKey]),
    } as unknown as DataPoolClient

    const result = await loadLiveStructureData(client, project)

    expect(result.templates).toEqual([
      { datasetId: structureDatasetId, id: firstTemplateId, label: 'Oriented core structures · v7', observationCount: 1 },
      { datasetId: structureDatasetId, id: secondTemplateId, label: 'Geotechnical joints · v4', observationCount: 1 },
      { datasetId: structureDatasetId, id: emptyTemplateId, label: 'New structure campaign · v1', observationCount: 0 },
    ])
    expect(result.observationsByTemplate[firstTemplateId]).toEqual([
      expect.objectContaining({ alpha: 35, beta: 120, depth: 10, holeId: 'DH-001', structureType: 'Joint' }),
    ])
    expect(result.observationsByTemplate[secondTemplateId]).toEqual([
      expect.objectContaining({ alpha: 36, beta: 121, depth: 11, holeId: 'DH-001', structureType: 'Fault' }),
    ])
    expect(result.observationsByTemplate[emptyTemplateId]).toEqual([])
    expect(result.drillholesByTemplate[emptyTemplateId]).toEqual(['DH-001'])
    expect(client.datasets).toHaveBeenCalledWith(project.id)
    expect(client.fieldLogging).toHaveBeenCalledWith(project.id)
    expect(client.fieldLoggingStructures).toHaveBeenCalledWith(project.id)
    expect(client.queryObservations).toHaveBeenCalledWith(expect.objectContaining({
      acceptedOnly: true,
      variableKeys: ['structure.alpha', 'structure.beta', 'structure.type'],
    }))
  })

  it('uses complete draft Alpha/Beta rows from the selected source logging template', async () => {
    const structureDatasetId = '00000000-0000-4000-8000-000000000003'
    const templateId = '00000000-0000-4000-8000-000000000004'
    const holeId = '00000000-0000-4000-8000-000000000007'
    const client = {
      datasets: vi.fn().mockResolvedValue([dataset(structureDatasetId, 'GeoEye Field structural logging')]),
      drillholes: vi.fn().mockResolvedValue([{
        collar: { easting: 500_000, elevation: 1_400, northing: 4_700_000 },
        id: holeId,
        name: 'TT2026-002-GT',
      }]),
      fieldLogging: vi.fn().mockResolvedValue({
        projectId: project.id,
        submissions: [{
          depthFrom: 20,
          depthTo: 21,
          generatedLogCount: 0,
          holeId,
          holeName: 'TT_2026_002GT',
          intervalCount: 0,
          projectId: project.id,
          selectedRowCount: 0,
          structureCount: 2,
          templateId,
          templateName: 'Structure auto',
          templateVersion: 34,
          updatedAt: '2026-10-04T01:00:00.000Z',
        }],
        templates: [{ id: templateId, name: 'Structure auto', version: 34 }],
      }),
      fieldLoggingStructures: vi.fn().mockResolvedValue([{
        alpha: 42,
        beta: 282,
        depthFrom: 20.5,
        depthTo: 20.5,
        holeId,
        id: '00000000-0000-4000-8000-000000000009',
        orientationStatus: 'review_required',
        projectId: project.id,
        reviewStatus: 'draft',
        structureType: 'Joint',
        templateId,
      }]),
      queryObservations: vi.fn().mockResolvedValue([]),
      surveys: vi.fn().mockResolvedValue([]),
      variables: vi.fn().mockResolvedValue([alphaKey, betaKey, structureTypeKey]),
    } as unknown as DataPoolClient

    const result = await loadLiveStructureData(client, project)

    expect(result.templates).toEqual([{
      datasetId: structureDatasetId,
      id: templateId,
      label: 'Structure auto · v34',
      observationCount: 1,
    }])
    expect(result.observationsByTemplate[templateId]).toEqual([{
      alpha: 42,
      beta: 282,
      depth: 20.5,
      holeId: 'TT2026-002-GT',
      id: '00000000-0000-4000-8000-000000000009',
      structureType: 'Joint',
    }])
    expect(result.drillholesByTemplate[templateId]).toEqual(['TT2026-002-GT'])
  })
})
