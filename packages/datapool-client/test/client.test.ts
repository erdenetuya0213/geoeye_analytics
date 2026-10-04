import { describe, expect, it, vi } from 'vitest'
import { DataPoolClient, DataPoolError } from '../src/index.js'

describe('DataPoolClient', () => {
  it('uses the configured endpoint and authorization provider', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            key: 'structure.alpha',
            displayName: 'Alpha',
            description: 'Core alpha angle.',
            dataType: 'numeric',
            canonicalUnit: 'deg',
            origin: 'primary',
            spatialSupport: 'orientation',
            compatibleAnalyses: ['structure.alpha_beta_conversion'],
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const client = new DataPoolClient({
      endpoint: 'http://localhost:8080/',
      accessToken: () => 'test-token',
      fetch: fetchMock,
    })

    await expect(client.variables()).resolves.toHaveLength(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost:8080/v1/variables')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token')
  })

  it('surfaces non-success responses as DataPoolError', async () => {
    const client = new DataPoolClient({
      endpoint: 'http://localhost:8080',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ message: 'not available' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    })

    await expect(client.variables()).rejects.toMatchObject<DataPoolError>({ status: 503 })
  })

  it('validates and posts an analysis result package', async () => {
    const responseBody = {
      id: '66666666-6666-4666-8666-666666666666',
      tenantKey: 'geoeye-demo',
      projectId: '11111111-1111-4111-8111-111111111111',
      datasetId: '55555555-5555-4555-8555-555555555555',
      analysisRunId: '22222222-2222-4222-8222-222222222222',
      feature: 'structure',
      templateVersion: 3,
      sourceFileName: 'DH-001-structures.csv',
      inputName: 'all-structures-equal-angle',
      analysisFileKey: 'tenants/geoeye-demo/projects/project/boreholes/dh-001/analytics/structure/v3/analysis.json',
      derivedFieldKeys: ['structure.true_dip'],
      artifactIds: ['77777777-7777-4777-8777-777777777777'],
      createdAt: '2026-09-30T00:00:00.000Z',
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify(responseBody),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ))
    const client = new DataPoolClient({ endpoint: 'http://localhost:8080', fetch: fetchMock })
    const input = {
      tenantKey: responseBody.tenantKey,
      projectId: responseBody.projectId,
      datasetId: responseBody.datasetId,
      analysisRunId: responseBody.analysisRunId,
      feature: 'structure' as const,
      mode: 'overwrite' as const,
      fallbackTemplateVersion: 3,
      sourceFileName: responseBody.sourceFileName,
      inputName: responseBody.inputName,
      analysisFileKey: responseBody.analysisFileKey,
      derivedFieldKeys: responseBody.derivedFieldKeys,
      artifacts: [{
        boreholeId: null,
        artifactType: 'analysis_file' as const,
        objectKey: responseBody.analysisFileKey,
        fileName: 'analysis.json',
        mediaType: 'application/json' as const,
        byteSize: null,
        checksumSha256: null,
        metadata: {},
      }],
      metadata: {},
    }

    await expect(client.saveAnalysisResultPackage(input)).resolves.toEqual(responseBody)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost:8080/v1/analysis-result-packages')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(input)
  })

  it('posts an explicit tabular Database import', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111'
    const responseBody = {
      dataset: {
        id: '55555555-5555-4555-8555-555555555555',
        projectId,
        name: 'XRF CSV imports',
        description: null,
        producerType: 'instrument',
        producerName: 'Portable XRF',
        sourceSystem: 'geoeye.analytics.csv',
        spatialSupport: 'point',
        status: 'active',
        currentVersion: 1,
        createdAt: '2026-10-04T00:00:00.000Z',
        updatedAt: '2026-10-04T00:00:00.000Z',
      },
      importedRows: 1,
      observationCount: 1,
      unmatchedHoles: [],
      version: 1,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify(responseBody),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ))
    const client = new DataPoolClient({ endpoint: 'http://localhost:8080', fetch: fetchMock })
    const input = { columns: ['Hole ID', 'Cu ppm'], fileName: 'xrf.csv', rows: [['DH-1', '1200']], section: 'xrf' as const }

    await expect(client.saveTabularImport(projectId, input)).resolves.toEqual(responseBody)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://localhost:8080/v1/projects/${projectId}/tabular-imports`)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(input)
  })

  it('queries reusable result packages for the 3D workspace', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111'
    const boreholeId = '99999999-9999-4999-8999-999999999999'
    const responseBody = [{
      id: '66666666-6666-4666-8666-666666666666',
      tenantKey: 'geoeye-demo',
      projectId,
      datasetId: '55555555-5555-4555-8555-555555555555',
      analysisRunId: '22222222-2222-4222-8222-222222222222',
      feature: 'geotechnical',
      templateVersion: 4,
      sourceFileName: 'DH-001-geotech.csv',
      inputName: 'rmr76-full-hole',
      analysisFileKey: 'tenants/geoeye-demo/projects/project/boreholes/dh-001/analytics/geotechnical/v4/analysis.json',
      derivedFieldKeys: ['geotech.rmr76'],
      artifactIds: ['77777777-7777-4777-8777-777777777777'],
      artifacts: [{
        id: '77777777-7777-4777-8777-777777777777',
        boreholeId,
        artifactType: 'analysis_file',
        objectKey: 'tenants/geoeye-demo/projects/project/boreholes/dh-001/analytics/geotechnical/v4/analysis.json',
        fileName: 'analysis.json',
        mediaType: 'application/json',
        byteSize: 321,
        checksumSha256: null,
        metadata: {},
      }],
      createdAt: '2026-10-03T00:00:00.000Z',
    }]
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify(responseBody),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const client = new DataPoolClient({ endpoint: 'http://localhost:8080', fetch: fetchMock })

    await expect(client.analysisResultPackages({
      tenantKey: 'geoeye-demo',
      projectId,
      boreholeId,
      feature: 'geotechnical',
    })).resolves.toEqual(responseBody)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `http://localhost:8080/v1/analysis-result-packages?tenantKey=geoeye-demo&projectId=${projectId}&boreholeId=${boreholeId}&feature=geotechnical`,
    )
  })

  it('reads shared projects and writes collar and survey data', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111'
    const holeId = '22222222-2222-4222-8222-222222222222'
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const collar = {
      easting: 512345.6,
      northing: 5300120.1,
      elevation: 1420.5,
      latitude: null,
      longitude: null,
      crs: { authority: 'EPSG', code: '32648', name: 'WGS 84 / UTM zone 48N' },
      surveyMethod: null,
      accuracy: null,
      source: 'DGPS survey',
      updatedAt: '2026-10-03T00:00:00.000Z',
    }
    const client = new DataPoolClient({
      endpoint: 'https://data.example.com/',
      fetch: async (input, init) => {
        const url = String(input)
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined
        calls.push({ url, method: init?.method ?? 'GET', body })
        const payload = url.endsWith('/v1/projects')
          ? [{ id: projectId, name: 'Gorge', description: null, isActive: true, drillholeCount: 1, organizationId: null, organizationName: null, canWrite: true }]
          : url.endsWith('/logging/structures')
            ? [{
                alpha: 38,
                beta: 126,
                depthFrom: 27.73,
                depthTo: 27.73,
                holeId,
                id: '55555555-5555-4555-8555-555555555555',
                orientationStatus: 'review_required',
                projectId,
                reviewStatus: 'draft',
                structureType: 'Joint',
                templateId: '44444444-4444-4444-8444-444444444444',
              }]
            : url.endsWith('/logging')
            ? {
                projectId,
                templates: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Lithology', version: 2 }],
                submissions: [{
                  projectId,
                  holeId,
                  holeName: 'UDD-103',
                  templateId: '44444444-4444-4444-8444-444444444444',
                  templateName: 'Lithology',
                  templateVersion: 2,
                  depthFrom: 0,
                  depthTo: 120,
                  selectedRowCount: 4,
                  intervalCount: 12,
                  structureCount: 0,
                  generatedLogCount: 1,
                  updatedAt: '2026-10-03T00:00:00.000Z',
                }],
              }
          : url.endsWith('/drillholes')
            ? [{ id: holeId, projectId, name: 'UDD-103', collar, surveyStationCount: 1 }]
            : url.endsWith('/collar')
              ? collar
              : url.endsWith('/surveys')
                ? [{
                    id: '33333333-3333-4333-8333-333333333333',
                    measuredDepth: 0,
                    azimuth: 270,
                    dip: -60,
                    surveyMethod: null,
                    tool: null,
                    accuracy: null,
                    source: 'gyro',
                    surveyedAt: null,
                  }]
                : { projectId, sources: [] }
        return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
      },
    })

    await expect(client.projects()).resolves.toHaveLength(1)
    await expect(client.drillholes(projectId)).resolves.toMatchObject([{ name: 'UDD-103' }])
    await expect(client.fieldLogging(projectId)).resolves.toMatchObject({ submissions: [{ templateName: 'Lithology' }] })
    await expect(client.fieldLoggingStructures(projectId)).resolves.toMatchObject([{
      alpha: 38,
      beta: 126,
      reviewStatus: 'draft',
    }])
    await client.saveCollar(projectId, holeId, {
      easting: 512345.6,
      northing: 5300120.1,
      elevation: 1420.5,
      crs: { authority: 'EPSG', code: '32648' },
      source: 'DGPS survey',
    })
    await client.replaceSurveys(projectId, holeId, {
      stations: [{ measuredDepth: 0, azimuth: 270, dip: -60, source: 'gyro' }],
    })
    await expect(client.runProjection(projectId)).resolves.toEqual({ projectId, sources: [] })

    expect(calls.map(({ url, method }) => `${method} ${url.replace('https://data.example.com', '')}`)).toEqual([
      'GET /v1/projects',
      `GET /v1/projects/${projectId}/drillholes`,
      `GET /v1/projects/${projectId}/logging`,
      `GET /v1/projects/${projectId}/logging/structures`,
      `PUT /v1/projects/${projectId}/drillholes/${holeId}/collar`,
      `PUT /v1/projects/${projectId}/drillholes/${holeId}/surveys`,
      `POST /v1/projects/${projectId}/projection`,
    ])
    expect(calls[4]?.body).toMatchObject({ latitude: null, surveyMethod: null })
    expect(calls[6]?.body).toEqual({ force: false })
  })

  it('rejects an invalid survey before sending it', async () => {
    const fetchSpy = vi.fn()
    const client = new DataPoolClient({ endpoint: 'https://data.example.com', fetch: fetchSpy })
    await expect(client.replaceSurveys(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      { stations: [{ measuredDepth: 0, azimuth: 400, dip: -60, source: 'gyro' }] },
    )).rejects.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('calls the global fetch without rebinding it to the client', async () => {
    // Browsers reject a fetch call whose receiver is not the global object.
    const original = globalThis.fetch
    let receiver: unknown = 'not called'
    globalThis.fetch = function (this: unknown) {
      receiver = this
      return Promise.resolve(new Response('[]', { headers: { 'content-type': 'application/json' } }))
    } as typeof fetch
    try {
      await new DataPoolClient({ endpoint: 'https://data.example.com' }).projects()
    } finally {
      globalThis.fetch = original
    }
    expect(receiver === globalThis || receiver === undefined).toBe(true)
  })

  it('signs in and reads the session, treating a non-user credential as no session', async () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'geologist@astrogeo.test',
      displayName: 'G. Logger',
      role: 'geologist',
      isPlatformAdmin: false,
    }
    const bodies: unknown[] = []
    const client = new DataPoolClient({
      endpoint: 'https://data.example.com',
      fetch: async (input, init) => {
        const url = String(input)
        if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body))
        if (url.endsWith('/v1/auth/login')) {
          return new Response(JSON.stringify({
            accessToken: 'header.payload.signature',
            tokenType: 'bearer',
            expiresAt: '2026-10-04T12:00:00.000Z',
            user,
            organizations: [],
          }), { headers: { 'content-type': 'application/json' } })
        }
        return new Response(JSON.stringify({ error: { code: 'not_found' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    const result = await client.login({ email: ' Geologist@AstroGeo.test', password: 'secret' })
    expect(result.accessToken).toBe('header.payload.signature')
    expect(bodies).toEqual([{ email: 'geologist@astrogeo.test', password: 'secret' }])
    await expect(client.session()).resolves.toBeNull()
  })
})
