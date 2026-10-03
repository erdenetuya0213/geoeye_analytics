import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDataPoolServer } from '../src/http-server.js'
import {
  applyDevelopmentPrerequisites,
  runMigrations,
  seedCoreVariables,
} from '../src/migrations.js'
import { PostgresDataPoolStore } from '../src/postgres-store.js'
import { createIsolatedDatabase, type IsolatedDatabase } from './postgres-harness.js'

const connectionString = process.env.TEST_DATABASE_URL
const describeWithPostgres = connectionString === undefined ? describe.skip : describe

const projectId = '10000000-0000-4000-8000-000000000001'
const holeId = '10000000-0000-4000-8000-000000000002'
const datasetId = '10000000-0000-4000-8000-000000000003'
const observationId = '10000000-0000-4000-8000-000000000004'

describeWithPostgres('PostgreSQL Data Pool workflow', () => {
  let database: IsolatedDatabase
  let pool: Pool
  let server: Server
  let endpoint = ''

  beforeAll(async () => {
    database = await createIsolatedDatabase(connectionString as string)
    pool = database.admin
    server = createDataPoolServer({ store: new PostgresDataPoolStore(pool) })
    await applyDevelopmentPrerequisites(pool)
    await expect(runMigrations(pool)).resolves.toEqual([
      '0001_datapool_foundation',
      '0002_supabase_security',
      '0003_analysis_result_packages',
      '0004_field_projection',
    ])
    await expect(runMigrations(pool)).resolves.toEqual([])
    await seedCoreVariables(pool)
    await pool.query(
      "INSERT INTO projects (id, name) VALUES ($1, 'Integration project')",
      [projectId],
    )
    await pool.query(
      "INSERT INTO drill_holes (id, project_id, hole_name) VALUES ($1, $2, 'DH-001')",
      [holeId, projectId],
    )
    await pool.query(`
      INSERT INTO datasets (
        id, project_id, name, producer_type, producer_name, spatial_support
      ) VALUES ($1, $2, 'Field structures', 'field', 'GeoEye Field', 'orientation')
    `, [datasetId, projectId])
    await pool.query(`
      INSERT INTO observation_values (
        id, project_id, dataset_id, source_type, source_id, hole_id,
        depth_from, depth_to, variable_id, numeric_value, unit, quality
      )
      SELECT $1, $2, $3, 'field.logging_structure', 'structure-1', $4,
             10, 10.1, id, 38, 'deg', 'accepted'
      FROM variable_definitions
      WHERE key = 'structure.alpha'
    `, [observationId, projectId, datasetId, holeId])

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    endpoint = `http://127.0.0.1:${address.port}`
  }, 30_000)

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error))
    })
    await database.drop()
  })

  it('queries accepted source data and publishes an accepted result with lineage', async () => {
    const observationsResponse = await fetch(`${endpoint}/v1/observations/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, variableKeys: ['structure.alpha'] }),
    })
    expect(observationsResponse.status).toBe(200)
    await expect(observationsResponse.json()).resolves.toMatchObject([
      { id: observationId, numericValue: 38, quality: 'accepted' },
    ])

    const runResponse = await fetch(`${endpoint}/v1/analysis-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        analysisType: 'structure.alpha_beta_conversion',
        algorithmVersion: 'integration-test',
        datasetSnapshot: { datasetId },
        parameters: {},
      }),
    })
    expect(runResponse.status).toBe(201)
    const run = await runResponse.json() as { id: string }

    const valuesResponse = await fetch(`${endpoint}/v1/analysis-runs/${run.id}/derived-values`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: [{
          variableKey: 'structure.true_dip',
          sourceEntityType: 'field.logging_structure',
          sourceEntityId: 'structure-1',
          holeId,
          depthFrom: 10,
          depthTo: 10.1,
          numericValue: 41.5,
          confidence: 0.95,
          status: 'saved',
          inputObservationIds: [observationId],
        }],
      }),
    })
    expect(valuesResponse.status).toBe(201)

    const resultPackageInput = {
      tenantKey: 'integration-tenant',
      projectId,
      datasetId,
      analysisRunId: run.id,
      feature: 'structure',
      mode: 'overwrite',
      fallbackTemplateVersion: 1,
      sourceFileName: 'DH-001-structures.csv',
      inputName: 'all-structures-equal-angle',
      analysisFileKey: `tenants/integration-tenant/projects/${projectId}/boreholes/${holeId}/analytics/structure/v1/analysis.json`,
      derivedFieldKeys: ['structure.true_dip'],
      artifacts: [{
        boreholeId: holeId,
        artifactType: 'analysis_file',
        objectKey: `tenants/integration-tenant/projects/${projectId}/boreholes/${holeId}/analytics/structure/v1/analysis.json`,
        fileName: 'analysis.json',
        mediaType: 'application/json',
      }, {
        boreholeId: holeId,
        artifactType: 'graph_image',
        objectKey: `tenants/integration-tenant/projects/${projectId}/boreholes/${holeId}/analytics/structure/v1/DH-001-structures__all-structures-equal-angle__stereonet__v1.png`,
        fileName: 'DH-001-structures__all-structures-equal-angle__stereonet__v1.png',
        mediaType: 'image/png',
      }],
    }
    const packageResponse = await fetch(`${endpoint}/v1/analysis-result-packages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resultPackageInput),
    })
    expect(packageResponse.status).toBe(201)
    const firstPackage = await packageResponse.json() as { id: string; templateVersion: number }
    expect(firstPackage.templateVersion).toBe(1)

    const overwrittenResponse = await fetch(`${endpoint}/v1/analysis-result-packages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...resultPackageInput, inputName: 'selected-structures-equal-angle' }),
    })
    expect(overwrittenResponse.status).toBe(201)
    await expect(overwrittenResponse.json()).resolves.toMatchObject({
      id: firstPackage.id,
      templateVersion: 1,
      inputName: 'selected-structures-equal-angle',
    })

    const versionTwoKey = `tenants/integration-tenant/projects/${projectId}/boreholes/${holeId}/analytics/structure/v2/analysis.json`
    const saveAsResponse = await fetch(`${endpoint}/v1/analysis-result-packages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...resultPackageInput,
        mode: 'new-version',
        analysisFileKey: versionTwoKey,
        artifacts: [{
          ...resultPackageInput.artifacts[0],
          objectKey: versionTwoKey,
        }],
      }),
    })
    expect(saveAsResponse.status).toBe(201)
    await expect(saveAsResponse.json()).resolves.toMatchObject({ templateVersion: 2 })

    const acceptResponse = await fetch(`${endpoint}/v1/analysis-runs/${run.id}/accept`, {
      method: 'POST',
    })
    expect(acceptResponse.status).toBe(200)
    await expect(acceptResponse.json()).resolves.toMatchObject({ status: 'accepted' })

    const persisted = await pool.query<{
      run_status: string
      value_status: string
      input_id: string
      primary_value: number
    }>(`
      SELECT run.status AS run_status, derived.status AS value_status,
             input.source_id AS input_id, observation.numeric_value AS primary_value
      FROM analysis_runs AS run
      JOIN derived_values AS derived ON derived.analysis_run_id = run.id
      JOIN derivation_inputs AS input ON input.derived_value_id = derived.id
      JOIN observation_values AS observation ON observation.id::text = input.source_id
      WHERE run.id = $1
    `, [run.id])
    expect(persisted.rows).toEqual([{
      run_status: 'accepted',
      value_status: 'accepted',
      input_id: observationId,
      primary_value: 38,
    }])

    const packages = await pool.query<{
      input_name: string
      artifact_count: string
      template_version: number
      tenant_key: string
    }>(`
      SELECT package.tenant_key, package.template_version, package.input_name,
             count(artifact.id)::text AS artifact_count
      FROM analysis_result_packages AS package
      JOIN analysis_result_artifacts AS artifact ON artifact.result_package_id = package.id
      WHERE package.analysis_run_id = $1
      GROUP BY package.id
      ORDER BY package.template_version
    `, [run.id])
    expect(packages.rows).toEqual([{
      tenant_key: 'integration-tenant',
      template_version: 1,
      input_name: 'selected-structures-equal-angle',
      artifact_count: '2',
    }, {
      tenant_key: 'integration-tenant',
      template_version: 2,
      input_name: 'all-structures-equal-angle',
      artifact_count: '1',
    }])

    const reusableResponse = await fetch(
      `${endpoint}/v1/analysis-result-packages?tenantKey=integration-tenant&projectId=${projectId}&boreholeId=${holeId}`,
    )
    expect(reusableResponse.status).toBe(200)
    await expect(reusableResponse.json()).resolves.toMatchObject([
      { templateVersion: 2, artifacts: [{ boreholeId: holeId, artifactType: 'analysis_file' }] },
      { templateVersion: 1, artifacts: [{ boreholeId: holeId }, { boreholeId: holeId }] },
    ])
  })
})
