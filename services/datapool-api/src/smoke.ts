import { parseArgs } from 'node:util'

// Black-box check of a running Data Pool API. Read-only unless --project-now
// is passed, which also triggers a projection run for the first project.
//   SMOKE_ENDPOINT=https://data.example.com DATAPOOL_BEARER_TOKEN=... node dist/smoke.js

const { values } = parseArgs({
  args: process.argv.slice(2).filter((argument) => argument !== '--'),
  options: {
    endpoint: { type: 'string' },
    'project-now': { type: 'boolean', default: false },
  },
})

function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

const endpoint = (
  configured(values.endpoint)
  ?? configured(process.env.SMOKE_ENDPOINT)
  ?? `http://127.0.0.1:${configured(process.env.PORT) ?? '8080'}`
).replace(/\/$/, '')
const token = process.env.DATAPOOL_BEARER_TOKEN?.trim()
let failures = 0

async function call(method: string, path: string, body?: unknown, authenticated = true): Promise<{ status: number; payload: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (authenticated && token !== undefined && token !== '') headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers,
    signal: AbortSignal.timeout(30_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let payload: unknown = text
  try { payload = JSON.parse(text) } catch { /* keep the raw text */ }
  return { status: response.status, payload }
}

async function check(name: string, run: () => Promise<string>): Promise<void> {
  try {
    process.stdout.write(`PASS ${name}: ${await run()}\n`)
  } catch (error) {
    failures += 1
    process.stdout.write(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

function expectStatus(actual: { status: number; payload: unknown }, expected: number): void {
  if (actual.status !== expected) {
    throw new Error(`expected HTTP ${expected}, received ${actual.status} ${JSON.stringify(actual.payload).slice(0, 300)}`)
  }
}

process.stdout.write(`Smoke test against ${endpoint}\n`)

await check('liveness', async () => {
  expectStatus(await call('GET', '/live', undefined, false), 200)
  return 'process is up'
})

await check('readiness', async () => {
  expectStatus(await call('GET', '/health', undefined, false), 200)
  return 'database and schema reachable'
})

if (token !== undefined && token !== '') {
  await check('authentication enforced', async () => {
    expectStatus(await call('GET', '/v1/variables', undefined, false), 401)
    return 'unauthenticated request rejected'
  })
}

let variableKeys: string[] = []
await check('variable registry', async () => {
  const response = await call('GET', '/v1/variables')
  expectStatus(response, 200)
  const variables = response.payload as Array<{ key: string; origin: string }>
  if (variables.length === 0) throw new Error('the registry is empty; run the migration command to seed it')
  variableKeys = variables.filter((variable) => variable.origin === 'primary').map((variable) => variable.key)
  return `${variables.length} variables`
})

let projects: Array<{ id: string; name: string; drillholeCount: number }> = []
await check('projects', async () => {
  const response = await call('GET', '/v1/projects')
  expectStatus(response, 200)
  projects = response.payload as typeof projects
  return `${projects.length} projects`
})

const project = [...projects].sort((left, right) => right.drillholeCount - left.drillholeCount)[0]
if (project === undefined) {
  process.stdout.write('SKIP project checks: the database has no projects yet\n')
} else {
  await check(`drillholes of "${project.name}"`, async () => {
    const response = await call('GET', `/v1/projects/${project.id}/drillholes`)
    expectStatus(response, 200)
    const holes = response.payload as Array<{ collar: unknown; surveyStationCount: number }>
    const withCollar = holes.filter((hole) => hole.collar !== null).length
    const surveyed = holes.filter((hole) => hole.surveyStationCount > 0).length
    return `${holes.length} holes, ${withCollar} with collar, ${surveyed} surveyed`
  })

  if (values['project-now']) {
    await check('projection run', async () => {
      const response = await call('POST', `/v1/projects/${project.id}/projection`, { force: false })
      expectStatus(response, 200)
      const result = response.payload as { sources: Array<{ sourceEntityType: string; outcome: string; observationCount: number; message: string | null }> }
      const failed = result.sources.filter((source) => source.outcome === 'failed')
      if (failed.length > 0) throw new Error(failed.map((source) => `${source.sourceEntityType}: ${source.message}`).join('; '))
      return result.sources.map((source) => `${source.sourceEntityType} ${source.outcome} (${source.observationCount})`).join(', ')
    })
  }

  await check('projection status', async () => {
    const response = await call('GET', `/v1/projects/${project.id}/projection`)
    expectStatus(response, 200)
    const status = response.payload as Array<{ sourceEntityType: string; lastStatus: string; observationCount: number; lastError: string | null }>
    const failed = status.filter((source) => source.lastStatus === 'failed')
    if (failed.length > 0) throw new Error(failed.map((source) => `${source.sourceEntityType}: ${source.lastError}`).join('; '))
    return status.length === 0
      ? 'never projected (run the projection command or pass --project-now)'
      : status.map((source) => `${source.sourceEntityType}=${source.observationCount}`).join(', ')
  })

  await check('dataset registry', async () => {
    const response = await call('GET', `/v1/datasets?projectId=${project.id}`)
    expectStatus(response, 200)
    return `${(response.payload as unknown[]).length} datasets`
  })

  await check('observation query', async () => {
    const response = await call('POST', '/v1/observations/query', {
      projectId: project.id,
      variableKeys,
      acceptedOnly: false,
      limit: 1_000,
    })
    expectStatus(response, 200)
    return `${(response.payload as unknown[]).length} observations in the first page`
  })
}

process.stdout.write(failures === 0 ? '\nSmoke test passed.\n' : `\nSmoke test failed: ${failures} check(s).\n`)
if (failures > 0) process.exitCode = 1
