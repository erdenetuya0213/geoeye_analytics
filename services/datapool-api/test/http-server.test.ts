import type {
  AnalysisRun,
  AnalysisResultPackageQuery,
  AnalysisResultPackageRecord,
  Collar,
  CollarInput,
  Dataset,
  DerivedValueInput,
  DrillholeSummary,
  ObservationQuery,
  ObservationValue,
  ProjectSummary,
  ProjectionBinding,
  ProjectionBindingInput,
  ProjectionRunResult,
  ProjectionStatus,
  ReplaceSurveysInput,
  SaveAnalysisResultPackageInput,
  SavedAnalysisResultPackage,
  SurveyStation,
  VariableDefinition,
} from '@geoeye/types'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDataPoolServer, type DataPoolServerOptions } from '../src/http-server.js'
import type { CreateAnalysisRunInput } from '../src/schemas.js'
import type { DataPoolStore } from '../src/store.js'

const projectId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const datasetId = '55555555-5555-4555-8555-555555555555'
const resultPackageId = '66666666-6666-4666-8666-666666666666'
const holeId = '99999999-9999-4999-8999-999999999999'
const analysisArtifactId = '77777777-7777-4777-8777-777777777777'
const graphArtifactId = '88888888-8888-4888-8888-888888888888'

const variable: VariableDefinition = {
  key: 'structure.alpha',
  displayName: 'Alpha',
  description: 'Core alpha angle.',
  dataType: 'numeric',
  canonicalUnit: 'deg',
  origin: 'primary',
  spatialSupport: 'orientation',
  compatibleAnalyses: ['structure.alpha_beta_conversion'],
}

const analysisRun: AnalysisRun = {
  id: runId,
  projectId,
  analysisType: 'structure.alpha_beta_conversion',
  algorithmVersion: '1.0.0',
  datasetSnapshot: {},
  parameters: {},
  createdBy: null,
  createdAt: '2026-09-30T00:00:00.000Z',
  status: 'draft',
}

const savedResultPackage: SavedAnalysisResultPackage = {
  id: resultPackageId,
  tenantKey: 'geoeye-demo',
  projectId,
  datasetId,
  analysisRunId: runId,
  feature: 'structure',
  templateVersion: 3,
  sourceFileName: 'DH-001-structures.csv',
  inputName: 'all-structures-equal-angle',
  analysisFileKey: 'tenants/geoeye-demo/projects/project/boreholes/dh-001/analytics/structure/v3/analysis.json',
  derivedFieldKeys: ['structure.true_dip'],
  artifactIds: [analysisArtifactId, graphArtifactId],
  createdAt: '2026-09-30T00:00:00.000Z',
}

class FakeStore implements DataPoolStore {
  readonly calls = {
    observations: [] as ObservationQuery[],
    createRun: [] as CreateAnalysisRunInput[],
    saveValues: [] as Array<{ runId: string; values: DerivedValueInput[] }>,
    saveResultPackages: [] as SaveAnalysisResultPackageInput[],
    listResultPackages: [] as AnalysisResultPackageQuery[],
    saveCollar: [] as Array<{ projectId: string; holeId: string; input: CollarInput }>,
    replaceSurveys: [] as Array<{ projectId: string; holeId: string; input: ReplaceSurveysInput }>,
    saveBindings: [] as ProjectionBindingInput[][],
    listBindings: [] as Array<string | null>,
    runProjection: [] as Array<{ projectId: string; force: boolean }>,
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return [{
      id: projectId,
      name: 'Gorge',
      description: null,
      isActive: true,
      drillholeCount: 1,
      organizationId: null,
      organizationName: null,
      canWrite: true,
    }]
  }

  async listDrillholes(id: string): Promise<DrillholeSummary[]> {
    return [{ id: holeId, projectId: id, name: 'UDD-103', collar: null, surveyStationCount: 0 }]
  }

  async listFieldLogging(id: string) {
    return {
      projectId: id,
      templates: [{ id: datasetId, name: 'Lithology', version: 3 }],
      submissions: [{
        projectId: id,
        holeId,
        holeName: 'UDD-103',
        templateId: datasetId,
        templateName: 'Lithology',
        templateVersion: 3,
        depthFrom: 0,
        depthTo: 120,
        selectedRowCount: 12,
        intervalCount: 24,
        structureCount: 0,
        generatedLogCount: 1,
        updatedAt: '2026-10-03T00:00:00.000Z',
      }],
    }
  }

  async saveCollar(id: string, hole: string, input: CollarInput): Promise<Collar> {
    this.calls.saveCollar.push({ projectId: id, holeId: hole, input })
    return {
      easting: input.easting,
      northing: input.northing,
      elevation: input.elevation,
      latitude: input.latitude,
      longitude: input.longitude,
      crs: { authority: input.crs.authority, code: input.crs.code, name: 'WGS 84 / UTM zone 48N' },
      surveyMethod: input.surveyMethod,
      accuracy: input.accuracy,
      source: input.source,
      updatedAt: '2026-10-03T00:00:00.000Z',
    }
  }

  async listSurveys(_projectId: string, _holeId: string): Promise<SurveyStation[]> {
    return []
  }

  async replaceSurveys(id: string, hole: string, input: ReplaceSurveysInput): Promise<SurveyStation[]> {
    this.calls.replaceSurveys.push({ projectId: id, holeId: hole, input })
    return input.stations.map((station, index) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
      measuredDepth: station.measuredDepth,
      azimuth: station.azimuth,
      dip: station.dip,
      surveyMethod: station.surveyMethod,
      tool: station.tool,
      accuracy: station.accuracy,
      source: station.source,
      surveyedAt: station.surveyedAt,
    }))
  }

  async listProjectionBindings(id: string | null): Promise<ProjectionBinding[]> {
    this.calls.listBindings.push(id)
    return []
  }

  async saveProjectionBindings(bindings: ProjectionBindingInput[]): Promise<ProjectionBinding[]> {
    this.calls.saveBindings.push(bindings)
    return bindings.map((binding) => ({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      projectId: binding.projectId,
      sourceEntityType: binding.sourceEntityType,
      sourceField: binding.sourceField,
      variableKey: binding.variableKey,
      extraction: binding.extraction,
      isActive: binding.isActive,
    }))
  }

  async listProjectionStatus(_projectId: string): Promise<ProjectionStatus[]> {
    return []
  }

  async runProjection(id: string, force: boolean): Promise<ProjectionRunResult> {
    this.calls.runProjection.push({ projectId: id, force })
    return { projectId: id, sources: [] }
  }

  async findLoginAccount(_email: string): Promise<null> {
    return null
  }

  async loadUserAccess(_userId: string): Promise<null> {
    return null
  }

  async getAnalysisRunProjectId(_runId: string): Promise<string | null> {
    return projectId
  }

  async listVariables(): Promise<VariableDefinition[]> {
    return [variable]
  }

  async listDatasets(_projectId: string): Promise<Dataset[]> {
    return []
  }

  async queryObservations(query: ObservationQuery): Promise<ObservationValue[]> {
    this.calls.observations.push(query)
    return []
  }

  async createAnalysisRun(input: CreateAnalysisRunInput, _createdBy: string | null): Promise<AnalysisRun> {
    this.calls.createRun.push(input)
    return analysisRun
  }

  async saveDerivedValues(id: string, values: DerivedValueInput[]): Promise<string[]> {
    this.calls.saveValues.push({ runId: id, values })
    return ['33333333-3333-4333-8333-333333333333']
  }

  async saveAnalysisResultPackage(
    input: SaveAnalysisResultPackageInput,
    _createdBy: string | null,
  ): Promise<SavedAnalysisResultPackage> {
    this.calls.saveResultPackages.push(input)
    return savedResultPackage
  }

  async listAnalysisResultPackages(query: AnalysisResultPackageQuery): Promise<AnalysisResultPackageRecord[]> {
    this.calls.listResultPackages.push(query)
    return [{
      ...savedResultPackage,
      artifacts: [{
        id: analysisArtifactId,
        boreholeId: null,
        artifactType: 'analysis_file',
        objectKey: savedResultPackage.analysisFileKey,
        fileName: 'analysis.json',
        mediaType: 'application/json',
        byteSize: null,
        checksumSha256: null,
        metadata: {},
      }],
    }]
  }

  async acceptAnalysisRun(_runId: string, _acceptedBy: string | null): Promise<AnalysisRun> {
    return { ...analysisRun, status: 'accepted' }
  }

  async close(): Promise<void> {}
}

const servers: ReturnType<typeof createDataPoolServer>[] = []

async function start(
  store: DataPoolStore,
  bearerToken?: string,
  options: Pick<DataPoolServerOptions, 'corsOrigins' | 'healthCheck' | 'accessLog'> = {},
): Promise<string> {
  const server = createDataPoolServer({
    store,
    logger: { error: vi.fn() },
    ...options,
    ...(bearerToken === undefined ? {} : { bearerToken }),
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error))
  })))
})

describe('Data Pool HTTP server', () => {
  it('serves the variable registry and keeps health public', async () => {
    const endpoint = await start(new FakeStore(), 'secret')

    const health = await fetch(`${endpoint}/health`)
    expect(health.status).toBe(200)

    const unauthorized = await fetch(`${endpoint}/v1/variables`)
    expect(unauthorized.status).toBe(401)

    const response = await fetch(`${endpoint}/v1/variables`, {
      headers: { Authorization: 'Bearer secret' },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([variable])
  })

  it('uses PostgreSQL readiness for health while keeping liveness independent', async () => {
    const healthCheck = vi.fn().mockRejectedValue(new Error('database unavailable'))
    const endpoint = await start(new FakeStore(), undefined, { healthCheck })

    const health = await fetch(`${endpoint}/health`)
    expect(health.status).toBe(503)
    await expect(health.json()).resolves.toEqual({ status: 'unavailable' })

    const live = await fetch(`${endpoint}/live`)
    expect(live.status).toBe(200)
    expect(healthCheck).toHaveBeenCalledOnce()
  })

  it('allows only configured browser origins', async () => {
    const endpoint = await start(new FakeStore(), undefined, {
      corsOrigins: new Set(['https://analytics.example.com']),
    })

    const allowed = await fetch(`${endpoint}/v1/variables`, {
      headers: { Origin: 'https://analytics.example.com' },
    })
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://analytics.example.com')
    expect(allowed.headers.get('x-content-type-options')).toBe('nosniff')

    const denied = await fetch(`${endpoint}/v1/variables`, {
      headers: { Origin: 'https://malicious.example.com' },
    })
    expect(denied.status).toBe(403)
  })

  it('leaves same-origin CORS handling to the browser when no allowlist is configured', async () => {
    const endpoint = await start(new FakeStore())
    const response = await fetch(`${endpoint}/v1/variables`, {
      headers: { Origin: endpoint },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('validates and normalizes an observation query', async () => {
    const store = new FakeStore()
    const endpoint = await start(store)
    const response = await fetch(`${endpoint}/v1/observations/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, variableKeys: ['structure.alpha'] }),
    })

    expect(response.status).toBe(200)
    expect(store.calls.observations).toEqual([{
      projectId,
      variableKeys: ['structure.alpha'],
      acceptedOnly: true,
    }])
  })

  it('rejects malformed input before calling the store', async () => {
    const store = new FakeStore()
    const endpoint = await start(store)
    const response = await fetch(`${endpoint}/v1/analysis-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'not-a-uuid' }),
    })

    expect(response.status).toBe(400)
    expect(store.calls.createRun).toEqual([])
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'validation_error' },
    })
  })

  it('persists derived values with explicit observation lineage', async () => {
    const store = new FakeStore()
    const endpoint = await start(store)
    const value = {
      variableKey: 'structure.true_dip',
      sourceEntityType: 'field.logging_structure',
      sourceEntityId: 'structure-1',
      holeId: null,
      depthFrom: 10,
      depthTo: 10.1,
      numericValue: 41.5,
      textValue: null,
      categoryValue: null,
      confidence: 0.95,
      status: 'saved' as const,
      inputObservationIds: ['44444444-4444-4444-8444-444444444444'],
    }
    const response = await fetch(`${endpoint}/v1/analysis-runs/${runId}/derived-values`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [value] }),
    })

    expect(response.status).toBe(201)
    expect(store.calls.saveValues).toEqual([{ runId, values: [value] }])
    await expect(response.json()).resolves.toEqual({
      ids: ['33333333-3333-4333-8333-333333333333'],
    })
  })

  it('catalogs a versioned analysis file and graph images together', async () => {
    const store = new FakeStore()
    const endpoint = await start(store)
    const input = {
      tenantKey: 'geoeye-demo',
      projectId,
      datasetId,
      analysisRunId: runId,
      feature: 'structure' as const,
      mode: 'overwrite' as const,
      fallbackTemplateVersion: 3,
      sourceFileName: 'DH-001-structures.csv',
      inputName: 'all-structures-equal-angle',
      analysisFileKey: savedResultPackage.analysisFileKey,
      derivedFieldKeys: ['structure.true_dip'],
      artifacts: [{
        boreholeId: null,
        artifactType: 'analysis_file' as const,
        objectKey: savedResultPackage.analysisFileKey,
        fileName: 'analysis.json',
        mediaType: 'application/json' as const,
      }, {
        boreholeId: null,
        artifactType: 'graph_image' as const,
        objectKey: 'tenants/geoeye-demo/projects/project/boreholes/dh-001/analytics/structure/v3/DH-001-structures__all-structures-equal-angle__stereonet__v3.png',
        fileName: 'DH-001-structures__all-structures-equal-angle__stereonet__v3.png',
        mediaType: 'image/png' as const,
      }],
    }
    const response = await fetch(`${endpoint}/v1/analysis-result-packages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })

    expect(response.status).toBe(201)
    expect(store.calls.saveResultPackages).toEqual([{
      ...input,
      metadata: {},
      artifacts: input.artifacts.map((artifact) => ({
        ...artifact,
        byteSize: null,
        checksumSha256: null,
        metadata: {},
      })),
    }])
    await expect(response.json()).resolves.toEqual(savedResultPackage)
  })

  it('rejects a package whose analysis file is missing from its artifacts', async () => {
    const store = new FakeStore()
    const endpoint = await start(store)
    const response = await fetch(`${endpoint}/v1/analysis-result-packages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantKey: 'geoeye-demo',
        projectId,
        datasetId,
        analysisRunId: runId,
        feature: 'structure',
        mode: 'overwrite',
        fallbackTemplateVersion: 3,
        sourceFileName: 'DH-001-structures.csv',
        inputName: 'all-structures-equal-angle',
        analysisFileKey: 'missing-analysis.json',
        derivedFieldKeys: [],
        artifacts: [{
          boreholeId: null,
          artifactType: 'graph_image',
          objectKey: 'graph.png',
          fileName: 'graph.png',
          mediaType: 'image/png',
        }],
      }),
    })

    expect(response.status).toBe(400)
    expect(store.calls.saveResultPackages).toEqual([])
  })

  it('lists reusable result packages by tenant, project, and borehole', async () => {
    const store = new FakeStore()
    const endpoint = await start(store)
    const boreholeId = '99999999-9999-4999-8999-999999999999'
    const response = await fetch(`${endpoint}/v1/analysis-result-packages?tenantKey=geoeye-demo&projectId=${projectId}&boreholeId=${boreholeId}`)

    expect(response.status).toBe(200)
    expect(store.calls.listResultPackages).toEqual([{ tenantKey: 'geoeye-demo', projectId, boreholeId }])
    await expect(response.json()).resolves.toMatchObject([{ id: resultPackageId, templateVersion: 3 }])
  })

  it('lists shared projects and their drillholes', async () => {
    const store = new FakeStore()
    const activeProjects = await store.listProjects()
    vi.spyOn(store, 'listProjects').mockResolvedValue([
      ...activeProjects,
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Archived project',
        description: null,
        isActive: false,
        drillholeCount: 0,
        organizationId: null,
        organizationName: null,
        canWrite: true,
      },
    ])
    const endpoint = await start(store)

    const projects = await fetch(`${endpoint}/v1/projects`)
    expect(projects.status).toBe(200)
    await expect(projects.json()).resolves.toEqual([
      expect.objectContaining({ id: projectId, drillholeCount: 1 }),
    ])

    const holes = await fetch(`${endpoint}/v1/projects/${projectId}/drillholes`)
    expect(holes.status).toBe(200)
    await expect(holes.json()).resolves.toMatchObject([{ id: holeId, name: 'UDD-103', collar: null }])

    const invalid = await fetch(`${endpoint}/v1/projects/not-a-uuid/drillholes`)
    expect(invalid.status).toBe(400)

    const logging = await fetch(`${endpoint}/v1/projects/${projectId}/logging`)
    expect(logging.status).toBe(200)
    await expect(logging.json()).resolves.toMatchObject({
      templates: [{ name: 'Lithology' }],
      submissions: [{ holeName: 'UDD-103', intervalCount: 24 }],
    })
  })

  it('saves a collar and normalizes optional fields', async () => {
    const store = new FakeStore()
    const endpoint = await start(store)

    const response = await fetch(`${endpoint}/v1/projects/${projectId}/drillholes/${holeId}/collar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        easting: 512345.6,
        northing: 5300120.1,
        elevation: 1420.5,
        crs: { authority: 'EPSG', code: '32648' },
        source: 'DGPS survey',
      }),
    })
    expect(response.status).toBe(200)
    expect(store.calls.saveCollar).toEqual([{
      projectId,
      holeId,
      input: {
        easting: 512345.6,
        northing: 5300120.1,
        elevation: 1420.5,
        latitude: null,
        longitude: null,
        crs: { authority: 'EPSG', code: '32648' },
        surveyMethod: null,
        accuracy: null,
        source: 'DGPS survey',
      },
    }])

    const rejected = await fetch(`${endpoint}/v1/projects/${projectId}/drillholes/${holeId}/collar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ easting: 1, northing: 2, elevation: 3, source: 'missing CRS' }),
    })
    expect(rejected.status).toBe(400)
    expect(store.calls.saveCollar).toHaveLength(1)
  })

  it('replaces a downhole survey and rejects invalid stations', async () => {
    const store = new FakeStore()
    const endpoint = await start(store)
    const url = `${endpoint}/v1/projects/${projectId}/drillholes/${holeId}/surveys`

    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stations: [
          { measuredDepth: 0, azimuth: 270, dip: -60, source: 'gyro' },
          { measuredDepth: 30, azimuth: 271.5, dip: -59.2, source: 'gyro' },
        ],
      }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toHaveLength(2)

    const duplicateDepth = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stations: [
          { measuredDepth: 10, azimuth: 0, dip: -60, source: 'gyro' },
          { measuredDepth: 10, azimuth: 5, dip: -61, source: 'gyro' },
        ],
      }),
    })
    expect(duplicateDepth.status).toBe(400)

    const badAzimuth = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stations: [{ measuredDepth: 0, azimuth: 360, dip: -60, source: 'gyro' }] }),
    })
    expect(badAzimuth.status).toBe(400)
    expect(store.calls.replaceSurveys).toHaveLength(1)

    const listed = await fetch(url)
    expect(listed.status).toBe(200)
  })

  it('manages projection bindings and triggers a projection run', async () => {
    const store = new FakeStore()
    const endpoint = await start(store)

    const saved = await fetch(`${endpoint}/v1/projection-bindings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bindings: [{
          projectId,
          sourceEntityType: 'field.logging_structure',
          sourceField: 'selections.alpha_angle',
          variableKey: 'structure.alpha',
          extraction: { kind: 'selection', key: 'alpha_angle' },
        }],
      }),
    })
    expect(saved.status).toBe(200)
    expect(store.calls.saveBindings[0]?.[0]).toMatchObject({ isActive: true, variableKey: 'structure.alpha' })

    const unknownExtraction = await fetch(`${endpoint}/v1/projection-bindings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bindings: [{
          projectId: null,
          sourceEntityType: 'field.logging_structure',
          sourceField: 'geometry',
          variableKey: 'structure.alpha',
          extraction: { kind: 'column', column: 'geometry_json' },
        }],
      }),
    })
    expect(unknownExtraction.status).toBe(400)

    await fetch(`${endpoint}/v1/projection-bindings`)
    await fetch(`${endpoint}/v1/projection-bindings?projectId=${projectId}`)
    expect(store.calls.listBindings).toEqual([null, projectId])

    const defaults = await fetch(`${endpoint}/v1/projects/${projectId}/projection`, { method: 'POST' })
    expect(defaults.status).toBe(200)
    const forced = await fetch(`${endpoint}/v1/projects/${projectId}/projection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    })
    expect(forced.status).toBe(200)
    expect(store.calls.runProjection).toEqual([
      { projectId, force: false },
      { projectId, force: true },
    ])

    const status = await fetch(`${endpoint}/v1/projects/${projectId}/projection`)
    expect(status.status).toBe(200)
  })

  it('tags every response with a request id and reports it to the access log', async () => {
    const entries: Array<{ requestId: string; method: string; path: string; status: number }> = []
    const endpoint = await start(new FakeStore(), 'secret', { accessLog: (entry) => entries.push(entry) })

    const response = await fetch(`${endpoint}/v1/projects?secret=do-not-log`)
    expect(response.status).toBe(401)
    const requestId = response.headers.get('x-request-id')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)

    await vi.waitFor(() => expect(entries).toHaveLength(1))
    expect(entries[0]).toMatchObject({ requestId, method: 'GET', path: '/v1/projects', status: 401 })
  })

  it('bounds an observation query page', async () => {
    const store = new FakeStore()
    const endpoint = await start(store)
    const query = { projectId, variableKeys: ['structure.alpha'] }

    const paged = await fetch(`${endpoint}/v1/observations/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...query, limit: 500, offset: 1000 }),
    })
    expect(paged.status).toBe(200)
    expect(store.calls.observations[0]).toMatchObject({ limit: 500, offset: 1000 })

    const tooLarge = await fetch(`${endpoint}/v1/observations/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...query, limit: 200_001 }),
    })
    expect(tooLarge.status).toBe(400)
  })
})
