const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { generateKeyPairSync, sign } = require('node:crypto')
const activation = require('../electron/activation.cjs')

// Exercises the real native handlers and SQLite files with a mocked Electron host.
// Windows safeStorage itself must still be checked in the packaged application.
test('native IPC requires activation, restores offline, writes real local data, and locks at expiry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geoeye-activation-test-'))
  const appData = path.join(root, 'appdata')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  let time = Date.parse('2026-10-04T12:00:00Z')
  const email = 'native-test@example.test'
  const payload = Buffer.from(JSON.stringify({ v: 1, product: 'geoeye-analytics', id: 'ipc-test', email, nbf: time / 1000 - 1, exp: time / 1000 + 60 })).toString('base64url')
  const message = `GEA1.${payload}`
  const key = `${message}.${sign(null, Buffer.from(message), privateKey).toString('base64url')}`
  const nativeDir = path.resolve(__dirname, '../electron')
  const source = fs.readFileSync(path.join(nativeDir, 'main.cjs'), 'utf8')

  async function boot() {
    const handlers = new Map()
    const paths = { appData }
    let ready
    const electron = {
      app: {
        getPath: (name) => paths[name], setPath: (name, value) => { paths[name] = value },
        whenReady: () => ({ then: (callback) => { ready = callback } }),
        setAppLogsPath() {}, on() {}, quit() {},
      },
      BrowserWindow: class {
        webContents = { setWindowOpenHandler() {}, on() {} }
        loadFile() { return Promise.resolve() }
      },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(root, 'workspace')] }) },
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      Menu: { setApplicationMenu() {} }, shell: {},
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString(),
      },
    }
    vm.runInNewContext(source, {
      __dirname: nativeDir, console, Buffer, URL,
      process: { env: { GEOEYE_APP_DATA_PATH: appData }, pid: process.pid, platform: process.platform },
      require: (name) => {
        if (name === 'electron') return electron
        if (name === './activation.cjs') return { createActivationService: (options) => activation.createActivationService({ ...options, publicKey, now: () => time }) }
        return require(name.startsWith('./') ? path.join(nativeDir, name) : name)
      },
      fetch: () => { throw new Error('Offline activation must not use the network') },
    }, { filename: 'main.cjs' })
    await ready()
    return (channel, input) => handlers.get(channel)(null, input)
  }

  try {
    let call = await boot()
    const gated = ['workspace:choose-root', 'datapool:request', 'datapool:configuration', 'project:read', 'project:write', 'project-documents:read', 'project-documents:write', 'project-documents:remove', 'analysis-results:save', 'analysis-results:read', 'files:archive', 'files:export', 'outbox:enqueue', 'outbox:status', 'outbox:run', 'outbox:retry']
    for (const name of gated) assert.throws(() => call(`geoeye:${name}`, {}), /Sign in/)
    assert.equal(call('geoeye:activation:login', { email: 'wrong@example.test', key }).license, null)
    const result = call('geoeye:activation:login', { email, key })
    assert.equal(result.license.email, email)
    assert.equal(result.license.key, undefined)
    assert.ok(fs.existsSync(path.join(appData, 'secrets', 'activation.bin')))

    // New native process reopens the saved key without any network access.
    call = await boot()
    assert.equal(call('geoeye:activation:status').license.email, email)
    const workspace = await call('geoeye:workspace:choose-root')
    const address = { endpoint: 'local', accountId: result.license.accountId, projectId: 'local-test', tenantId: null }
    const snapshot = {
      version: 1, project: { id: address.projectId, organizationId: null, name: 'Local project', description: '', isActive: true, canWrite: true, drillholeCount: 0 },
      datasets: [], variables: [], drillholes: [], observations: [], fieldStructures: [], projection: [], surveysByHoleId: {},
      fieldLogging: { projectId: address.projectId, templates: [], submissions: [], datasets: [] }, refreshedAt: new Date(time).toISOString(),
    }
    call('geoeye:project:write', { address, record: { key: 'local', snapshot, draft: null, tabularDrafts: {} } })
    assert.equal(call('geoeye:project:read', address).snapshot.project.name, 'Local project')
    assert.ok(fs.existsSync(path.join(workspace.rootPath, 'tenants', '_unassigned', 'projects', 'local-test', 'project.sqlite')))
    call('geoeye:project-documents:write', { address, key: 'test-import', value: '{"rows":1}' })
    assert.equal(call('geoeye:project-documents:read', address)['test-import'], '{"rows":1}')

    const packageInput = { address, result: {
      resultId: 'result-1', runId: 'run-1', projectId: address.projectId, tenantId: '_unassigned',
      feature: 'domain', templateId: 'template-1', templateVersion: 1, createdAt: new Date(time).toISOString(),
      sourceFileName: 'import.csv', inputName: 'test', boreholeIds: [], graphs: [],
      analysisFile: { objectKey: 'test/result.json', contents: '{"saved":1}', fileName: 'result.json', mediaType: 'application/json' },
    } }
    call('geoeye:analysis-results:save', packageInput)
    assert.throws(() => call('geoeye:analysis-results:save', { address, result: {
      ...packageInput.result, analysisFile: { ...packageInput.result.analysisFile, contents: '{"saved":2}' },
      graphs: [{ objectKey: 'test/bad.png', imageDataUrl: 'invalid PNG' }],
    } }), /PNG/)
    assert.equal(call('geoeye:analysis-results:read', address)[0].analysisFile.contents, '{"saved":1}', 'failed multi-file save must preserve the prior package')

    const dirty = { collar: [], survey: [], dirty: true, updatedAt: 'v1' }
    call('geoeye:project:write', { address, record: { key: 'local', snapshot, draft: dirty, tabularDrafts: {} } })
    const queued = call('geoeye:outbox:enqueue', { address, entity: 'drillholes', version: 'v1', requests: [{ path: '/v1/projects/local-test/drillholes/hole-1/collar', method: 'PUT', body: '{}' }] })
    const { DatabaseSync } = require('node:sqlite')
    const verification = new DatabaseSync(path.join(workspace.rootPath, 'tenants', '_unassigned', 'projects', 'local-test', 'project.sqlite'))
    verification.prepare("UPDATE transfer_outbox SET state='sent' WHERE id=?").run(queued[0].id)
    verification.close()
    call('geoeye:project:write', { address, record: { key: 'local', snapshot, draft: { ...dirty, dirty: true }, tabularDrafts: {} } })
    assert.equal(call('geoeye:project:read', address).draft.dirty, false, 'a late renderer write must not resurrect acknowledged data')

    time += 60_000
    for (const name of gated) assert.throws(() => call(`geoeye:${name}`, {}), /expired/)
    assert.equal(call('geoeye:activation:status').license, null)
    call('geoeye:activation:logout')
    assert.equal(call('geoeye:activation:status').license, null)
    assert.equal(fs.existsSync(path.join(appData, 'secrets', 'activation.bin')), false)
    assert.ok(fs.existsSync(path.join(workspace.rootPath, 'workspace.json')))
  } finally {
    const resolved = path.resolve(root)
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('geoeye-activation-test-'))
    fs.rmSync(resolved, { recursive: true, force: true })
  }
})
