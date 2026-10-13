const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { DatabaseSync } = require('node:sqlite')
const { generateKeyPairSync, sign } = require('node:crypto')
const activation = require('../electron/activation.cjs')

// The workspace folder a person opens in Explorer: <Tenant>/<Project>/<Feature>/{import,export}.
test('project files live under tenant and project names, with import and export per feature', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geoeye-layout-test-'))
  const appData = path.join(root, 'appdata')
  const chosenFolder = path.join(root, 'workspace')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const time = Date.parse('2026-10-13T08:00:00Z')
  const email = 'layout-test@example.test'
  const payload = Buffer.from(JSON.stringify({ v: 1, product: 'geoeye-analytics', id: 'layout-test', email, nbf: time / 1000 - 1, exp: time / 1000 + 600 })).toString('base64url')
  const message = `GEA1.${payload}`
  const key = `${message}.${sign(null, Buffer.from(message), privateKey).toString('base64url')}`
  const nativeDir = path.resolve(__dirname, '../electron')
  const source = fs.readFileSync(path.join(nativeDir, 'main.cjs'), 'utf8')
  const handlers = new Map()
  const paths = { appData }
  let ready
  const electron = {
    app: { getPath: (name) => paths[name], setPath: (name, value) => { paths[name] = value }, whenReady: () => ({ then: (callback) => { ready = callback } }), setAppLogsPath() {}, on() {}, quit() {} },
    BrowserWindow: class { webContents = { setWindowOpenHandler() {}, on() {} }; loadFile() { return Promise.resolve() } },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [chosenFolder] }) },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    Menu: { setApplicationMenu() {} }, shell: {},
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
  }
  vm.runInNewContext(source, {
    __dirname: nativeDir, console, Buffer, URL,
    process: { env: { GEOEYE_APP_DATA_PATH: appData }, pid: process.pid, platform: process.platform },
    require: (name) => {
      if (name === 'electron') return electron
      if (name === './activation.cjs') return { createActivationService: (options) => activation.createActivationService({ ...options, publicKey, now: () => time }) }
      return require(name.startsWith('./') ? path.join(nativeDir, name) : name)
    },
    fetch: () => { throw new Error('No network in this test') },
  }, { filename: 'main.cjs' })
  await ready()
  const call = (channel, input) => handlers.get(channel)(null, input)
  const license = call('geoeye:activation:login', { email, key }).license
  const workspaceRoot = (await call('geoeye:workspace:choose-root')).rootPath

  const address = { endpoint: 'local', accountId: license.accountId, projectId: 'project-uuid-1', tenantId: 'tenant-uuid-1' }
  const project = (name) => ({ id: address.projectId, organizationId: address.tenantId, organizationName: 'ASTROGEO ХХК', name, description: '', isActive: true, canWrite: true, drillholeCount: 0 })
  const snapshot = (name) => ({
    version: 1, project: project(name), datasets: [], variables: [], drillholes: [], observations: [], fieldStructures: [], projection: [], surveysByHoleId: {},
    fieldLogging: { projectId: address.projectId, templates: [], submissions: [], datasets: [] }, refreshedAt: new Date(time).toISOString(),
  })
  const write = (name) => call('geoeye:project:write', { address, record: { key: 'local', snapshot: snapshot(name), draft: null, tabularDrafts: {} } })

  write('Төмөртолгой')
  const projectPath = path.join(workspaceRoot, 'ASTROGEO ХХК', 'Төмөртолгой')
  assert.ok(fs.existsSync(path.join(projectPath, 'project.sqlite')), 'the project database sits under tenant/project names')
  assert.ok(!fs.existsSync(path.join(workspaceRoot, 'tenants')), 'no id-named scaffolding is left behind')
  for (const folder of ['Data', 'Statistics', 'Geotech', '3D Analysis', 'Variography']) {
    for (const kind of ['import', 'export']) assert.ok(fs.statSync(path.join(projectPath, folder, kind)).isDirectory(), `${folder}/${kind}`)
  }

  // Imports and screen exports land in the feature folder they belong to.
  call('geoeye:files:archive', { address, files: [{ name: 'assays.csv', contents: 'hole,au\nDH1,1\n' }] })
  call('geoeye:exports:save', { address, feature: 'statistics', files: [{ name: 'Histogram', kind: 'csv', contents: 'a\n' }] })
  const archived = fs.readdirSync(path.join(projectPath, 'Data', 'import'))
  assert.equal(archived.length, 1)
  assert.equal(fs.readdirSync(path.join(projectPath, 'Data', 'import', archived[0]))[0], 'assays.csv')
  assert.ok(fs.existsSync(path.join(projectPath, 'Statistics', 'export', 'Histogram.csv')))

  // Renaming the project in the Database renames its folder and keeps the data.
  write('Төмөртолгой 2027')
  const renamed = path.join(workspaceRoot, 'ASTROGEO ХХК', 'Төмөртолгой 2027')
  assert.ok(!fs.existsSync(projectPath), 'the old folder is gone')
  assert.ok(fs.existsSync(path.join(renamed, 'Statistics', 'export', 'Histogram.csv')), 'exports moved with the project')
  assert.equal(call('geoeye:project:read', address).snapshot.project.name, 'Төмөртолгой 2027')

  // A workspace written by an earlier build is migrated into the same shape.
  const legacyImport = path.join(workspaceRoot, 'imports', 'tenants', 'tenant-uuid-1', 'projects', 'project-uuid-1', 'old-id')
  fs.mkdirSync(legacyImport, { recursive: true })
  fs.writeFileSync(path.join(legacyImport, 'legacy.csv'), 'hole,au\n')
  fs.mkdirSync(path.join(renamed, 'export', 'Grade'), { recursive: true })
  fs.writeFileSync(path.join(renamed, 'export', 'Grade', 'Grade curve.png'), 'png')
  const database = new DatabaseSync(path.join(renamed, 'project.sqlite'))
  database.prepare('INSERT INTO workspace_files VALUES (?,?,?,?,?,?)')
    .run('old-id', 'imports', 'legacy.csv', path.join('imports', 'tenants', 'tenant-uuid-1', 'projects', 'project-uuid-1', 'old-id', 'legacy.csv'), 'checksum', new Date(time).toISOString())
  database.close()

  write('Төмөртолгой 2027')
  assert.ok(fs.existsSync(path.join(renamed, 'Data', 'import', 'old-id', 'legacy.csv')), 'root-level imports move into the project')
  assert.ok(fs.existsSync(path.join(renamed, 'Grade', 'export', 'Grade curve.png')), 'export/<Feature> becomes <Feature>/export')
  assert.ok(!fs.existsSync(path.join(workspaceRoot, 'imports')), 'the old root folders are cleared away')
  assert.ok(!fs.existsSync(path.join(renamed, 'export')))
  const check = new DatabaseSync(path.join(renamed, 'project.sqlite'), { readOnly: true })
  const stored = check.prepare('SELECT relative_path AS path FROM workspace_files WHERE id = ?').get('old-id').path
  check.close()
  assert.equal(stored, path.join('Data', 'import', 'old-id', 'legacy.csv'))
  assert.ok(fs.existsSync(path.join(renamed, stored)), 'stored paths are project-relative and still resolve')
  fs.rmSync(root, { recursive: true, force: true })
})
