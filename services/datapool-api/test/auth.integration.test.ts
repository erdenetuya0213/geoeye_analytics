import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { argon2id } from 'hash-wasm'
import { Pool } from 'pg'
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

const organizationA = '30000000-0000-4000-8000-000000000001'
const organizationB = '30000000-0000-4000-8000-000000000002'
const geologist = '30000000-0000-4000-8000-000000000011'
const organizationAdmin = '30000000-0000-4000-8000-000000000012'
const platformAdmin = '30000000-0000-4000-8000-000000000013'
const viewer = '30000000-0000-4000-8000-000000000014'
const projectA1 = '30000000-0000-4000-8000-000000000021'
const projectA2 = '30000000-0000-4000-8000-000000000022'
const projectB1 = '30000000-0000-4000-8000-000000000023'
const projectNoOrganization = '30000000-0000-4000-8000-000000000024'
const password = 'field-account-password'

// Runs with the grants of the production runtime role, so it also proves the role can
// read the shared account and membership tables it needs and nothing more.
describeWithPostgres('Sign-in against the shared GeoEye account tables', () => {
  let database: IsolatedDatabase
  let runtime: Pool
  let store: PostgresDataPoolStore
  let server: Server
  let endpoint = ''

  async function signIn(email: string, attempt = password): Promise<{ status: number; token: string }> {
    const response = await fetch(`${endpoint}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: attempt }),
    })
    const body = await response.json() as { accessToken?: string }
    return { status: response.status, token: body.accessToken ?? '' }
  }

  async function projectNames(token: string): Promise<string[]> {
    const response = await fetch(`${endpoint}/v1/projects`, { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    return (await response.json() as Array<{ name: string; canWrite: boolean }>)
      .map((project) => `${project.name}${project.canWrite ? '' : ' (read-only)'}`)
  }

  beforeAll(async () => {
    database = await createIsolatedDatabase(connectionString as string)
    const admin = database.admin
    await applyDevelopmentPrerequisites(admin)
    await runMigrations(admin)
    await seedCoreVariables(admin)

    const hash = await argon2id({
      password,
      salt: new Uint8Array(16).fill(9),
      parallelism: 1,
      iterations: 1,
      memorySize: 1024,
      hashLength: 32,
      outputType: 'encoded',
    })
    await admin.query(`
      INSERT INTO organizations (id, name, slug) VALUES ($1, 'Astro Geo', 'astro-geo'), ($2, 'Other Mining', 'other')
    `, [organizationA, organizationB])
    await admin.query(`
      INSERT INTO profiles (id, email, display_name, role, password_hash, is_platform_admin, is_active) VALUES
        ($1, 'Geologist@AstroGeo.test', 'G. Logger', 'geologist', $5, false, true),
        ($2, 'orgadmin@astrogeo.test', 'O. Admin', 'supervisor', $5, false, true),
        ($3, 'platform@astrogeo.test', 'P. Admin', 'admin', $5, true, true),
        ($4, 'viewer@astrogeo.test', 'V. Viewer', 'viewer', $5, false, true)
    `, [geologist, organizationAdmin, platformAdmin, viewer, hash])
    await admin.query(`
      INSERT INTO projects (id, organization_id, name) VALUES
        ($1, $5, 'A1 Gorge'), ($2, $5, 'A2 Ridge'), ($3, $6, 'B1 Other'), ($4, NULL, 'Legacy')
    `, [projectA1, projectA2, projectB1, projectNoOrganization, organizationA, organizationB])
    await admin.query(`
      INSERT INTO organization_members (organization_id, user_id, role) VALUES
        ($1, $2, 'member'), ($1, $3, 'admin')
    `, [organizationA, geologist, organizationAdmin])
    await admin.query(`
      INSERT INTO project_members (project_id, user_id, role) VALUES
        ($1, $3, 'editor'), ($2, $4, 'editor'), ($1, $4, 'viewer')
    `, [projectA1, projectNoOrganization, geologist, viewer])

    runtime = new Pool({ connectionString: await database.provisionRuntimeRole() })
    store = new PostgresDataPoolStore(runtime)
    server = createDataPoolServer({ store, sessionSecret: 'integration-session-secret-0123456789' })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }, 60_000)

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()))
    await runtime.end()
    await database.drop()
  })

  it('limits each user to the projects their membership grants', async () => {
    const member = await signIn('geologist@astrogeo.test')
    expect(member.status).toBe(200)
    await expect(projectNames(member.token)).resolves.toEqual(['A1 Gorge'])

    const organizationWide = await signIn('orgadmin@astrogeo.test')
    await expect(projectNames(organizationWide.token)).resolves.toEqual(['A1 Gorge', 'A2 Ridge'])

    const everything = await signIn('platform@astrogeo.test')
    await expect(projectNames(everything.token)).resolves.toEqual(['A1 Gorge', 'A2 Ridge', 'B1 Other', 'Legacy'])

    const readOnly = await signIn('viewer@astrogeo.test')
    await expect(projectNames(readOnly.token)).resolves.toEqual(['A1 Gorge (read-only)', 'Legacy (read-only)'])

    const other = await fetch(`${endpoint}/v1/projects/${projectB1}/drillholes`, {
      headers: { Authorization: `Bearer ${member.token}` },
    })
    expect(other.status).toBe(404)
  })

  it('reports the tenant of each project and rejects a wrong password', async () => {
    expect((await signIn('geologist@astrogeo.test', 'wrong')).status).toBe(401)

    const access = await store.loadUserAccess(geologist)
    expect(access).toMatchObject({
      user: { email: 'Geologist@AstroGeo.test', displayName: 'G. Logger', isPlatformAdmin: false },
      organizations: [{ id: organizationA, name: 'Astro Geo', slug: 'astro-geo', role: 'member' }],
      allProjects: false,
    })
    const projects = await store.listProjects()
    expect(projects.find((project) => project.id === projectA1)).toMatchObject({
      organizationId: organizationA,
      organizationName: 'Astro Geo',
    })
    expect(projects.find((project) => project.id === projectNoOrganization)).toMatchObject({
      organizationId: null,
      organizationName: null,
    })
  })

  it('stops a deactivated account within the access-cache window', async () => {
    await database.admin.query('UPDATE profiles SET is_active = false WHERE id = $1', [viewer])
    await expect(store.loadUserAccess(viewer)).resolves.toBeNull()
    expect((await signIn('viewer@astrogeo.test')).status).toBe(401)
  })

  it('cannot read password hashes of other tables or write accounts as the runtime role', async () => {
    await expect(runtime.query("UPDATE profiles SET role = 'admin'")).rejects.toMatchObject({ code: '42501' })
    await expect(runtime.query('DELETE FROM project_members')).rejects.toMatchObject({ code: '42501' })
  })
})
