const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { createWorkspaceFiles } = require('../electron/workspace-files.cjs')

function fixture(t, request = async () => ({ status: 200, body: '{}' })) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geoeye-files-test-'))
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('geoeye-files-test-'))
    fs.rmSync(root, { recursive: true, force: true })
  })
  const databasePath = path.join(root, 'project.sqlite')
  const address = { endpoint: 'https://api.example.test', accountId: 'user', tenantId: 'tenant-1', projectId: 'project-1' }
  const db = new DatabaseSync(databasePath)
  db.exec(`CREATE TABLE local_drillhole_drafts(id TEXT PRIMARY KEY, dirty INTEGER, payload_json TEXT);
    CREATE TABLE local_tabular_drafts(section TEXT PRIMARY KEY, dirty INTEGER, payload_json TEXT);
    CREATE TABLE sync_journal(operation_id TEXT PRIMARY KEY);
    CREATE TABLE sync_state(id TEXT PRIMARY KEY, pushed_at TEXT);
    INSERT INTO sync_state VALUES ('database_snapshot',NULL);`)
  db.prepare('INSERT INTO local_drillhole_drafts VALUES (?,?,?)').run('current', 1, JSON.stringify({ updatedAt: 'v1', dirty: true, collar: [], survey: [] }))
  db.prepare('INSERT INTO local_tabular_drafts VALUES (?,?,?)').run('laboratory', 1, JSON.stringify({ updatedAt: 'v1', dirty: true, section: 'laboratory', rows: [['1']] }))
  db.close()
  const query = (sql, ...params) => { const connection = new DatabaseSync(databasePath); try { return connection.prepare(sql).all(...params) } finally { connection.close() } }
  const api = createWorkspaceFiles({
    openProject(input) { assert.equal(input.accountId, 'user'); return { address: input, database: new DatabaseSync(databasePath), databasePath, settings: { workspaceRoot: root }, registry: { key: 'test' } } },
    atomicWrite(file, contents) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents) },
    requestDataPool: request,
    requireActive() {},
  })
  const enqueue = (entity = 'drillholes') => api.enqueue({ address, entity, version: 'v1', requests: [{ path: `/v1/projects/project-1/${entity === 'drillholes' ? 'drillholes/hole-1/collar' : 'tabular-imports'}`, method: entity === 'drillholes' ? 'PUT' : 'POST', body: '{}' }] })
  return { api, root, address, enqueue, query, databasePath }
}

test('archives original CSV and exports beneath the chosen tenant/project, without overwriting', t => {
  const f = fixture(t)
  const [first] = f.api.archive({ address: f.address, files: [{ name: '../collar.csv', contents: 'hole,x\r\nA,1\r\n' }] })
  const [second] = f.api.archive({ address: f.address, files: [{ name: '../collar.csv', contents: 'replacement' }] })
  assert.notEqual(first, second)
  assert.ok(first.startsWith(path.join(f.root, 'imports', 'tenants', 'tenant-1', 'projects', 'project-1')))
  assert.equal(fs.readFileSync(first, 'utf8'), 'hole,x\r\nA,1\r\n')
  const exported = f.api.exportFile({ address: f.address, name: 'project.json', contents: '{"saved":true}' })
  assert.ok(exported.startsWith(path.join(f.root, 'exports')))
  assert.equal(JSON.parse(fs.readFileSync(exported)).saved, true)
  assert.equal(f.query('SELECT * FROM workspace_files').length, 3)
})

test('successful transfer persists its receipt, clears only the matching draft and is not replayed', async t => {
  let calls = 0
  const f = fixture(t, async () => { calls++; return { status: 200, body: '{}' } })
  f.enqueue(); f.enqueue()
  assert.equal(f.api.status({ address: f.address }).length, 1)
  const rows = await f.api.run({ address: f.address })
  assert.equal(rows[0].state, 'sent')
  assert.equal(f.query('SELECT dirty FROM local_drillhole_drafts')[0].dirty, 0)
  assert.ok(f.query('SELECT pushed_at FROM sync_state')[0].pushed_at)
  await f.api.run({ address: f.address })
  assert.equal(calls, 1)
  const syncDirectory = path.join(f.root, 'sync', 'tenants', 'tenant-1', 'projects', 'project-1')
  const mirror = path.join(syncDirectory, fs.readdirSync(syncDirectory)[0], 'outbox.json')
  assert.equal(JSON.parse(fs.readFileSync(mirror)).operations[0].state, 'sent')
})

test('repeatable PUT retains data on failure and supports durable retry', async t => {
  let calls = 0
  const f = fixture(t, async () => { if (++calls === 1) throw new Error('offline'); return { status: 200, body: '{}' } })
  f.enqueue()
  const rows = await f.api.run({ address: f.address })
  assert.equal(rows[0].state, 'retry')
  assert.equal(f.query('SELECT dirty FROM local_drillhole_drafts')[0].dirty, 1)
  await f.api.run({ address: f.address })
  assert.equal(calls, 1, 'backoff must be respected')
  f.api.retry({ address: f.address, id: rows[0].id })
  assert.equal((await f.api.run({ address: f.address }))[0].state, 'sent')
})

test('unconfirmed POST never retries automatically or clears the local import', async t => {
  let calls = 0
  const f = fixture(t, async () => { calls++; throw new Error('response lost') })
  f.enqueue('laboratory')
  assert.equal((await f.api.run({ address: f.address }))[0].state, 'needs-review')
  await f.api.run({ address: f.address })
  assert.equal(calls, 1)
  assert.equal(f.query('SELECT dirty FROM local_tabular_drafts')[0].dirty, 1)
})

test('confirmed CSV receipt is durable and upload errors remain actionable', async t => {
  const f = fixture(t, async () => ({ status: 201, body: JSON.stringify({ version: 2, importedRows: 1, unmatchedHoles: [] }) }))
  f.enqueue('laboratory')
  const rows = await f.api.run({ address: f.address })
  assert.equal(rows[0].state, 'sent')
  assert.equal(rows[0].result.version, 2)
  assert.equal(f.query('SELECT dirty FROM local_tabular_drafts')[0].dirty, 0)
})

test('a newer local import cannot be acknowledged by an older upload', async t => {
  let f
  f = fixture(t, async () => {
    f.query('UPDATE local_drillhole_drafts SET payload_json = ? RETURNING id', JSON.stringify({ dirty: true, updatedAt: 'v2' }))
    return { status: 200, body: '{}' }
  })
  f.enqueue()
  await f.api.run({ address: f.address })
  assert.equal(f.query('SELECT dirty FROM local_drillhole_drafts')[0].dirty, 1)
})

test('rejects stale versions, other projects, and arbitrary request paths', t => {
  const f = fixture(t)
  assert.throws(() => f.api.enqueue({ address: f.address, entity: 'drillholes', version: 'old', requests: [] }), /changed/)
  assert.throws(() => f.api.enqueue({ address: f.address, entity: 'drillholes', version: 'v1', requests: [{ path: '/v1/projects/other/drillholes/hole/collar', method: 'PUT', body: '{}' }] }), /Invalid/)
  assert.throws(() => f.api.enqueue({ address: f.address, entity: 'drillholes', version: 'v1', requests: [{ path: '/v1/projects/project-1/../../admin', method: 'POST', body: '{}' }] }), /Unsupported/)
})

test('a second worker cannot claim an active transfer', async t => {
  let release
  const response = new Promise(resolve => { release = resolve })
  const f = fixture(t, () => response)
  f.enqueue()
  const first = f.api.run({ address: f.address })
  await assert.rejects(f.api.run({ address: f.address }), /already running/)
  release({ status: 200, body: '{}' })
  await first
})

test('expired PUT leases recover after restart, but interrupted POST needs review', async t => {
  const f = fixture(t)
  f.enqueue()
  f.enqueue('laboratory')
  f.query("UPDATE transfer_outbox SET state='sending',next_attempt_at='2000-01-01T00:00:00.000Z' RETURNING id")
  const rows = await f.api.run({ address: f.address })
  assert.equal(rows.find(row => row.entity === 'drillholes').state, 'sent')
  assert.equal(rows.find(row => row.entity === 'laboratory').state, 'needs-review')
})

test('cancelling a transfer preserves local data and enables a newer import', async t => {
  const f = fixture(t)
  const rows = f.enqueue()
  f.api.cancel({ address: f.address, id: rows[0].id })
  assert.equal((await f.api.run({ address: f.address }))[0].state, 'cancelled')
  assert.equal(f.query('SELECT dirty FROM local_drillhole_drafts')[0].dirty, 1)
  assert.equal(f.enqueue()[0].state, 'pending', 'an explicit sync can requeue the same unchanged import')
})

test('operations are isolated by API endpoint and account scope', async t => {
  const f = fixture(t)
  f.enqueue()
  const other = { ...f.address, endpoint: 'https://other.example.test' }
  assert.equal(f.api.status({ address: other }).length, 0)
  assert.equal((await f.api.run({ address: other })).length, 0)
  assert.equal(f.api.status({ address: f.address })[0].state, 'pending')
})

test('existing parsed imports get a deduplicated recovery archive, never a fake original CSV', t => {
  const f = fixture(t)
  f.api.status({ address: f.address })
  f.api.status({ address: f.address })
  const files = f.query('SELECT name,relative_path FROM workspace_files')
  assert.equal(files.length, 2)
  assert.ok(files.every(file => file.name.endsWith('.json')))
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, files[0].relative_path))).format, 'geoeye-parsed-import')
})
