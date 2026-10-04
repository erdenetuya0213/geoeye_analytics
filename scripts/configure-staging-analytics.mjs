// Administrator-only provisioning. Never packaged; no Field authentication changes.
import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'
import { loadServerConfig } from '../services/datapool-api/dist/config.js'
import { PostgresDataPoolStore } from '../services/datapool-api/dist/postgres-store.js'
import { issueSessionToken } from '../services/datapool-api/dist/auth.js'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../services/datapool-api/package.json', import.meta.url))
const { Pool } = require('pg')
const args = process.argv.slice(2)
function option(name) {
  const index = args.indexOf(`--${name}`)
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`--${name} is required`)
  return args[index + 1]
}
async function run() {
  const email = option('email').trim().toLowerCase()
  const expiration = Date.parse(option('expires'))
  const now = new Date()
  const ttl = Math.floor(expiration / 1000) - Math.floor(now.getTime() / 1000)
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 30 * 86400) throw new Error('Choose a future API expiry within 30 days and no later than the activation expiry.')
  const environment = parseEnv(fs.readFileSync('.env.staging', 'utf8'))
  const config = loadServerConfig(environment)
  if (!config.sessionSecret) throw new Error('Staging user sessions are not configured.')
  if (!['127.0.0.1', 'localhost'].includes(config.host)) throw new Error('This staging setup tool requires a loopback API host.')
  const endpoint = `http://${config.host}:${config.port}`
  const pool = new Pool(config.database)
  const store = new PostgresDataPoolStore(pool)
  let connection
  try {
    // Read identity only, never passwords/hashes; do not create or modify accounts.
    const profiles = await pool.query(`SELECT id,
      COALESCE((to_jsonb(profiles)->>'must_change_password')::boolean, false) AS must_change_password
      FROM profiles WHERE lower(email) = $1`, [email])
    if (profiles.rows.length !== 1) throw new Error('An unambiguous existing Field account is required.')
    const account = profiles.rows[0]
    if (account.must_change_password) throw new Error('This account requires a password update in Field before provisioning.')
    const access = await store.loadUserAccess(account.id)
    if (access === null) throw new Error('This Field account is inactive or unavailable.')
    const session = issueSessionToken(account.id, config.sessionSecret, ttl, now)
    connection = { endpoint, email, accountId: account.id, token: session.token, expiresAt: session.expiresAt.toISOString() }
  } finally { await pool.end() }
  const headers = { authorization: `Bearer ${connection.token}` }
  const identity = await fetch(`${endpoint}/v1/auth/me`, { headers, redirect: 'error', signal: AbortSignal.timeout(10_000) })
  if (!identity.ok || (await identity.json()).user?.id !== connection.accountId) throw new Error('The API did not verify the configured account.')
  const projects = await fetch(`${endpoint}/v1/projects`, { headers, redirect: 'error', signal: AbortSignal.timeout(10_000) })
  if (!projects.ok) throw new Error('The API could not load permitted projects.')
  const projectData = await projects.json()
  console.log(JSON.stringify({ endpoint, email, expiresAt: connection.expiresAt, projectsResponseVerified: true, projectCount: Array.isArray(projectData) ? projectData.length : projectData.items?.length ?? projectData.projects?.length ?? null }))
  if (args.includes('--check')) return
  const appPath = path.resolve(option('app'))
  if (!fs.existsSync(appPath) || path.extname(appPath).toLowerCase() !== '.exe') throw new Error('Provide the built Analytics Windows executable.')
  const child = spawn(appPath, [], { cwd: path.dirname(appPath), detached: true, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, GEOEYE_DATABASE_PROVISION: JSON.stringify(connection) } })
  child.on('error', () => { console.error('The Analytics application could not be started.'); process.exitCode = 1 })
  child.unref()
  console.log('Opened Analytics for one-time Windows-protected provisioning. No credential was printed or stored in a source file.')
}
run().catch((error) => { console.error(error.message); process.exitCode = 1 })
