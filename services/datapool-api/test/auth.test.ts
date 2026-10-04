import type {
  AnalysisResultPackageRecord,
  AnalysisRun,
  Collar,
  Dataset,
  DrillholeSummary,
  ObservationValue,
  ProjectSummary,
  ProjectionBinding,
  ProjectionRunResult,
  ProjectionStatus,
  SavedAnalysisResultPackage,
  SurveyStation,
  VariableDefinition,
} from '@geoeye/types'
import { argon2id, bcrypt } from 'hash-wasm'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  issueSessionToken,
  LoginThrottle,
  verifyPassword,
  verifySessionToken,
  type LoginAccount,
  type UserAccess,
} from '../src/auth.js'
import { createDataPoolServer } from '../src/http-server.js'
import type { DataPoolStore } from '../src/store.js'

const secret = 'session-secret-for-tests-0123456789abcdef'
const serviceToken = 'service-token-for-tests-0123456789abcdef'
const editorId = '10000000-0000-4000-8000-0000000000a1'
const adminId = '10000000-0000-4000-8000-0000000000a2'
const organizationId = '10000000-0000-4000-8000-0000000000b1'
const ownProject = '10000000-0000-4000-8000-0000000000c1'
const readOnlyProject = '10000000-0000-4000-8000-0000000000c2'
const foreignProject = '10000000-0000-4000-8000-0000000000c3'
const holeId = '10000000-0000-4000-8000-0000000000d1'
const foreignRun = '10000000-0000-4000-8000-0000000000e1'
const password = 'correct horse battery staple'

let passwordHash = ''
let bcryptHash = ''

beforeAll(async () => {
  // Small Argon2 parameters keep the suite fast; the encoded format is the same.
  passwordHash = await argon2id({
    password,
    salt: new Uint8Array(16).fill(7),
    parallelism: 1,
    iterations: 1,
    memorySize: 1024,
    hashLength: 32,
    outputType: 'encoded',
  })
  bcryptHash = await bcrypt({ password, salt: new Uint8Array(16).fill(3), costFactor: 4, outputType: 'encoded' })
})

function project(id: string, name: string, organization: string | null): ProjectSummary {
  return {
    id,
    name,
    description: null,
    isActive: true,
    drillholeCount: 1,
    organizationId: organization,
    organizationName: organization === null ? null : 'Astro Geo',
    canWrite: true,
  }
}

class AuthStore implements DataPoolStore {
  accounts = new Map<string, LoginAccount>()
  access = new Map<string, UserAccess>()
  createdBy: Array<string | null> = []
  collarSaves = 0

  async findLoginAccount(email: string) { return this.accounts.get(email) ?? null }
  async loadUserAccess(userId: string) { return this.access.get(userId) ?? null }
  async getAnalysisRunProjectId(runId: string) { return runId === foreignRun ? foreignProject : null }
  async listVariables(): Promise<VariableDefinition[]> { return [] }
  async listProjects(): Promise<ProjectSummary[]> {
    return [
      project(ownProject, 'Gorge', organizationId),
      project(readOnlyProject, 'Ridge', organizationId),
      project(foreignProject, 'Other tenant', null),
    ]
  }
  async listDrillholes(): Promise<DrillholeSummary[]> { return [] }
  async listFieldLogging(projectId: string) { return { projectId, templates: [], submissions: [] } }
  async listFieldLoggingStructures() { return [] }
  async saveCollar(): Promise<Collar> {
    this.collarSaves += 1
    return {
      easting: 1, northing: 2, elevation: 3, latitude: null, longitude: null,
      crs: { authority: 'EPSG', code: '32648', name: 'EPSG:32648' },
      surveyMethod: null, accuracy: null, source: 'test', updatedAt: '2026-10-03T00:00:00.000Z',
    }
  }
  async listSurveys(): Promise<SurveyStation[]> { return [] }
  async replaceSurveys(): Promise<SurveyStation[]> { return [] }
  async listProjectionBindings(): Promise<ProjectionBinding[]> { return [] }
  async saveProjectionBindings(): Promise<ProjectionBinding[]> { return [] }
  async listProjectionStatus(): Promise<ProjectionStatus[]> { return [] }
  async runProjection(id: string): Promise<ProjectionRunResult> { return { projectId: id, sources: [] } }
  async listDatasets(): Promise<Dataset[]> { return [] }
  async queryObservations(): Promise<ObservationValue[]> { return [] }
  async createAnalysisRun(input: { projectId: string }, createdBy: string | null): Promise<AnalysisRun> {
    this.createdBy.push(createdBy)
    return {
      id: '10000000-0000-4000-8000-0000000000e9', projectId: input.projectId, analysisType: 't',
      algorithmVersion: '1', datasetSnapshot: {}, parameters: {}, createdBy,
      createdAt: '2026-10-03T00:00:00.000Z', status: 'draft',
    }
  }
  async saveDerivedValues(): Promise<string[]> { return [] }
  async listAnalysisResultPackages(): Promise<AnalysisResultPackageRecord[]> { return [] }
  async saveAnalysisResultPackage(): Promise<SavedAnalysisResultPackage> { throw new Error('unused') }
  async acceptAnalysisRun(): Promise<AnalysisRun> { throw new Error('unused') }
  async close(): Promise<void> {}
}

function seededStore(): AuthStore {
  const store = new AuthStore()
  store.accounts.set('editor@astrogeo.test', { id: editorId, passwordHash, isActive: true, mustChangePassword: false })
  store.accounts.set('admin@astrogeo.test', { id: adminId, passwordHash, isActive: true, mustChangePassword: false })
  store.accounts.set('legacy@astrogeo.test', { id: editorId, passwordHash: bcryptHash, isActive: true, mustChangePassword: false })
  store.accounts.set('left@astrogeo.test', { id: editorId, passwordHash, isActive: false, mustChangePassword: false })
  store.accounts.set('new@astrogeo.test', { id: editorId, passwordHash, isActive: true, mustChangePassword: true })
  store.access.set(editorId, {
    user: { id: editorId, email: 'editor@astrogeo.test', displayName: 'Editor', role: 'geologist', isPlatformAdmin: false },
    organizations: [{ id: organizationId, name: 'Astro Geo', slug: 'astro-geo', role: 'member' }],
    allProjects: false,
    projects: new Map([[ownProject, 'write'], [readOnlyProject, 'read']]),
  })
  store.access.set(adminId, {
    user: { id: adminId, email: 'admin@astrogeo.test', displayName: 'Admin', role: 'admin', isPlatformAdmin: true },
    organizations: [],
    allProjects: true,
    projects: new Map(),
  })
  return store
}

const servers: ReturnType<typeof createDataPoolServer>[] = []

async function start(store: DataPoolStore): Promise<string> {
  const server = createDataPoolServer({
    store,
    sessionSecret: secret,
    bearerToken: serviceToken,
    logger: { error: vi.fn() },
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function login(endpoint: string, email: string, attempt = password) {
  return fetch(`${endpoint}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: attempt }),
  })
}

async function tokenFor(endpoint: string, email: string): Promise<string> {
  const response = await login(endpoint, email)
  expect(response.status).toBe(200)
  return (await response.json() as { accessToken: string }).accessToken
}

function call(endpoint: string, token: string, path: string, init: RequestInit = {}) {
  return fetch(`${endpoint}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
}

describe('session tokens and passwords', () => {
  it('accepts its own token and rejects tampered, expired, or foreign ones', () => {
    const now = new Date('2026-10-03T00:00:00Z')
    const { token, expiresAt } = issueSessionToken(editorId, secret, 3600, now)
    expect(expiresAt.toISOString()).toBe('2026-10-03T01:00:00.000Z')
    expect(verifySessionToken(token, secret, now)).toBe(editorId)

    expect(verifySessionToken(token, secret, new Date('2026-10-03T01:00:00Z'))).toBeNull()
    expect(verifySessionToken(token, `${secret}x`, now)).toBeNull()
    const [header, payload, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ iss: 'geoeye-datapool', sub: adminId, iat: 0, exp: 9_999_999_999 })).toString('base64url')
    expect(verifySessionToken(`${header}.${forged}.${signature}`, secret, now)).toBeNull()
    expect(verifySessionToken(`${header}.${payload}`, secret, now)).toBeNull()
    expect(verifySessionToken('not-a-token', secret, now)).toBeNull()
  })

  it('verifies the Argon2id and bcrypt hashes GeoEye Field stores', async () => {
    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true)
    await expect(verifyPassword('wrong', passwordHash)).resolves.toBe(false)
    await expect(verifyPassword(password, bcryptHash)).resolves.toBe(true)
    await expect(verifyPassword('wrong', bcryptHash)).resolves.toBe(false)
    await expect(verifyPassword(password, 'plaintext-or-unknown-scheme')).resolves.toBe(false)
    await expect(verifyPassword(password, '$argon2id$corrupt')).resolves.toBe(false)
  })

  it('blocks a key after repeated failures until the window passes', () => {
    const throttle = new LoginThrottle(3, 1000)
    for (let i = 0; i < 3; i += 1) throttle.recordFailure('email:a', 0)
    expect(throttle.blocked('email:a', 10)).toBe(true)
    expect(throttle.blocked('email:b', 10)).toBe(false)
    expect(throttle.blocked('email:a', 1001)).toBe(false)
  })
})

describe('sign-in and tenant isolation', () => {
  it('signs a user in and returns their organizations', async () => {
    const endpoint = await start(seededStore())
    const response = await login(endpoint, 'Editor@AstroGeo.test ')
    expect(response.status).toBe(200)
    const body = await response.json() as { accessToken: string; user: { id: string }; organizations: unknown[] }
    expect(body).toMatchObject({
      tokenType: 'bearer',
      user: { id: editorId, displayName: 'Editor', isPlatformAdmin: false },
      organizations: [{ id: organizationId, name: 'Astro Geo' }],
    })

    const me = await call(endpoint, body.accessToken, '/v1/auth/me')
    expect(me.status).toBe(200)
    await expect(me.json()).resolves.toMatchObject({ user: { email: 'editor@astrogeo.test' } })
  })

  it('gives the same answer for a wrong password, an unknown email, and a deactivated account', async () => {
    const endpoint = await start(seededStore())
    for (const [email, attempt] of [
      ['editor@astrogeo.test', 'wrong'],
      ['nobody@astrogeo.test', password],
      ['left@astrogeo.test', password],
    ] as const) {
      const response = await login(endpoint, email, attempt)
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_credentials' } })
    }
    expect((await login(endpoint, 'legacy@astrogeo.test')).status).toBe(200)
    const pending = await login(endpoint, 'new@astrogeo.test')
    expect(pending.status).toBe(403)
    await expect(pending.json()).resolves.toMatchObject({ error: { code: 'password_change_required' } })
  })

  it('locks sign-in after repeated failures, even with the right password', async () => {
    const endpoint = await start(seededStore())
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await login(endpoint, 'editor@astrogeo.test', 'wrong')).status).toBe(401)
    }
    expect((await login(endpoint, 'editor@astrogeo.test')).status).toBe(429)
  })

  it('shows a user only their projects and hides other tenants as missing', async () => {
    const store = seededStore()
    const endpoint = await start(store)
    const token = await tokenFor(endpoint, 'editor@astrogeo.test')

    const projects = await call(endpoint, token, '/v1/projects')
    await expect(projects.json()).resolves.toMatchObject([
      { id: ownProject, canWrite: true },
      { id: readOnlyProject, canWrite: false },
    ])

    expect((await call(endpoint, token, `/v1/projects/${ownProject}/drillholes`)).status).toBe(200)
    expect((await call(endpoint, token, `/v1/projects/${foreignProject}/drillholes`)).status).toBe(404)
    expect((await call(endpoint, token, `/v1/projects/${foreignProject}/logging/structures`)).status).toBe(404)
    expect((await call(endpoint, token, `/v1/datasets?projectId=${foreignProject}`)).status).toBe(404)
    expect((await call(endpoint, token, '/v1/observations/query', {
      method: 'POST',
      body: JSON.stringify({ projectId: foreignProject, variableKeys: ['structure.alpha'] }),
    })).status).toBe(404)
    expect((await call(endpoint, token, `/v1/analysis-result-packages?tenantKey=t&projectId=${foreignProject}`)).status).toBe(404)
    expect((await call(endpoint, token, `/v1/projects/${foreignProject}/projection`, { method: 'POST' })).status).toBe(404)
    expect((await call(endpoint, token, `/v1/analysis-runs/${foreignRun}/accept`, { method: 'POST' })).status).toBe(404)
  })

  it('enforces read-only project roles on every write', async () => {
    const store = seededStore()
    const endpoint = await start(store)
    const token = await tokenFor(endpoint, 'editor@astrogeo.test')
    const collar = JSON.stringify({ easting: 1, northing: 2, elevation: 3, crs: { authority: 'EPSG', code: '32648' }, source: 'test' })

    expect((await call(endpoint, token, `/v1/projects/${readOnlyProject}/drillholes/${holeId}/surveys`)).status).toBe(200)
    const denied = await call(endpoint, token, `/v1/projects/${readOnlyProject}/drillholes/${holeId}/collar`, { method: 'PUT', body: collar })
    expect(denied.status).toBe(403)
    expect(store.collarSaves).toBe(0)

    const allowed = await call(endpoint, token, `/v1/projects/${ownProject}/drillholes/${holeId}/collar`, { method: 'PUT', body: collar })
    expect(allowed.status).toBe(200)

    const run = await call(endpoint, token, '/v1/analysis-runs', {
      method: 'POST',
      body: JSON.stringify({ projectId: ownProject, analysisType: 't', algorithmVersion: '1', datasetSnapshot: {}, parameters: {} }),
    })
    expect(run.status).toBe(201)
    expect(store.createdBy).toEqual([editorId])
  })

  it('reserves shared settings for platform administrators', async () => {
    const endpoint = await start(seededStore())
    const globalBinding = JSON.stringify({
      bindings: [{
        projectId: null,
        sourceEntityType: 'field.logging_structure',
        sourceField: 'selections.alpha',
        variableKey: 'structure.alpha',
        extraction: { kind: 'selection', key: 'alpha' },
      }],
    })
    const editor = await tokenFor(endpoint, 'editor@astrogeo.test')
    expect((await call(endpoint, editor, '/v1/projection-bindings', { method: 'PUT', body: globalBinding })).status).toBe(403)

    const admin = await tokenFor(endpoint, 'admin@astrogeo.test')
    expect((await call(endpoint, admin, '/v1/projection-bindings', { method: 'PUT', body: globalBinding })).status).toBe(200)
    const projects = await call(endpoint, admin, '/v1/projects')
    await expect(projects.json()).resolves.toHaveLength(3)
  })

  it('ends a session when the account is removed and still accepts the service token', async () => {
    const store = seededStore()
    const endpoint = await start(store)
    expect((await call(endpoint, issueSessionToken(editorId, secret, -1).token, '/v1/projects')).status).toBe(401)
    expect((await call(endpoint, issueSessionToken(editorId, 'another-secret-another-secret-12345', 60).token, '/v1/projects')).status).toBe(401)
    expect((await fetch(`${endpoint}/v1/projects`)).status).toBe(401)

    store.access.delete(editorId)
    expect((await call(endpoint, issueSessionToken(editorId, secret, 60).token, '/v1/projects')).status).toBe(401)

    const service = await call(endpoint, serviceToken, '/v1/projects')
    await expect(service.json()).resolves.toHaveLength(3)
    expect((await call(endpoint, serviceToken, '/v1/auth/me')).status).toBe(404)
  })
})
