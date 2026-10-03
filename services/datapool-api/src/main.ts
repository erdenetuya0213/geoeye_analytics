import { Pool } from 'pg'
import { loadServerConfig } from './config.js'
import { createDataPoolServer } from './http-server.js'
import { PostgresDataPoolStore } from './postgres-store.js'
import { runAllProjections } from './projection.js'

const config = loadServerConfig()
const pool = new Pool(config.database)
pool.on('error', (error) => console.error('Unexpected idle PostgreSQL client error', error))

const readinessQuery = `
  SELECT 1
  FROM variable_definitions, analysis_result_packages, analysis_result_artifacts,
       projection_checkpoints
  LIMIT 0
`

function log(level: 'info' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields })
  if (level === 'error') process.stderr.write(`${line}\n`)
  else process.stdout.write(`${line}\n`)
}

// Fail the deployment before binding a port if credentials, routing, TLS, or schema are wrong.
await pool.query(readinessQuery)

const store = new PostgresDataPoolStore(pool, {
  projectionIncludeUnaccepted: config.projection.includeUnaccepted,
})
const server = createDataPoolServer({
  store,
  corsOrigins: config.corsOrigins,
  healthCheck: async () => { await pool.query(readinessQuery) },
  accessLog: (entry) => {
    // Probe traffic would drown out real requests.
    if (entry.path === '/live' || entry.path === '/health') return
    log('info', 'request', { ...entry })
  },
  sessionTtlSeconds: config.sessionTtlSeconds,
  ...(config.bearerToken === undefined ? {} : { bearerToken: config.bearerToken }),
  ...(config.sessionSecret === undefined ? {} : { sessionSecret: config.sessionSecret }),
})

server.headersTimeout = 15_000
server.requestTimeout = 30_000
server.keepAliveTimeout = 5_000

server.listen(config.port, config.host, () => {
  log('info', 'listening', {
    host: config.host,
    port: config.port,
    environment: config.nodeEnvironment,
    authentication: config.sessionSecret !== undefined
      ? 'user sign-in'
      : config.bearerToken !== undefined ? 'service token only' : 'disabled',
    projectionIntervalSeconds: config.projection.intervalSeconds,
  })
})

let shuttingDown = false
let projectionTimer: NodeJS.Timeout | undefined

// Keeps the analytical read model current with Field. Advisory locks inside the
// projection make it safe to run this on every API instance.
async function projectionTick(): Promise<void> {
  try {
    const results = await runAllProjections(pool, { includeUnaccepted: config.projection.includeUnaccepted })
    for (const result of results) {
      for (const source of result.sources) {
        if (source.outcome === 'projected') {
          log('info', 'projection', { projectId: result.projectId, ...source })
        } else if (source.outcome === 'failed') {
          log('error', 'projection_failed', { projectId: result.projectId, ...source })
        }
      }
    }
  } catch (error) {
    log('error', 'projection_tick_failed', { message: error instanceof Error ? error.message : String(error) })
  }
  if (!shuttingDown) {
    projectionTimer = setTimeout(() => void projectionTick(), config.projection.intervalSeconds * 1_000)
    projectionTimer.unref()
  }
}

if (config.projection.intervalSeconds > 0) void projectionTick()

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  if (projectionTimer !== undefined) clearTimeout(projectionTimer)
  log('info', 'shutdown', { signal })
  const forceClose = setTimeout(() => server.closeAllConnections(), 10_000)
  forceClose.unref()
  server.close(async (error) => {
    clearTimeout(forceClose)
    await store.close()
    if (error !== undefined) {
      console.error(error)
      process.exitCode = 1
    }
  })
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
