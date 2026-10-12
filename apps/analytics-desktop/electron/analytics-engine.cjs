// Python analytics engine sidecar: one long-lived `geoeye_analytics serve` process, JSON lines over stdio.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const { randomUUID } = require('node:crypto')

const ALLOWED_METHODS = new Set([
  'engine.info', 'engine.providers',
  'distribution.summary', 'distribution.ecdf', 'distribution.probabilityPlot', 'distribution.bootstrap', 'distribution.diagnostics',
  'multivariate.run',
  'decluster.optimise', 'topcut.analyse',
  'variography.normalScores', 'variography.experimental', 'variography.fan', 'variography.autoFit', 'variography.modelCurve',
])

// Resolution order: explicit env → bundled runtime → repo source checkout (dev) → python on PATH.
function resolveLaunch({ env = process.env, resourcesPath, appRoot, platform = process.platform } = {}) {
  const exe = platform === 'win32' ? 'python.exe' : 'python3'
  if (env.GEOEYE_PYTHON) return { command: env.GEOEYE_PYTHON, args: ['-m', 'geoeye_analytics', 'serve'], source: 'env' }
  const bundled = resourcesPath && path.join(resourcesPath, 'engine', platform === 'win32' ? 'Scripts' : 'bin', exe)
  if (bundled && fs.existsSync(bundled)) return { command: bundled, args: ['-m', 'geoeye_analytics', 'serve'], source: 'bundled' }
  const source = appRoot && path.resolve(appRoot, '..', '..', 'analytics-engine', 'src')
  const python = platform === 'win32' ? 'python' : 'python3'
  if (source && fs.existsSync(path.join(source, 'geoeye_analytics'))) {
    return { command: python, args: ['-m', 'geoeye_analytics', 'serve'], source: 'source', env: { PYTHONPATH: source } }
  }
  return { command: python, args: ['-m', 'geoeye_analytics', 'serve'], source: 'path' }
}

function createAnalyticsEngine({ launch, timeoutMs = 120_000, log = () => {} } = {}) {
  let child = null
  let ready = null
  let info = null
  let lastError = null
  const pending = new Map()

  const fail = (message) => {
    for (const [, entry] of pending) entry.reject(new Error(message))
    pending.clear()
  }

  const start = () => {
    if (ready) return ready
    const spec = launch()
    ready = new Promise((resolve, reject) => {
      try {
        child = spawn(spec.command, spec.args, { env: { ...process.env, PYTHONUNBUFFERED: '1', ...(spec.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      } catch (error) { ready = null; lastError = error.message; reject(error); return }
      let resolved = false
      child.once('error', (error) => { lastError = `${spec.command}: ${error.message}`; ready = null; child = null; if (!resolved) reject(new Error(lastError)); fail(lastError) })
      child.once('exit', (code, signal) => { lastError = `engine exited (${code ?? signal})`; ready = null; child = null; info = null; if (!resolved) reject(new Error(lastError)); fail(lastError) })
      readline.createInterface({ input: child.stderr }).on('line', (line) => log(`[engine] ${line}`))
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        let message
        try { message = JSON.parse(line) } catch { log(`[engine] unparsable: ${line}`); return }
        if (message.ready) { resolved = true; info = { version: message.version, source: spec.source }; lastError = null; resolve(); return }
        const entry = pending.get(message.id)
        if (!entry) return
        pending.delete(message.id)
        clearTimeout(entry.timer)
        if (message.error) entry.reject(Object.assign(new Error(message.error.message), { type: message.error.type, trace: message.error.trace }))
        else entry.resolve(message.result)
      })
    })
    return ready
  }

  const call = async (method, params = {}) => {
    if (!ALLOWED_METHODS.has(method)) throw new Error(`Engine method is not allowed: ${method}`)
    await start()
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Engine call timed out: ${method}`)) }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }

  const status = async () => {
    try { await start() } catch { /* reported through lastError */ }
    return { running: child !== null, version: info?.version ?? null, source: info?.source ?? null, error: lastError }
  }

  const stop = () => { if (child) { child.stdin.end(); child.kill(); child = null; ready = null } }

  return { call, status, stop }
}

module.exports = { ALLOWED_METHODS, createAnalyticsEngine, resolveLaunch }
