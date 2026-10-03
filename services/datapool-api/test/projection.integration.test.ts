import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDataPoolServer } from '../src/http-server.js'
import {
  applyDevelopmentPrerequisites,
  runMigrations,
  seedCoreVariables,
} from '../src/migrations.js'
import { PostgresDataPoolStore } from '../src/postgres-store.js'
import { runAllProjections } from '../src/projection.js'
import { createIsolatedDatabase, type IsolatedDatabase } from './postgres-harness.js'

const connectionString = process.env.TEST_DATABASE_URL
const describeWithPostgres = connectionString === undefined ? describe.skip : describe

const projectId = '20000000-0000-4000-8000-000000000001'
const emptyProjectId = '20000000-0000-4000-8000-000000000002'
const holeId = '20000000-0000-4000-8000-000000000011'
const otherHoleId = '20000000-0000-4000-8000-000000000012'
const boxId = '20000000-0000-4000-8000-000000000021'
const acceptedRowId = '20000000-0000-4000-8000-000000000031'
const pendingRowId = '20000000-0000-4000-8000-000000000032'
const invalidRowId = '20000000-0000-4000-8000-000000000033'
const roughItemId = '20000000-0000-4000-8000-000000000041'
const acceptedStructureId = '20000000-0000-4000-8000-000000000051'
const draftStructureId = '20000000-0000-4000-8000-000000000052'
const negativeDepthStructureId = '20000000-0000-4000-8000-000000000053'
const invalidValueStructureId = '20000000-0000-4000-8000-000000000054'

interface ObservationPayload {
  id: string
  sourceId: string
  variableKey: string
  numericValue: number | null
  categoryValue: string | null
  quality: string
  holeId: string | null
  depthFrom: number | null
}

interface RunPayload {
  sources: Array<{
    sourceEntityType: string
    outcome: string
    sourceRowCount: number
    observationCount: number
    issueSummary: Record<string, number>
    message: string | null
  }>
}

// The API runs with the grants of database/production/geoeye_api_role.sql (applied to a
// throwaway role), so these tests also prove that the runtime role can do everything
// the API needs and nothing to Field tables.
describeWithPostgres('Field projection and shared drillhole data', () => {
  let database: IsolatedDatabase
  let admin: Pool
  let runtime: Pool
  let server: Server
  let endpoint = ''

  async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; payload: T }> {
    const response = await fetch(`${endpoint}${path}`, {
      method,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    })
    return { status: response.status, payload: await response.json() as T }
  }

  async function project(force = false): Promise<RunPayload['sources']> {
    const response = await api<RunPayload>('POST', `/v1/projects/${projectId}/projection`, { force })
    expect(response.status).toBe(200)
    return response.payload.sources
  }

  async function observations(variableKeys: string[], acceptedOnly = true): Promise<ObservationPayload[]> {
    const response = await api<ObservationPayload[]>('POST', '/v1/observations/query', {
      projectId,
      variableKeys,
      acceptedOnly,
    })
    expect(response.status).toBe(200)
    return response.payload
  }

  beforeAll(async () => {
    database = await createIsolatedDatabase(connectionString as string)
    admin = database.admin
    await applyDevelopmentPrerequisites(admin)
    await runMigrations(admin)
    await seedCoreVariables(admin)

    runtime = new Pool({ connectionString: await database.provisionRuntimeRole() })

    await admin.query(`
      INSERT INTO projects (id, name) VALUES ($1, 'Gorge'), ($2, 'Empty project')
    `, [projectId, emptyProjectId])
    await admin.query(`
      INSERT INTO drill_holes (id, project_id, hole_name)
      VALUES ($1, $3, 'UDD-103'), ($2, $3, 'UDD-104')
    `, [holeId, otherHoleId, projectId])
    await admin.query(
      'INSERT INTO core_boxes (id, project_id, hole_id, box_number) VALUES ($1, $2, $3, 1)',
      [boxId, projectId, holeId],
    )
    await admin.query(`
      INSERT INTO core_rows (
        id, project_id, hole_id, box_id, row_number, depth_from, depth_to,
        stage3_rqd_json, stage_status, stage3_accepted_at
      ) VALUES
        ($1, $4, $5, $6, 1, 27, 28.2, '{"rqd_pct": 78.5, "ff_per_m": 4.2}', 'complete', now()),
        ($2, $4, $5, $6, 2, 28.2, 29.4, '{"rqd_pct": 55}', 'stage3_done', NULL),
        ($3, $4, $5, $6, 3, 29.4, 30.6, '{"rqd_pct": 140}', 'complete', now())
    `, [acceptedRowId, pendingRowId, invalidRowId, projectId, holeId, boxId])
    await admin.query(`
      WITH category AS (
        INSERT INTO dictionary_categories (project_id, name) VALUES ($1, 'Joint roughness') RETURNING id
      )
      INSERT INTO dictionary_items (id, category_id, code, name)
      SELECT $2, category.id, 'R', 'Rough' FROM category
    `, [projectId, roughItemId])
    await admin.query(`
      INSERT INTO logging_structures (
        id, project_id, hole_id, row_id, class_id, depth_from, depth_to, angle_deg,
        selections_json, review_status
      ) VALUES
        ($1, $5, $6, $7, 'structure_type', 27.73, 27.73, 41.2, $8::jsonb, 'accepted'),
        ($2, $5, $6, $7, 'structure_type', 27.9, 27.9, NULL, '{"alpha": 50}', 'draft'),
        ($3, $5, $6, $7, 'structure_type', -1, 2, NULL, '{"alpha": 20}', 'accepted'),
        ($4, $5, $6, $7, 'structure_type', 28.1, 28.1, NULL, '{"alpha": "steep"}', 'accepted')
    `, [
      acceptedStructureId, draftStructureId, negativeDepthStructureId, invalidValueStructureId,
      projectId, holeId, acceptedRowId,
      JSON.stringify({ alpha: '38', beta: 126, roughness: roughItemId }),
    ])

    server = createDataPoolServer({ store: new PostgresDataPoolStore(runtime) })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }, 60_000)

  afterAll(async () => {
    await new Promise<void>((done, fail) => {
      server.close((error) => error === undefined ? done() : fail(error))
    })
    await runtime.end()
    await database.drop()
  })

  it('projects accepted Field structures and RQD without touching Field rows', async () => {
    const fieldBefore = await admin.query('SELECT * FROM logging_structures ORDER BY id')

    const sources = await project()
    expect(sources).toEqual([
      {
        sourceEntityType: 'field.logging_structure',
        outcome: 'projected',
        datasetId: expect.any(String),
        sourceRowCount: 4,
        observationCount: 4,
        issueCount: 3,
        issueSummary: { unaccepted_source: 1, invalid_depth: 1, invalid_value: 1 },
        message: null,
      },
      {
        sourceEntityType: 'field.core_row',
        outcome: 'projected',
        datasetId: expect.any(String),
        sourceRowCount: 3,
        observationCount: 1,
        issueCount: 2,
        issueSummary: { unaccepted_source: 1, invalid_value: 1 },
        message: null,
      },
    ])

    const structural = await observations([
      'structure.alpha', 'structure.beta', 'structure.apparent_angle', 'joint.roughness',
    ])
    expect(structural.map(({ variableKey, numericValue, categoryValue, sourceId }) => (
      { variableKey, numericValue, categoryValue, sourceId }
    ))).toEqual([
      { variableKey: 'joint.roughness', numericValue: null, categoryValue: 'Rough', sourceId: acceptedStructureId },
      { variableKey: 'structure.alpha', numericValue: 38, categoryValue: null, sourceId: acceptedStructureId },
      { variableKey: 'structure.apparent_angle', numericValue: 41.2, categoryValue: null, sourceId: acceptedStructureId },
      { variableKey: 'structure.beta', numericValue: 126, categoryValue: null, sourceId: acceptedStructureId },
    ])
    expect(structural.every((value) => value.holeId === holeId && value.depthFrom === 27.73)).toBe(true)

    await expect(observations(['geotech.rqd'])).resolves.toMatchObject([
      { sourceId: acceptedRowId, numericValue: 78.5, quality: 'accepted', depthFrom: 27 },
    ])

    const datasets = await api<Array<{ name: string; producerType: string }>>('GET', `/v1/datasets?projectId=${projectId}`)
    expect(datasets.payload.map((dataset) => dataset.name)).toEqual([
      'GeoEye Field RQD',
      'GeoEye Field structural logging',
    ])
    const versions = await admin.query<{ name: string; record_count: string }>(`
      SELECT dataset.name, version.record_count::text
      FROM dataset_versions AS version JOIN datasets AS dataset ON dataset.id = version.dataset_id
      ORDER BY dataset.name
    `)
    expect(versions.rows).toEqual([
      { name: 'GeoEye Field RQD', record_count: '1' },
      { name: 'GeoEye Field structural logging', record_count: '4' },
    ])

    const fieldAfter = await admin.query('SELECT * FROM logging_structures ORDER BY id')
    expect(fieldAfter.rows).toEqual(fieldBefore.rows)
  })

  it('skips unchanged sources and keeps observation ids stable across updates', async () => {
    const before = await observations(['structure.alpha'])
    expect((await project()).map((source) => source.outcome)).toEqual(['unchanged', 'unchanged'])

    await admin.query(`
      UPDATE logging_structures
      SET selections_json = jsonb_set(selections_json, '{alpha}', '40'), updated_at = now()
      WHERE id = $1
    `, [acceptedStructureId])
    await admin.query(
      "UPDATE logging_structures SET review_status = 'accepted', updated_at = now() WHERE id = $1",
      [draftStructureId],
    )

    const sources = await project()
    expect(sources.map((source) => source.outcome)).toEqual(['projected', 'unchanged'])

    const after = await observations(['structure.alpha'])
    expect(after.map(({ sourceId, numericValue }) => ({ sourceId, numericValue }))).toEqual([
      { sourceId: acceptedStructureId, numericValue: 40 },
      { sourceId: draftStructureId, numericValue: 50 },
    ])
    expect(after[0]?.id).toBe(before[0]?.id)

    const status = await api<Array<{ sourceEntityType: string; lastStatus: string; observationCount: number }>>(
      'GET', `/v1/projects/${projectId}/projection`,
    )
    expect(status.payload).toMatchObject([
      { sourceEntityType: 'field.core_row', lastStatus: 'ok', observationCount: 1 },
      { sourceEntityType: 'field.logging_structure', lastStatus: 'ok', observationCount: 5 },
    ])
  })

  it('removes observations when Field withdraws or deletes the source', async () => {
    await admin.query(
      "UPDATE logging_structures SET review_status = 'flagged', updated_at = now() WHERE id = $1",
      [acceptedStructureId],
    )
    await admin.query('DELETE FROM logging_structures WHERE id = $1', [draftStructureId])
    await project()

    await expect(observations(
      ['structure.alpha', 'structure.beta', 'structure.apparent_angle', 'joint.roughness'],
      false,
    )).resolves.toEqual([])

    await admin.query(
      "UPDATE logging_structures SET review_status = 'accepted', updated_at = now() WHERE id = $1",
      [acceptedStructureId],
    )
    await project()
    await expect(observations(['structure.alpha'])).resolves.toHaveLength(1)
  })

  it('applies project bindings over the global defaults', async () => {
    await admin.query(`
      UPDATE logging_structures
      SET selections_json = selections_json || '{"dip_angle": 62}', updated_at = now()
      WHERE id = $1
    `, [acceptedStructureId])

    const derivedTarget = await api('PUT', '/v1/projection-bindings', {
      bindings: [{
        projectId,
        sourceEntityType: 'field.logging_structure',
        sourceField: 'selections.dip_angle',
        variableKey: 'structure.true_dip',
        extraction: { kind: 'selection', key: 'dip_angle' },
      }],
    })
    expect(derivedTarget.status).toBe(409)

    const saved = await api('PUT', '/v1/projection-bindings', {
      bindings: [
        {
          projectId,
          sourceEntityType: 'field.logging_structure',
          sourceField: 'selections.dip_angle',
          variableKey: 'structure.apparent_angle',
          extraction: { kind: 'selection', key: 'dip_angle' },
        },
        {
          // Overrides the global default for this project only.
          projectId,
          sourceEntityType: 'field.logging_structure',
          sourceField: 'selections.beta',
          variableKey: 'structure.beta',
          extraction: { kind: 'selection', key: 'beta' },
          isActive: false,
        },
        {
          projectId,
          sourceEntityType: 'field.logging_structure',
          sourceField: 'angle_deg',
          variableKey: 'structure.apparent_angle',
          extraction: { kind: 'column', column: 'angleDeg' },
          isActive: false,
        },
      ],
    })
    expect(saved.status).toBe(200)

    const bindings = await api<Array<{ projectId: string | null; sourceField: string }>>(
      'GET', `/v1/projection-bindings?projectId=${projectId}`,
    )
    expect(bindings.payload.filter((binding) => binding.projectId === projectId)).toHaveLength(3)
    expect(bindings.payload.filter((binding) => binding.projectId === null).length).toBeGreaterThanOrEqual(5)

    expect((await project())[0]).toMatchObject({ outcome: 'projected' })
    await expect(observations(['structure.beta'])).resolves.toEqual([])
    await expect(observations(['structure.apparent_angle'])).resolves.toMatchObject([
      { sourceId: acceptedStructureId, numericValue: 62 },
    ])
  })

  it('serves shared projects, drillholes, collars, and surveys', async () => {
    const projects = await api<Array<{ id: string; name: string; drillholeCount: number }>>('GET', '/v1/projects')
    expect(projects.payload).toEqual([
      { id: emptyProjectId, name: 'Empty project', description: null, isActive: true, drillholeCount: 0, organizationId: null, organizationName: null, canWrite: true },
      { id: projectId, name: 'Gorge', description: null, isActive: true, drillholeCount: 2, organizationId: null, organizationName: null, canWrite: true },
    ])

    const collar = await api<{ crs: { name: string } }>(
      'PUT', `/v1/projects/${projectId}/drillholes/${holeId}/collar`,
      {
        easting: 512345.6,
        northing: 5300120.1,
        elevation: 1420.5,
        crs: { authority: 'epsg', code: '32648', name: 'WGS 84 / UTM zone 48N' },
        source: 'DGPS survey',
      },
    )
    expect(collar.status).toBe(200)
    expect(collar.payload.crs).toEqual({ authority: 'EPSG', code: '32648', name: 'WGS 84 / UTM zone 48N' })

    const moved = await api<{ elevation: number; crs: { name: string } }>(
      'PUT', `/v1/projects/${projectId}/drillholes/${holeId}/collar`,
      { easting: 512345.6, northing: 5300120.1, elevation: 1421, crs: { authority: 'EPSG', code: '32648' }, source: 'resurvey' },
    )
    expect(moved.payload).toMatchObject({ elevation: 1421, crs: { name: 'WGS 84 / UTM zone 48N' } })

    const surveyUrl = `/v1/projects/${projectId}/drillholes/${holeId}/surveys`
    const first = await api<unknown[]>('PUT', surveyUrl, {
      stations: [
        { measuredDepth: 0, azimuth: 270, dip: -60, source: 'gyro' },
        { measuredDepth: 30, azimuth: 271.5, dip: -59.2, source: 'gyro' },
        { measuredDepth: 60, azimuth: 272.1, dip: -58.4, source: 'gyro' },
      ],
    })
    expect(first.payload).toHaveLength(3)
    const replaced = await api<Array<{ measuredDepth: number; dip: number }>>('PUT', surveyUrl, {
      stations: [
        { measuredDepth: 30, azimuth: 271, dip: -59, source: 'gyro rerun' },
        { measuredDepth: 0, azimuth: 270, dip: -60, source: 'gyro rerun' },
      ],
    })
    expect(replaced.payload.map(({ measuredDepth, dip }) => ({ measuredDepth, dip }))).toEqual([
      { measuredDepth: 0, dip: -60 },
      { measuredDepth: 30, dip: -59 },
    ])
    const listed = await api<unknown[]>('GET', surveyUrl)
    expect(listed.status).toBe(200)
    expect(listed.payload).toHaveLength(2)

    const holes = await api<Array<{ name: string; collar: unknown; surveyStationCount: number }>>(
      'GET', `/v1/projects/${projectId}/drillholes`,
    )
    expect(holes.payload).toMatchObject([
      { name: 'UDD-103', collar: { elevation: 1421, source: 'resurvey' }, surveyStationCount: 2 },
      { name: 'UDD-104', collar: null, surveyStationCount: 0 },
    ])

    const foreignHole = await api('PUT', `/v1/projects/${emptyProjectId}/drillholes/${holeId}/surveys`, { stations: [] })
    expect(foreignHole.status).toBe(404)
    const unknownProject = await api('GET', '/v1/projects/20000000-0000-4000-8000-00000000ffff/drillholes')
    expect(unknownProject.status).toBe(404)
  })

  it('projects every project and reports an empty one without failing', async () => {
    const results = await runAllProjections(runtime)
    expect(results.map((result) => result.projectId)).toEqual([projectId, emptyProjectId])
    expect(results[1]?.sources.map((source) => source.outcome)).toEqual(['projected', 'projected'])
    expect(results[1]?.sources.every((source) => source.observationCount === 0)).toBe(true)
  })

  it('cannot write to Field tables as the runtime role', async () => {
    await expect(runtime.query("UPDATE projects SET name = 'tampered'")).rejects.toMatchObject({ code: '42501' })
    await expect(runtime.query('DELETE FROM logging_structures')).rejects.toMatchObject({ code: '42501' })
  })

  it('reads the Field schema variant that names projects by title', async () => {
    await admin.query('ALTER TABLE projects RENAME COLUMN name TO title')
    await admin.query('ALTER TABLE drill_holes RENAME COLUMN hole_name TO name')
    try {
      const projects = await api<Array<{ name: string }>>('GET', '/v1/projects')
      expect(projects.payload.map((item) => item.name)).toEqual(['Empty project', 'Gorge'])
      const holes = await api<Array<{ name: string }>>('GET', `/v1/projects/${projectId}/drillholes`)
      expect(holes.payload.map((hole) => hole.name)).toEqual(['UDD-103', 'UDD-104'])
    } finally {
      await admin.query('ALTER TABLE projects RENAME COLUMN title TO name')
      await admin.query('ALTER TABLE drill_holes RENAME COLUMN name TO hole_name')
    }
  })
})
