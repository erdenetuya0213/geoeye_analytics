const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } = require('electron')
const { DatabaseSync } = require('node:sqlite')
const { createHash, randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { createActivationService } = require('./activation.cjs')
const { createDatabaseConnection } = require('./database-connection.cjs')
const { createWorkspaceFiles } = require('./workspace-files.cjs')
// Administrator provisioning is one-shot and never inherited by renderer processes.
const databaseProvisioning = process.env.GEOEYE_DATABASE_PROVISION
delete process.env.GEOEYE_DATABASE_PROVISION

const localBase = process.env.LOCALAPPDATA || app.getPath('appData')
const appDataPath = process.env.GEOEYE_APP_DATA_PATH || path.join(localBase, 'GeoEye', 'Analytics')
const settingsPath = path.join(appDataPath, 'settings.json')
const credentialPath = path.join(appDataPath, 'secrets', 'database-session.bin')
const preloadPath = path.join(__dirname, 'preload.cjs')

fs.mkdirSync(appDataPath, { recursive: true })
app.setPath('userData', appDataPath)
app.setPath('sessionData', path.join(appDataPath, 'Cache', 'WebData'))

const emptySettings = () => ({ projectRegistry: {}, values: {}, version: 1, workspaceRoot: null })

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    if (parsed?.version !== 1 || typeof parsed.values !== 'object' || parsed.values === null) return emptySettings()
    return {
      projectRegistry: typeof parsed.projectRegistry === 'object' && parsed.projectRegistry !== null ? parsed.projectRegistry : {},
      values: parsed.values,
      version: 1,
      workspaceRoot: typeof parsed.workspaceRoot === 'string' ? parsed.workspaceRoot : null,
    }
  } catch {
    return emptySettings()
  }
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporaryPath, data)
  fs.renameSync(temporaryPath, filePath)
}

const activationService = createActivationService({
  publicKey: fs.readFileSync(path.join(__dirname, 'activation-public.pem'), 'utf8'),
  read(name) {
    const file = path.join(appDataPath, 'secrets', `${name}.bin`)
    if (!fs.existsSync(file)) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows protected storage is unavailable.')
    try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) }
    catch { throw new Error('The saved activation could not be read. Enter your key again.') }
  },
  write(name, value) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows protected storage is unavailable.')
    atomicWrite(path.join(appDataPath, 'secrets', `${name}.bin`), safeStorage.encryptString(JSON.stringify(value)))
  },
  remove(name) {
    fs.rmSync(path.join(appDataPath, 'secrets', `${name}.bin`), { force: true })
  },
})

function writeSettings(settings) {
  atomicWrite(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
}

const databaseConnectionPath = path.join(appDataPath, 'secrets', 'configured-database.bin')
const databaseConnection = createDatabaseConnection({
  requireLicense: () => activationService.requireActive(),
  read() {
    if (!fs.existsSync(databaseConnectionPath)) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows protected storage is unavailable.')
    try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(databaseConnectionPath))) }
    catch { throw new Error('The configured Database connection could not be read. Ask your administrator to reconfigure it.') }
  },
  write(value) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows protected storage is unavailable.')
    atomicWrite(databaseConnectionPath, safeStorage.encryptString(JSON.stringify(value)))
  },
})

const dataPoolRequestHeaders = new Set(['accept', 'authorization', 'content-type'])
const dataPoolResponseHeaders = new Set(['content-type', 'retry-after', 'x-request-id'])
const maximumDataPoolBodyBytes = 64 * 1024 * 1024

async function requestDataPool(input) {
  if (typeof input !== 'object' || input === null || typeof input.url !== 'string' || input.url.length > 4096) {
    throw new Error('The Database request address is invalid')
  }

  let url
  try {
    url = new URL(input.url)
  } catch {
    throw new Error('The Database request address is invalid')
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') {
    throw new Error('Only an HTTP or HTTPS Database address is allowed')
  }

  const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET'
  if (!['GET', 'POST', 'PUT'].includes(method)) throw new Error('The Database request method is not allowed')
  const headers = {}
  if (input.headers !== undefined) {
    if (typeof input.headers !== 'object' || input.headers === null) throw new Error('The Database request headers are invalid')
    for (const [name, value] of Object.entries(input.headers)) {
      const normalized = name.toLowerCase()
      if (dataPoolRequestHeaders.has(normalized) && typeof value === 'string' && value.length <= 100_000) {
        headers[normalized] = value
      }
    }
  }
  const body = input.body === undefined ? undefined : input.body
  if (body !== undefined && (typeof body !== 'string' || Buffer.byteLength(body) > maximumDataPoolBodyBytes)) {
    throw new Error('The Database request body is too large')
  }

  const response = await fetch(url, {
    method,
    headers: databaseConnection.headers(url, headers),
    ...(body === undefined ? {} : { body }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maximumDataPoolBodyBytes) {
    throw new Error('The Database response is too large')
  }
  const responseBody = await response.text()
  if (Buffer.byteLength(responseBody) > maximumDataPoolBodyBytes) throw new Error('The Database response is too large')
  const responseHeaders = {}
  response.headers.forEach((value, name) => {
    if (dataPoolResponseHeaders.has(name.toLowerCase())) responseHeaders[name.toLowerCase()] = value
  })
  return {
    body: responseBody,
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
  }
}

function endpointHash(endpoint) {
  return createHash('sha256').update(String(endpoint).replace(/\/$/, '').toLowerCase()).digest('hex').slice(0, 24)
}

function safeSegment(value, fallback) {
  const normalized = String(value ?? '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (normalized || fallback).slice(0, 120)
}

function addressKey(address) {
  return `${endpointHash(address.endpoint)}#${safeSegment(address.accountId, 'local')}#${safeSegment(address.projectId, 'project')}`
}

function requireAddress(value) {
  if (typeof value !== 'object' || value === null) throw new Error('A project storage address is required')
  if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048) throw new Error('The project endpoint is invalid')
  if (typeof value.projectId !== 'string' || value.projectId.length > 200) throw new Error('The project id is invalid')
  return {
    accountId: typeof value.accountId === 'string' ? value.accountId : undefined,
    endpoint: value.endpoint,
    projectId: value.projectId,
    tenantId: value.tenantId === null || typeof value.tenantId === 'string' ? value.tenantId : undefined,
  }
}

function workspaceStatus() {
  const settings = readSettings()
  return { appDataPath, configured: settings.workspaceRoot !== null, rootPath: settings.workspaceRoot }
}

function createWorkspace(rootPath) {
  fs.mkdirSync(rootPath, { recursive: true })
  const manifestPath = path.join(rootPath, 'workspace.json')
  if (!fs.existsSync(manifestPath)) {
    atomicWrite(manifestPath, `${JSON.stringify({
      createdAt: new Date().toISOString(),
      format: 'geoeye-local-workspace',
      id: randomUUID(),
      version: 1,
    }, null, 2)}\n`)
  }
  for (const folder of ['tenants', 'imports', 'exports', 'sync']) fs.mkdirSync(path.join(rootPath, folder), { recursive: true })
}

function resolveProject(settings, address, create) {
  if (settings.workspaceRoot === null) throw new Error('Choose a GeoEye workspace folder before saving project data')
  const key = addressKey(address)
  const registered = settings.projectRegistry[key]
  let relativePath = typeof registered?.relativePath === 'string' ? registered.relativePath : null
  if (relativePath === null && address.tenantId !== undefined) {
    relativePath = path.join(
      'tenants', safeSegment(address.tenantId, '_unassigned'),
      'projects', safeSegment(address.projectId, 'project'),
    )
  }
  if (relativePath === null) return null
  const projectPath = path.resolve(settings.workspaceRoot, relativePath)
  const workspaceRoot = path.resolve(settings.workspaceRoot)
  if (projectPath !== workspaceRoot && !projectPath.startsWith(`${workspaceRoot}${path.sep}`)) throw new Error('The project path leaves the workspace')
  if (create) fs.mkdirSync(projectPath, { recursive: true })
  return { key, projectPath, relativePath }
}

const schemaSql = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS workspace_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS authorized_accounts (account_id TEXT PRIMARY KEY, added_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, organization_id TEXT, name TEXT NOT NULL, description TEXT,
    is_active INTEGER NOT NULL, can_write INTEGER NOT NULL, drillhole_count INTEGER NOT NULL,
    payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS variable_definitions (
    key TEXT PRIMARY KEY, display_name TEXT NOT NULL, data_type TEXT NOT NULL,
    canonical_unit TEXT, origin TEXT NOT NULL, spatial_support TEXT NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, producer_type TEXT NOT NULL,
    producer_name TEXT NOT NULL, spatial_support TEXT NOT NULL, status TEXT NOT NULL,
    current_version INTEGER NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drill_holes (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
    survey_station_count INTEGER NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drillhole_collars (
    hole_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, easting REAL NOT NULL, northing REAL NOT NULL,
    elevation REAL NOT NULL, crs_authority TEXT NOT NULL, crs_code TEXT NOT NULL,
    updated_at TEXT NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drillhole_surveys (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, hole_id TEXT NOT NULL, measured_depth REAL NOT NULL,
    azimuth REAL NOT NULL, dip REAL NOT NULL, payload_json TEXT NOT NULL,
    UNIQUE (hole_id, measured_depth)
  );
  CREATE TABLE IF NOT EXISTS observation_values (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, dataset_id TEXT NOT NULL, dataset_version_id TEXT,
    source_type TEXT NOT NULL, source_id TEXT NOT NULL, source_template_id TEXT, hole_id TEXT,
    depth_from REAL, depth_to REAL, variable_key TEXT NOT NULL, numeric_value REAL, text_value TEXT,
    category_value TEXT, boolean_value INTEGER, datetime_value TEXT, unit TEXT, quality TEXT NOT NULL,
    observed_at TEXT, payload_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_local_observations_dataset ON observation_values(dataset_id, variable_key);
  CREATE INDEX IF NOT EXISTS idx_local_observations_hole_depth ON observation_values(hole_id, depth_from, depth_to);
  CREATE TABLE IF NOT EXISTS logging_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS logging_submissions (
    row_key TEXT PRIMARY KEY, project_id TEXT NOT NULL, hole_id TEXT NOT NULL, template_id TEXT NOT NULL,
    updated_at TEXT, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS logging_datasets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS logging_structures (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, hole_id TEXT, template_id TEXT,
    depth_from REAL, depth_to REAL, review_status TEXT NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projection_checkpoints (
    source_entity_type TEXT PRIMARY KEY, project_id TEXT NOT NULL, dataset_id TEXT,
    source_row_count INTEGER NOT NULL, observation_count INTEGER NOT NULL, issue_count INTEGER NOT NULL,
    last_status TEXT NOT NULL, last_run_at TEXT NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS local_drillhole_drafts (
    id TEXT PRIMARY KEY, dirty INTEGER NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS local_tabular_drafts (
    section TEXT PRIMARY KEY, dirty INTEGER NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY, endpoint_hash TEXT NOT NULL, account_id TEXT,
    pulled_at TEXT, pushed_at TEXT, revision TEXT, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_journal (
    operation_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_key TEXT NOT NULL,
    operation TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, last_error TEXT, payload_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sync_journal_state ON sync_journal(state, updated_at);
  CREATE TABLE IF NOT EXISTS project_documents (
    storage_key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analysis_runs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, analysis_type TEXT NOT NULL,
    algorithm_version TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS derived_values (
    id TEXT PRIMARY KEY, analysis_run_id TEXT NOT NULL, variable_key TEXT NOT NULL,
    source_entity_type TEXT, source_entity_id TEXT, hole_id TEXT, depth_from REAL, depth_to REAL,
    numeric_value REAL, text_value TEXT, category_value TEXT, confidence REAL, status TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS derivation_inputs (
    derived_value_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
    PRIMARY KEY (derived_value_id, source_type, source_id)
  );
  CREATE TABLE IF NOT EXISTS analysis_result_packages (
    result_id TEXT PRIMARY KEY, tenant_key TEXT NOT NULL, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
    feature TEXT NOT NULL, template_id TEXT NOT NULL, template_version INTEGER NOT NULL,
    source_file_name TEXT NOT NULL, input_name TEXT NOT NULL, analysis_file_key TEXT NOT NULL,
    created_at TEXT NOT NULL, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analysis_result_artifacts (
    object_key TEXT PRIMARY KEY, result_id TEXT NOT NULL, borehole_id TEXT, artifact_type TEXT NOT NULL,
    file_name TEXT NOT NULL, media_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
    checksum_sha256 TEXT NOT NULL, relative_path TEXT NOT NULL, metadata_json TEXT NOT NULL
  );
`

function openProject(addressValue, create) {
  const address = requireAddress(addressValue)
  const settings = readSettings()
  const resolved = resolveProject(settings, address, create)
  if (resolved === null) return null
  const databasePath = path.join(resolved.projectPath, 'project.sqlite')
  if (!create && !fs.existsSync(databasePath)) return null
  const database = new DatabaseSync(databasePath)
  database.exec(schemaSql)
  if (address.accountId) {
    if (create) {
      database.prepare('INSERT OR IGNORE INTO authorized_accounts(account_id, added_at) VALUES (?, ?)')
        .run(address.accountId, new Date().toISOString())
    } else {
      const authorized = database.prepare('SELECT 1 AS allowed FROM authorized_accounts WHERE account_id = ?').get(address.accountId)
      if (authorized === undefined) {
        database.close()
        return null
      }
    }
  }
  return { address, database, databasePath, projectPath: resolved.projectPath, registry: resolved, settings }
}

function parseJson(value) {
  return JSON.parse(value)
}

function rowsAsJson(database, table, order = '') {
  const rows = database.prepare(`SELECT payload_json FROM ${table}${order}`).all()
  return rows.map((row) => parseJson(row.payload_json))
}

function putJson(statement, values, payload) {
  statement.run(...values, JSON.stringify(payload))
}

function writeProjectRecord(input) {
  const record = input?.record
  if (typeof record !== 'object' || record === null || typeof record.key !== 'string') throw new Error('The local project record is invalid')
  const address = requireAddress(input.address)
  if (address.tenantId === undefined && record.snapshot?.project?.organizationId !== undefined) {
    address.tenantId = record.snapshot.project.organizationId
  }
  const opened = openProject(address, true)
  const { database } = opened
  // A renderer save may have started before an upload was acknowledged. Never
  // resurrect the exact already-sent version as dirty when that save arrives late.
  if (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transfer_outbox'").get()) {
    const ownerKey = createHash('sha256').update(`${address.endpoint.replace(/\/$/, '').toLowerCase()}#${address.accountId ?? ''}`).digest('hex')
    const sent = database.prepare("SELECT entity,version FROM transfer_outbox WHERE owner_key=? AND state='sent'").all(ownerKey)
    for (const row of sent) {
      const draft = row.entity === 'drillholes' ? record.draft : record.tabularDrafts?.[row.entity]
      if (draft?.updatedAt === row.version) draft.dirty = false
    }
  }
  const snapshot = record.snapshot
  database.exec('BEGIN IMMEDIATE')
  try {
    if (snapshot !== null) {
      const snapshotTables = [
        'projects', 'variable_definitions', 'datasets', 'drillhole_collars', 'drillhole_surveys', 'drill_holes',
        'observation_values', 'logging_templates', 'logging_submissions', 'logging_datasets', 'logging_structures',
        'projection_checkpoints',
      ]
      for (const table of snapshotTables) database.exec(`DELETE FROM ${table}`)

      putJson(database.prepare(`INSERT INTO projects(
        id, organization_id, name, description, is_active, can_write, drillhole_count, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`), [
        snapshot.project.id, snapshot.project.organizationId, snapshot.project.name, snapshot.project.description,
        Number(snapshot.project.isActive), Number(snapshot.project.canWrite), snapshot.project.drillholeCount,
      ], snapshot.project)

      const variableInsert = database.prepare(`INSERT INTO variable_definitions(
        key, display_name, data_type, canonical_unit, origin, spatial_support, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      for (const variable of snapshot.variables) putJson(variableInsert, [
        variable.key, variable.displayName, variable.dataType, variable.canonicalUnit, variable.origin, variable.spatialSupport,
      ], variable)

      const datasetInsert = database.prepare(`INSERT INTO datasets(
        id, project_id, name, producer_type, producer_name, spatial_support, status, current_version, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const dataset of snapshot.datasets) putJson(datasetInsert, [
        dataset.id, dataset.projectId, dataset.name, dataset.producerType, dataset.producerName,
        dataset.spatialSupport, dataset.status, dataset.currentVersion, dataset.updatedAt,
      ], dataset)

      const holeInsert = database.prepare(`INSERT INTO drill_holes(
        id, project_id, name, survey_station_count, payload_json
      ) VALUES (?, ?, ?, ?, ?)`)
      const collarInsert = database.prepare(`INSERT INTO drillhole_collars(
        hole_id, project_id, easting, northing, elevation, crs_authority, crs_code, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      const surveyInsert = database.prepare(`INSERT INTO drillhole_surveys(
        id, project_id, hole_id, measured_depth, azimuth, dip, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      for (const hole of snapshot.drillholes) {
        putJson(holeInsert, [hole.id, hole.projectId, hole.name, hole.surveyStationCount], hole)
        if (hole.collar !== null) putJson(collarInsert, [
          hole.id, hole.projectId, hole.collar.easting, hole.collar.northing, hole.collar.elevation,
          hole.collar.crs.authority, hole.collar.crs.code, hole.collar.updatedAt,
        ], hole.collar)
        for (const station of snapshot.surveysByHoleId[hole.id] ?? []) putJson(surveyInsert, [
          station.id, hole.projectId, hole.id, station.measuredDepth, station.azimuth, station.dip,
        ], station)
      }

      const observationInsert = database.prepare(`INSERT INTO observation_values(
        id, project_id, dataset_id, dataset_version_id, source_type, source_id, source_template_id, hole_id,
        depth_from, depth_to, variable_key, numeric_value, text_value, category_value, boolean_value,
        datetime_value, unit, quality, observed_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const observation of snapshot.observations) putJson(observationInsert, [
        observation.id, observation.projectId, observation.datasetId, observation.datasetVersionId,
        observation.sourceType, observation.sourceId, observation.sourceTemplateId ?? null, observation.holeId,
        observation.depthFrom, observation.depthTo, observation.variableKey, observation.numericValue,
        observation.textValue, observation.categoryValue,
        observation.booleanValue === null ? null : Number(observation.booleanValue), observation.datetimeValue,
        observation.unit, observation.quality, observation.observedAt,
      ], observation)

      const templateInsert = database.prepare('INSERT INTO logging_templates(id, name, version, payload_json) VALUES (?, ?, ?, ?)')
      for (const template of snapshot.fieldLogging.templates) putJson(templateInsert, [template.id, template.name, template.version], template)
      const submissionInsert = database.prepare(`INSERT INTO logging_submissions(
        row_key, project_id, hole_id, template_id, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)`)
      snapshot.fieldLogging.submissions.forEach((submission, index) => putJson(submissionInsert, [
        `${submission.holeId}:${submission.templateId}:${index}`, submission.projectId, submission.holeId,
        submission.templateId, submission.updatedAt,
      ], submission))
      const loggingDatasetInsert = database.prepare('INSERT INTO logging_datasets(id, name, version, updated_at, payload_json) VALUES (?, ?, ?, ?, ?)')
      for (const dataset of snapshot.fieldLogging.datasets ?? []) putJson(loggingDatasetInsert, [dataset.id, dataset.name, dataset.version, dataset.updatedAt], dataset)
      const structureInsert = database.prepare(`INSERT INTO logging_structures(
        id, project_id, hole_id, template_id, depth_from, depth_to, review_status, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const row of snapshot.fieldStructures) putJson(structureInsert, [
        row.id, row.projectId, row.holeId, row.templateId, row.depthFrom, row.depthTo, row.reviewStatus,
      ], row)
      const projectionInsert = database.prepare(`INSERT INTO projection_checkpoints(
        source_entity_type, project_id, dataset_id, source_row_count, observation_count, issue_count,
        last_status, last_run_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const status of snapshot.projection) putJson(projectionInsert, [
        status.sourceEntityType, status.projectId, status.datasetId, status.sourceRowCount,
        status.observationCount, status.issueCount, status.lastStatus, status.lastRunAt,
      ], status)
    }

    database.exec(`
      DELETE FROM local_drillhole_drafts;
      DELETE FROM local_tabular_drafts;
      DELETE FROM sync_journal WHERE entity_type IN ('local_drillhole_draft', 'local_tabular_draft');
    `)
    if (record.draft !== null) putJson(database.prepare(`INSERT INTO local_drillhole_drafts(
      id, dirty, updated_at, payload_json
    ) VALUES (?, ?, ?, ?)`), ['current', Number(record.draft.dirty), record.draft.updatedAt], record.draft)
    const tabularInsert = database.prepare(`INSERT INTO local_tabular_drafts(
      section, dirty, updated_at, payload_json
    ) VALUES (?, ?, ?, ?)`)
    for (const [section, draft] of Object.entries(record.tabularDrafts ?? {})) {
      if (draft !== undefined) putJson(tabularInsert, [section, Number(draft.dirty), draft.updatedAt], draft)
    }
    const journalInsert = database.prepare(`INSERT INTO sync_journal(
      operation_id, entity_type, entity_key, operation, state, created_at, updated_at, last_error, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    if (record.draft?.dirty === true) putJson(journalInsert, [
      'local_drillhole_draft:current', 'local_drillhole_draft', 'current', 'upsert', 'pending',
      record.draft.updatedAt, record.draft.updatedAt, null,
    ], record.draft)
    for (const [section, draft] of Object.entries(record.tabularDrafts ?? {})) {
      if (draft?.dirty === true) putJson(journalInsert, [
        `local_tabular_draft:${section}`, 'local_tabular_draft', section, 'upsert', 'pending',
        draft.updatedAt, draft.updatedAt, null,
      ], draft)
    }
    const syncPayload = {
      accountId: address.accountId ?? null,
      endpointHash: endpointHash(address.endpoint),
      pulledAt: snapshot?.refreshedAt ?? null,
      recordKey: record.key,
    }
    const previousSync = database.prepare("SELECT pushed_at, revision FROM sync_state WHERE id = 'database_snapshot'").get()
    putJson(database.prepare(`INSERT OR REPLACE INTO sync_state(
      id, endpoint_hash, account_id, pulled_at, pushed_at, revision, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`), [
      'database_snapshot', syncPayload.endpointHash, syncPayload.accountId, syncPayload.pulledAt, previousSync?.pushed_at ?? null, previousSync?.revision ?? null,
    ], syncPayload)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  } finally {
    database.close()
  }

  opened.settings.projectRegistry[opened.registry.key] = {
    projectId: address.projectId,
    relativePath: opened.registry.relativePath,
    tenantId: address.tenantId ?? null,
    updatedAt: new Date().toISOString(),
  }
  writeSettings(opened.settings)
}

function readProjectRecord(addressValue) {
  const opened = openProject(addressValue, false)
  if (opened === null) return null
  const { database } = opened
  try {
    const projectRow = database.prepare('SELECT payload_json FROM projects LIMIT 1').get()
    const draftRow = database.prepare('SELECT payload_json FROM local_drillhole_drafts WHERE id = ?').get('current')
    const tabularRows = database.prepare('SELECT section, payload_json FROM local_tabular_drafts').all()
    const syncRow = database.prepare('SELECT payload_json FROM sync_state WHERE id = ?').get('database_snapshot')
    if (projectRow === undefined && draftRow === undefined && tabularRows.length === 0) return null
    const project = projectRow === undefined ? null : parseJson(projectRow.payload_json)
    const holes = rowsAsJson(database, 'drill_holes', ' ORDER BY name')
    const surveysByHoleId = {}
    for (const row of database.prepare('SELECT hole_id, payload_json FROM drillhole_surveys ORDER BY hole_id, measured_depth').all()) {
      surveysByHoleId[row.hole_id] ??= []
      surveysByHoleId[row.hole_id].push(parseJson(row.payload_json))
    }
    const tabularDrafts = Object.fromEntries(tabularRows.map((row) => [row.section, parseJson(row.payload_json)]))
    const recordKey = syncRow === undefined ? addressKey(opened.address) : parseJson(syncRow.payload_json).recordKey
    return {
      draft: draftRow === undefined ? null : parseJson(draftRow.payload_json),
      key: typeof recordKey === 'string' ? recordKey : addressKey(opened.address),
      snapshot: project === null ? null : {
        datasets: rowsAsJson(database, 'datasets', ' ORDER BY name'),
        drillholes: holes,
        fieldLogging: {
          datasets: rowsAsJson(database, 'logging_datasets', ' ORDER BY name'),
          projectId: project.id,
          submissions: rowsAsJson(database, 'logging_submissions'),
          templates: rowsAsJson(database, 'logging_templates', ' ORDER BY name'),
        },
        fieldStructures: rowsAsJson(database, 'logging_structures'),
        observations: rowsAsJson(database, 'observation_values'),
        project,
        projection: rowsAsJson(database, 'projection_checkpoints'),
        refreshedAt: syncRow === undefined ? new Date(0).toISOString() : (parseJson(syncRow.payload_json).pulledAt ?? new Date(0).toISOString()),
        surveysByHoleId,
        variables: rowsAsJson(database, 'variable_definitions', ' ORDER BY key'),
        version: 1,
      },
      tabularDrafts,
    }
  } finally {
    database.close()
  }
}

function readProjectDocuments(address) {
  const opened = openProject(address, false)
  if (opened === null) return {}
  try {
    return Object.fromEntries(opened.database.prepare('SELECT storage_key, value FROM project_documents').all().map((row) => [row.storage_key, row.value]))
  } finally {
    opened.database.close()
  }
}

function writeProjectDocument(input) {
  const key = typeof input?.key === 'string' ? input.key : ''
  const value = typeof input?.value === 'string' ? input.value : null
  if (key.length === 0 || key.length > 500 || value === null) throw new Error('The project document is invalid')
  const opened = openProject(input.address, true)
  try {
    opened.database.prepare(`INSERT INTO project_documents(storage_key, value, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(storage_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(key, value, new Date().toISOString())
  } finally {
    opened.database.close()
  }
}

function removeProjectDocument(input) {
  const opened = openProject(input.address, false)
  if (opened === null) return
  try {
    opened.database.prepare('DELETE FROM project_documents WHERE storage_key = ?').run(String(input.key))
  } finally {
    opened.database.close()
  }
}

function objectFilePath(projectPath, objectKey) {
  const segments = String(objectKey).replaceAll('\\', '/').split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) throw new Error('The result object key is invalid')
  const root = path.resolve(projectPath, 'objects')
  const filePath = path.resolve(root, ...segments.map((segment) => safeSegment(segment, '_')))
  if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('The result object path leaves the project')
  return { filePath, relativePath: path.relative(projectPath, filePath) }
}

function pngBuffer(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(dataUrl))
  if (match === null) throw new Error('Graph images must be PNG data URLs')
  return Buffer.from(match[1], 'base64')
}

function saveArtifact(projectPath, objectKey, data) {
  // Copy-on-write: a failed multi-file save cannot corrupt the previously saved package.
  const target = objectFilePath(projectPath, `revisions/${randomUUID()}/${objectKey}`)
  atomicWrite(target.filePath, data)
  return {
    byteSize: data.byteLength,
    checksum: createHash('sha256').update(data).digest('hex'),
    relativePath: target.relativePath,
  }
}

function saveAnalysisResultPackage(input) {
  const result = input?.result
  if (typeof result !== 'object' || result === null || typeof result.resultId !== 'string') throw new Error('The analysis result package is invalid')
  const opened = openProject(input.address, true)
  const { database, projectPath } = opened
  let analysisStored
  let storedGraphs
  try {
    const analysisBytes = Buffer.from(result.analysisFile.contents, 'utf8')
    analysisStored = saveArtifact(projectPath, result.analysisFile.objectKey, analysisBytes)
    storedGraphs = result.graphs.map((graph) => ({ graph, stored: saveArtifact(projectPath, graph.objectKey, pngBuffer(graph.imageDataUrl)) }))
  } catch (error) { database.close(); throw error }
  const persistedResult = {
    ...result,
    analysisFile: { ...result.analysisFile, contents: '' },
    graphs: result.graphs.map((graph) => ({ ...graph, imageDataUrl: '' })),
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare(`INSERT OR REPLACE INTO analysis_runs(
      id, project_id, analysis_type, algorithm_version, created_at, status, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(result.runId, result.projectId, result.feature, 'local', result.createdAt, 'saved', JSON.stringify({ runId: result.runId, feature: result.feature }))
    database.prepare(`INSERT OR REPLACE INTO analysis_result_packages(
      result_id, tenant_key, project_id, run_id, feature, template_id, template_version,
      source_file_name, input_name, analysis_file_key, created_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(result.resultId, result.tenantId, result.projectId, result.runId, result.feature, result.templateId,
        result.templateVersion, result.sourceFileName, result.inputName, result.analysisFile.objectKey,
        result.createdAt, JSON.stringify(persistedResult))
    database.prepare('DELETE FROM analysis_result_artifacts WHERE result_id = ?').run(result.resultId)
    const artifactInsert = database.prepare(`INSERT INTO analysis_result_artifacts(
      object_key, result_id, borehole_id, artifact_type, file_name, media_type, byte_size,
      checksum_sha256, relative_path, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    artifactInsert.run(result.analysisFile.objectKey, result.resultId,
      result.boreholeIds.length === 1 ? result.boreholeIds[0] : null, 'analysis_file',
      result.analysisFile.fileName, result.analysisFile.mediaType, analysisStored.byteSize,
      analysisStored.checksum, analysisStored.relativePath, '{}')
    for (const { graph, stored } of storedGraphs) artifactInsert.run(
      graph.objectKey, result.resultId, graph.boreholeId, 'graph_image', graph.fileName,
      graph.mediaType, stored.byteSize, stored.checksum, stored.relativePath,
      JSON.stringify({ chartName: graph.chartName }),
    )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  } finally {
    database.close()
  }
}

function readAnalysisResultPackages(address) {
  const opened = openProject(address, false)
  if (opened === null) return []
  const { database, projectPath } = opened
  try {
    const packages = database.prepare('SELECT result_id, payload_json FROM analysis_result_packages ORDER BY created_at DESC').all()
    const artifactQuery = database.prepare('SELECT * FROM analysis_result_artifacts WHERE result_id = ?')
    return packages.map((row) => {
      const result = parseJson(row.payload_json)
      const artifacts = artifactQuery.all(row.result_id)
      const analysisArtifact = artifacts.find((artifact) => artifact.artifact_type === 'analysis_file')
      const graphArtifacts = new Map(artifacts.filter((artifact) => artifact.artifact_type === 'graph_image').map((artifact) => [artifact.object_key, artifact]))
      const analysisFile = analysisArtifact === undefined
        ? result.analysisFile
        : { ...result.analysisFile, contents: fs.readFileSync(path.join(projectPath, analysisArtifact.relative_path), 'utf8') }
      const graphs = result.graphs.map((graph) => {
        const artifact = graphArtifacts.get(graph.objectKey)
        if (artifact === undefined) return graph
        const bytes = fs.readFileSync(path.join(projectPath, artifact.relative_path))
        return { ...graph, imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}` }
      })
      return { ...result, analysisFile, graphs }
    })
  } finally {
    database.close()
  }
}

const workspaceFiles = createWorkspaceFiles({ openProject, atomicWrite, requestDataPool, requireActive: () => activationService.requireActive() })

function registerIpc() {
  ipcMain.handle('geoeye:activation:status', () => activationService.status())
  ipcMain.handle('geoeye:activation:login', (_event, input) => {
    try { return activationService.login(input?.email, input?.key) }
    catch (error) { return { license: null, error: error.message || 'Activation could not be verified.' } }
  })
  ipcMain.handle('geoeye:activation:logout', () => activationService.logout())
  const licensedHandle = (channel, handler) => ipcMain.handle(channel, (event, input) => {
    activationService.requireActive()
    return handler(event, input)
  })
  ipcMain.handle('geoeye:app-storage:read', () => readSettings().values)
  ipcMain.handle('geoeye:app-storage:write', (_event, input) => {
    if (typeof input?.key !== 'string' || typeof input?.value !== 'string' || input.key.length > 500) throw new Error('The app setting is invalid')
    const settings = readSettings()
    settings.values[input.key] = input.value
    writeSettings(settings)
  })
  ipcMain.handle('geoeye:app-storage:remove', (_event, key) => {
    if (typeof key !== 'string') return
    const settings = readSettings()
    delete settings.values[key]
    writeSettings(settings)
  })
  ipcMain.handle('geoeye:credential:load', () => {
    try {
      if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(credentialPath)) return null
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialPath)))
    } catch {
      return null
    }
  })
  ipcMain.handle('geoeye:credential:save', (_event, credential) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable')
    if (typeof credential?.token !== 'string' || credential.token.length === 0 || credential.token.length > 100_000) throw new Error('The database credential is invalid')
    const value = { token: credential.token, ...(typeof credential.accountId === 'string' ? { accountId: credential.accountId } : {}) }
    atomicWrite(credentialPath, safeStorage.encryptString(JSON.stringify(value)))
  })
  ipcMain.handle('geoeye:credential:clear', () => {
    try { fs.rmSync(credentialPath) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  })
  licensedHandle('geoeye:datapool:request', (_event, input) => requestDataPool(input))
  licensedHandle('geoeye:datapool:configuration', () => databaseConnection.status())
  ipcMain.handle('geoeye:workspace:status', () => workspaceStatus())
  licensedHandle('geoeye:workspace:choose-root', async () => {
    const result = await dialog.showOpenDialog({
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose the GeoEye workspace location',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const selected = result.filePaths[0]
    const rootPath = path.basename(selected).toLowerCase() === 'geoeye' ? selected : path.join(selected, 'GeoEye')
    createWorkspace(rootPath)
    const settings = readSettings()
    settings.workspaceRoot = rootPath
    writeSettings(settings)
    return workspaceStatus()
  })
  licensedHandle('geoeye:project:read', (_event, address) => readProjectRecord(address))
  licensedHandle('geoeye:project:write', (_event, input) => writeProjectRecord(input))
  licensedHandle('geoeye:files:archive', (_event, input) => workspaceFiles.archive(input))
  licensedHandle('geoeye:files:export', (_event, input) => workspaceFiles.exportFile(input))
  licensedHandle('geoeye:outbox:enqueue', (_event, input) => workspaceFiles.enqueue(input))
  licensedHandle('geoeye:outbox:status', (_event, input) => workspaceFiles.status(input))
  licensedHandle('geoeye:outbox:run', (_event, input) => workspaceFiles.run(input))
  licensedHandle('geoeye:outbox:retry', (_event, input) => workspaceFiles.retry(input))
  licensedHandle('geoeye:outbox:cancel', (_event, input) => workspaceFiles.cancel(input))
  licensedHandle('geoeye:project-documents:read', (_event, address) => readProjectDocuments(address))
  licensedHandle('geoeye:project-documents:write', (_event, input) => writeProjectDocument(input))
  licensedHandle('geoeye:project-documents:remove', (_event, input) => removeProjectDocument(input))
  licensedHandle('geoeye:analysis-results:save', (_event, input) => saveAnalysisResultPackage(input))
  licensedHandle('geoeye:analysis-results:read', (_event, address) => readAnalysisResultPackages(address))
}

function createWindow() {
  const window = new BrowserWindow({
    backgroundColor: '#101514',
    height: 900,
    minHeight: 700,
    minWidth: 1100,
    show: false,
    title: 'GeoEye Analytics',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
    },
    width: 1500,
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`GeoEye renderer failed to load ${url}: ${code} ${description}`)
    window.show()
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`GeoEye renderer stopped: ${details.reason}`)
  })
  window.webContents.on('did-finish-load', () => window.show())
  void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

function runStorageSmoke(rootPath) {
  createWorkspace(rootPath)
  const settings = readSettings()
  settings.workspaceRoot = rootPath
  writeSettings(settings)
  const projectId = '11111111-1111-4111-8111-111111111111'
  const tenantId = '22222222-2222-4222-8222-222222222222'
  const holeId = '33333333-3333-4333-8333-333333333333'
  const datasetId = '44444444-4444-4444-8444-444444444444'
  const observationId = '55555555-5555-4555-8555-555555555555'
  const address = { accountId: 'storage-smoke', endpoint: 'https://local-smoke.invalid', projectId, tenantId }
  const refreshedAt = new Date().toISOString()
  const record = {
    draft: { collar: [], dirty: true, survey: [], updatedAt: refreshedAt },
    key: 'storage-smoke',
    snapshot: {
      datasets: [{
        createdAt: refreshedAt, currentVersion: 1, description: null, id: datasetId, name: 'Smoke dataset',
        producerName: 'GeoEye Analytics', producerType: 'analytics', projectId, sourceSystem: 'storage-smoke',
        spatialSupport: 'interval', status: 'active', updatedAt: refreshedAt,
      }],
      drillholes: [{
        collar: {
          accuracy: null, crs: { authority: 'EPSG', code: '32648', name: 'WGS 84 / UTM zone 48N' },
          easting: 500000, elevation: 1200, latitude: null, longitude: null, northing: 5200000,
          source: 'storage-smoke', surveyMethod: null, updatedAt: refreshedAt,
        },
        id: holeId, name: 'SMOKE-001', projectId, surveyStationCount: 1,
      }],
      fieldLogging: { datasets: [], projectId, submissions: [], templates: [] },
      fieldStructures: [],
      observations: [{
        booleanValue: null, categoryValue: null, datasetId, datasetVersionId: null, datetimeValue: null,
        depthFrom: 0, depthTo: 1, holeId, id: observationId, numericValue: 1.25, observedAt: refreshedAt,
        projectId, quality: 'accepted', sourceId: 'smoke-row', sourceTemplateId: null,
        sourceType: 'storage-smoke', textValue: null, unit: 'g/t', variableKey: 'assay.au',
      }],
      project: {
        canWrite: true, description: 'Native storage verification', drillholeCount: 1, id: projectId,
        isActive: true, name: 'Storage smoke project', organizationId: tenantId,
        organizationName: 'GeoEye verification',
      },
      projection: [], refreshedAt,
      surveysByHoleId: { [holeId]: [{
        accuracy: null, azimuth: 0, dip: -90, id: '66666666-6666-4666-8666-666666666666',
        measuredDepth: 0, source: 'storage-smoke', surveyMethod: null, surveyedAt: null, tool: null,
      }] },
      variables: [{
        canonicalUnit: 'g/t', compatibleAnalyses: ['eda'], dataType: 'numeric', description: 'Gold assay',
        displayName: 'Gold', key: 'assay.au', metadata: {}, origin: 'primary', spatialSupport: 'interval',
      }],
      version: 1,
    },
    tabularDrafts: {},
  }
  writeProjectRecord({ address, record })
  writeProjectDocument({ address, key: 'geoeye.analytics.storage-smoke.v1', value: '{"ok":true}' })
  const fileName = 'smoke__assay-au__domain-analysis__v1.json'
  const analysisFileKey = `tenants/${tenantId}/projects/${projectId}/boreholes/${holeId}/analytics/domain/v1/${fileName}`
  saveAnalysisResultPackage({ address, result: {
    analysisFile: { contents: '{"verified":true}', fileName, mediaType: 'application/json', objectKey: analysisFileKey },
    analysisFileId: 'storage-smoke-analysis', boreholeIds: [holeId], createdAt: refreshedAt,
    derivedFieldKeys: ['domain.smoke'], feature: 'domain', graphs: [{
      boreholeId: holeId, chartName: 'smoke-graph', fileName: 'smoke.png',
      imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      mediaType: 'image/png',
      objectKey: `tenants/${tenantId}/projects/${projectId}/boreholes/${holeId}/analytics/domain/v1/smoke.png`,
    }],
    inputName: 'assay-au', projectId, resultId: 'domain:smoke:v1', runId: 'storage-smoke-run',
    sourceFileName: 'smoke.csv', sourceObservationIds: [observationId], templateId: datasetId,
    templateVersion: 1, tenantId,
  } })
  const restored = readProjectRecord(address)
  const unauthorized = readProjectRecord({ ...address, accountId: 'unauthorized-storage-smoke' })
  const documents = readProjectDocuments(address)
  const results = readAnalysisResultPackages(address)
  if (restored?.snapshot?.observations?.length !== 1) throw new Error('Native project observation round-trip failed')
  if (restored.draft?.dirty !== true) throw new Error('Native local draft round-trip failed')
  if (unauthorized !== null) throw new Error('Native project account isolation failed')
  if (documents['geoeye.analytics.storage-smoke.v1'] !== '{"ok":true}') throw new Error('Native project document round-trip failed')
  if (results.length !== 1 || results[0].analysisFile.contents !== '{"verified":true}') throw new Error('Native analysis artifact round-trip failed')
  const registry = readSettings().projectRegistry[addressKey(address)]
  const projectPath = path.join(rootPath, registry.relativePath)
  const verificationDatabase = new DatabaseSync(path.join(projectPath, 'project.sqlite'), { readOnly: true })
  const pendingSyncCount = verificationDatabase.prepare("SELECT COUNT(*) AS count FROM sync_journal WHERE state = 'pending'").get().count
  verificationDatabase.close()
  if (pendingSyncCount !== 1) throw new Error('Native pending sync journal verification failed')
  console.log(JSON.stringify({
    databasePath: path.join(projectPath, 'project.sqlite'),
    documentCount: Object.keys(documents).length,
    observationCount: restored.snapshot.observations.length,
    projectPath,
    pendingSyncCount,
    resultCount: results.length,
    rootPath,
  }))
}

app.whenReady().then(async () => {
  fs.mkdirSync(app.getPath('sessionData'), { recursive: true })
  app.setAppLogsPath(path.join(appDataPath, 'logs'))
  Menu.setApplicationMenu(null)
  if (databaseProvisioning) {
    try { await databaseConnection.provision(JSON.parse(databaseProvisioning)) }
    catch (error) { dialog.showErrorBox('Database connection was not configured', error.message || 'Ask your administrator to check the staging API.') }
  }
  const storageSmokeRoot = process.env.GEOEYE_STORAGE_SMOKE_ROOT
  if (storageSmokeRoot) {
    try {
      runStorageSmoke(storageSmokeRoot)
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
