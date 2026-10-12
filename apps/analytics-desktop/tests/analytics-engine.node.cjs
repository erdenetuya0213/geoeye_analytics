const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createAnalyticsEngine, resolveLaunch } = require('../electron/analytics-engine.cjs')

const sourceRoot = path.resolve(__dirname, '..', '..', '..', 'analytics-engine', 'src')
const python = process.env.GEOEYE_TEST_PYTHON || process.env.GEOEYE_PYTHON

test('resolveLaunch prefers env, then bundled runtime, then repo source', () => {
  assert.equal(resolveLaunch({ env: { GEOEYE_PYTHON: '/x/python' }, platform: 'linux' }).source, 'env')
  const dev = resolveLaunch({ env: {}, appRoot: path.resolve(__dirname, '..'), platform: 'linux' })
  assert.equal(dev.source, 'source')
  assert.equal(dev.env.PYTHONPATH, sourceRoot)
  assert.equal(resolveLaunch({ env: {}, platform: 'win32' }).command, 'python')
})

test('rejects methods outside the allow-list without spawning', async () => {
  const engine = createAnalyticsEngine({ launch: () => { throw new Error('must not spawn') } })
  await assert.rejects(engine.call('os.system'), /not allowed/)
})

test('reports a launch failure through status instead of throwing', async () => {
  const engine = createAnalyticsEngine({ launch: () => ({ command: '/definitely/missing/python', args: [], source: 'env' }) })
  const status = await engine.status()
  assert.equal(status.running, false)
  assert.match(status.error, /missing/)
})

test('round-trips calls through a live engine', { skip: !python && 'set GEOEYE_TEST_PYTHON to a python with the engine installed' }, async () => {
  const engine = createAnalyticsEngine({ launch: () => ({ command: python, args: ['-m', 'geoeye_analytics', 'serve'], source: 'env', env: { PYTHONPATH: sourceRoot } }) })
  try {
    const status = await engine.status()
    assert.equal(status.running, true)
    const summary = await engine.call('distribution.summary', { values: [1, 2, 3, 4] })
    assert.equal(summary.mean, 2.5)
    const providers = await engine.call('engine.providers')
    assert.ok(providers.some((p) => p.provider_id === 'geoeye-native'))
    await assert.rejects(engine.call('distribution.summary', { values: [] }), (e) => typeof e.message === 'string')
  } finally { engine.stop() }
})

test('declustering and top-cut round-trip', { skip: !python && 'set GEOEYE_TEST_PYTHON' }, async () => {
  const engine = createAnalyticsEngine({ launch: () => ({ command: python, args: ['-m', 'geoeye_analytics', 'serve'], source: 'env', env: { PYTHONPATH: sourceRoot } }) })
  try {
    const values = Array.from({ length: 300 }, (_, i) => (i < 150 ? 1 : 10))
    const coordinates = values.map((_, i) => (i < 150 ? [Math.random() * 100, Math.random() * 100, 0] : [40 + Math.random() * 5, 40 + Math.random() * 5, 0]))
    const d = await engine.call('decluster.optimise', { values, coordinates, minimum: 2, maximum: 40, count: 8 })
    assert.ok(d.declusteredMean < d.naiveMean)
    const t = await engine.call('topcut.analyse', { values, weights: d.weights, customCutoffs: [5] })
    assert.equal(t.scenarios.at(-1).label, 'custom')
    assert.ok(t.logProbability.length > 0)
  } finally { engine.stop() }
})

test('variography round-trip', { skip: !python && 'set GEOEYE_TEST_PYTHON' }, async () => {
  const engine = createAnalyticsEngine({ launch: () => ({ command: python, args: ['-m', 'geoeye_analytics', 'serve'], source: 'env', env: { PYTHONPATH: sourceRoot } }) })
  try {
    const n = 400
    const coordinates = Array.from({ length: n }, () => [Math.random() * 200, Math.random() * 200, -Math.random() * 50])
    const values = coordinates.map(([x, y]) => Math.sin(x / 30) + Math.cos(y / 40) + Math.random() * 0.3)
    const ns = await engine.call('variography.normalScores', { values })
    assert.equal(ns.scores.length, n)
    const e = await engine.call('variography.experimental', { coordinates, values: ns.scores, lag: 10, lagCount: 10, direction: { azimuth: 0, dip: 0, azimuthTolerance: 30, dipTolerance: 30 } })
    assert.ok(e.lags.length > 5 && e.lags[0].pairs > 0)
    const fan = await engine.call('variography.fan', { coordinates, values: ns.scores, plane: 'horizontal', lag: 10, lagCount: 8, rays: 6 })
    assert.equal(fan.rays.length, 6)
    const fit = await engine.call('variography.autoFit', { experiments: [e, e, e], structureTypes: ['spherical'], totalSill: 1 })
    assert.equal(fit.structures.length, 1)
    assert.ok(Math.abs(fit.totalSill - 1) < 0.05)
  } finally { engine.stop() }
})
