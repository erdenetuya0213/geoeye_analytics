const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')

const digest = (value) => createHash('sha256').update(value).digest('hex')
const segment = (value) => (String(value ?? '_unassigned').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_').replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?=\.|$)/i, '_$1').replace(/\.+$/, '').slice(0, 120) || '_')

// SQLite is authoritative. The folder manifests are readable, rebuildable mirrors,
// never a source of executable requests (editing JSON cannot cause an upload).
function createWorkspaceFiles({ openProject, atomicWrite, requestDataPool, requireActive }) {
  const running = new Set()
  function open(address) {
    const project = openProject(address, false)
    if (!project) throw new Error('Save a local project before managing files or syncing.')
    project.database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_files (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, relative_path TEXT NOT NULL,
        checksum TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transfer_outbox (
        id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, entity TEXT NOT NULL, version TEXT NOT NULL, state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, last_error TEXT,
        requests_json TEXT NOT NULL, result_json TEXT, cursor INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
        UNIQUE(owner_key, entity, version)
      );
    `)
    return project
  }
  function directory(project, kind) {
    const tenantId = project.settings.projectRegistry?.[project.registry.key]?.tenantId ?? project.address.tenantId
    return path.join(project.settings.workspaceRoot, kind, 'tenants', segment(tenantId), 'projects', segment(project.address.projectId))
  }
  const owner = project => digest(`${project.address.endpoint.replace(/\/$/, '').toLowerCase()}#${project.address.accountId ?? ''}`)
  function persistFile(project, kind, name, bytes) {
    const id = randomUUID()
    const target = path.join(directory(project, kind), id, segment(name))
    atomicWrite(target, bytes)
    project.database.prepare('INSERT INTO workspace_files VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, kind, name, path.relative(project.settings.workspaceRoot, target), digest(bytes), new Date().toISOString())
    return target
  }
  function archive({ address, files }) {
    if (!Array.isArray(files) || files.length > 10) throw new Error('Invalid import files.')
    const project = open(address)
    try {
      return files.map(file => {
        if (typeof file.name !== 'string' || typeof file.contents !== 'string' || Buffer.byteLength(file.contents) > 64 * 1024 * 1024) throw new Error('Import file is invalid or larger than 64 MB.')
        if (file.base64 !== undefined && (typeof file.base64 !== 'string' || file.base64.length > 90 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))) throw new Error('Invalid source file bytes.')
        return persistFile(project, 'imports', file.name, file.base64 === undefined ? Buffer.from(file.contents, 'utf8') : Buffer.from(file.base64, 'base64'))
      })
    } finally { project.database.close() }
  }
  function exportFile({ address, name, contents }) {
    if (typeof name !== 'string' || !/\.(json|csv|svg)$/i.test(name) || typeof contents !== 'string' || Buffer.byteLength(contents) > 128 * 1024 * 1024) throw new Error('Invalid export file.')
    const project = open(address)
    try { return persistFile(project, 'exports', name, Buffer.from(contents, 'utf8')) }
    finally { project.database.close() }
  }
  function list(project) {
    return project.database.prepare('SELECT id, entity, version, state, attempts, next_attempt_at AS nextAttemptAt, last_error AS lastError, cursor, result_json FROM transfer_outbox WHERE owner_key=? ORDER BY created_at').all(owner(project)).map(({ result_json, ...row }) => ({ ...row, result: result_json ? JSON.parse(result_json) : null }))
  }
  function mirror(project) {
    const rows = list(project)
    atomicWrite(path.join(directory(project, 'sync'), owner(project), 'outbox.json'), JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), operations: rows }, null, 2))
    return rows
  }
  function draft(project, entity) {
    const row = entity === 'drillholes'
      ? project.database.prepare("SELECT payload_json FROM local_drillhole_drafts WHERE id = 'current'").get()
      : project.database.prepare('SELECT payload_json FROM local_tabular_drafts WHERE section = ?').get(entity)
    return row ? JSON.parse(row.payload_json) : null
  }
  function acknowledge(project, row) {
    const value = draft(project, row.entity)
    if (!value || value.updatedAt !== row.version) return
    value.dirty = false
    if (row.entity === 'drillholes') project.database.prepare("UPDATE local_drillhole_drafts SET dirty = 0, payload_json = ? WHERE id = 'current'").run(JSON.stringify(value))
    else project.database.prepare('UPDATE local_tabular_drafts SET dirty = 0, payload_json = ? WHERE section = ?').run(JSON.stringify(value), row.entity)
    project.database.prepare('DELETE FROM sync_journal WHERE operation_id = ?').run(row.entity === 'drillholes' ? 'local_drillhole_draft:current' : `local_tabular_draft:${row.entity}`)
    project.database.prepare("UPDATE sync_state SET pushed_at = ? WHERE id = 'database_snapshot'").run(new Date().toISOString())
  }
  function enqueue({ address, entity, version, requests }) {
    const project = open(address)
    try {
      if (running.has(project.databasePath)) throw new Error('Sync is already running. Wait before queuing another transfer.')
      const current = draft(project, entity)
      if (!current?.dirty || current.updatedAt !== version) throw new Error('The import changed. Reload the project and try again.')
      const prefix = `/v1/projects/${encodeURIComponent(project.address.projectId)}/`
      if (!Array.isArray(requests) || !requests.length || requests.length > 10000) throw new Error('No valid records to sync.')
      for (const request of requests) {
        if (typeof request.path !== 'string' || !request.path.startsWith(prefix) || !['PUT', 'POST'].includes(request.method) || typeof request.body !== 'string') throw new Error('Invalid sync request.')
        const tail = request.path.slice(prefix.length)
        if (!(entity === 'drillholes' && request.method === 'PUT' && /^drillholes\/[a-zA-Z0-9-]+\/(collar|surveys)$/.test(tail)) && !(entity !== 'drillholes' && request.method === 'POST' && tail === 'tabular-imports')) throw new Error('Unsupported sync operation.')
      }
      // A newer import cannot overtake an unconfirmed POST or an older queued version.
      if (project.database.prepare("SELECT id FROM transfer_outbox WHERE owner_key=? AND entity = ? AND version <> ? AND state NOT IN ('sent','cancelled')").get(owner(project), entity, version)) throw new Error('Resolve the previous pending transfer before syncing a newer import.')
      project.database.prepare("INSERT OR IGNORE INTO transfer_outbox(id,owner_key,entity,version,state,requests_json,created_at) VALUES (?,?,?,?,'pending',?,?)")
        .run(randomUUID(), owner(project), entity, version, JSON.stringify(requests), new Date().toISOString())
      project.database.prepare("UPDATE transfer_outbox SET state='pending', next_attempt_at=NULL WHERE owner_key=? AND entity=? AND version=? AND state='cancelled'").run(owner(project), entity, version)
      return mirror(project)
    } finally { project.database.close() }
  }
  function status({ address }) {
    const project = open(address)
    try {
      // Older versions retained only parsed rows, so recover those honestly as
      // JSON rather than fabricating an original CSV that no longer exists.
      for (const entity of ['drillholes', 'laboratory', 'strength', 'xrf', 'spectral']) {
        const value = draft(project, entity)
        if (!value) continue
        const contents = JSON.stringify({ format: 'geoeye-parsed-import', entity, draft: value }, null, 2)
        if (!project.database.prepare("SELECT id FROM workspace_files WHERE kind='imports' AND checksum=?").get(digest(contents))) persistFile(project, 'imports', `parsed-${entity}.json`, Buffer.from(contents))
      }
      return mirror(project)
    } finally { project.database.close() }
  }
  function retry({ address, id }) {
    const project = open(address)
    try {
      if (running.has(project.databasePath)) throw new Error('Wait for the active sync to finish.')
      project.database.prepare("UPDATE transfer_outbox SET state='pending', next_attempt_at=NULL,last_error=NULL WHERE id=? AND owner_key=? AND state IN ('retry','needs-review')").run(id, owner(project))
      return mirror(project)
    } finally { project.database.close() }
  }
  function cancel({ address, id }) {
    const project = open(address)
    try {
      if (running.has(project.databasePath)) throw new Error('Wait for the active sync to finish.')
      project.database.prepare("UPDATE transfer_outbox SET state='cancelled',next_attempt_at=NULL WHERE owner_key=? AND id=? AND state IN ('pending','retry','needs-review')").run(owner(project), id)
      return mirror(project)
    } finally { project.database.close() }
  }
  async function run({ address }) {
    requireActive()
    const project = open(address)
    if (running.has(project.databasePath)) { project.database.close(); throw new Error('Sync is already running.') }
    running.add(project.databasePath)
    try {
      // Recover interrupted requests conservatively: PUT is repeatable; POST may
      // already have committed a dataset version and must never be blindly retried.
      for (const row of project.database.prepare("SELECT * FROM transfer_outbox WHERE owner_key=? AND state = 'sending' AND next_attempt_at <= ?").all(owner(project), new Date().toISOString())) {
        const request = JSON.parse(row.requests_json)[row.cursor]
        if (!request) {
          acknowledge(project, row)
          project.database.prepare("UPDATE transfer_outbox SET state='sent', next_attempt_at=NULL,last_error=NULL WHERE id=?").run(row.id)
          continue
        }
        project.database.prepare('UPDATE transfer_outbox SET state=?, last_error=? WHERE id=?').run(request?.method === 'PUT' ? 'pending' : 'needs-review', 'Interrupted transfer. Verify the remote dataset before retrying an unconfirmed upload.', row.id)
      }
      const rows = project.database.prepare("SELECT * FROM transfer_outbox WHERE owner_key=? AND state IN ('pending','retry') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at").all(owner(project), new Date().toISOString())
      for (const row of rows) {
        const claimed = project.database.prepare("UPDATE transfer_outbox SET state='sending', next_attempt_at=? WHERE id=? AND state IN ('pending','retry')").run(new Date(Date.now() + 120000).toISOString(), row.id)
        if (!claimed.changes) continue
        const requests = JSON.parse(row.requests_json)
        for (let index = row.cursor; index < requests.length; index++) {
          requireActive()
          const request = requests[index]
          project.database.prepare("UPDATE transfer_outbox SET state='sending', next_attempt_at=?, attempts=attempts+1, last_error=NULL WHERE id=?").run(new Date(Date.now() + 120000).toISOString(), row.id)
          let response
          try {
            response = await requestDataPool({ url: `${address.endpoint.replace(/\/$/, '')}${request.path}`, method: request.method, body: request.body, headers: { 'content-type': 'application/json' } })
          } catch {
            const state = request.method === 'PUT' ? 'retry' : 'needs-review'
            project.database.prepare('UPDATE transfer_outbox SET state=?, next_attempt_at=?, last_error=? WHERE id=?').run(state, new Date(Date.now() + 30000 * 2 ** Math.min(row.attempts, 5)).toISOString(), 'Connection interrupted. Local data is safe; an unconfirmed CSV upload needs review before resending.', row.id)
            break
          }
          if (response.status < 200 || response.status >= 300) {
            const retry = request.method === 'PUT' && (response.status === 429 || response.status >= 500)
            project.database.prepare('UPDATE transfer_outbox SET state=?, next_attempt_at=?, last_error=? WHERE id=?').run(retry ? 'retry' : 'needs-review', new Date(Date.now() + 30000 * 2 ** Math.min(row.attempts, 5)).toISOString(), `Database returned ${response.status}. Check connection, project permissions, and import values.`, row.id)
            break
          }
          let result = null
          try { result = JSON.parse(response.body) } catch { /* Empty successful PUT response. */ }
          if (request.method === 'POST' && (!result || !Number.isInteger(result.version) || !Number.isInteger(result.importedRows) || !Array.isArray(result.unmatchedHoles))) {
            project.database.prepare("UPDATE transfer_outbox SET state='needs-review',last_error='Unexpected upload response. Verify the remote dataset before resending.' WHERE id=?").run(row.id)
            break
          }
          project.database.prepare('UPDATE transfer_outbox SET cursor=?,result_json=? WHERE id=?').run(index + 1, JSON.stringify(result), row.id)
          if (index === requests.length - 1) {
            project.database.exec('BEGIN IMMEDIATE')
            try {
              acknowledge(project, row)
              project.database.prepare("UPDATE transfer_outbox SET state='sent', next_attempt_at=NULL,last_error=NULL WHERE id=?").run(row.id)
              project.database.exec('COMMIT')
            } catch (error) { project.database.exec('ROLLBACK'); throw error }
          }
        }
      }
      return mirror(project)
    } finally { running.delete(project.databasePath); project.database.close() }
  }
  return { archive, exportFile, enqueue, status, run, retry, cancel }
}
module.exports = { createWorkspaceFiles }
