import { resolve } from 'node:path'
import { Pool, type PoolClient } from 'pg'
import { loadMigrationConfig } from './config.js'
import { migrationFiles } from './migrations.js'

// Read-only inspection of a database before Data Pool migrations are applied.
// Everything runs inside one READ ONLY transaction, so this is safe to run
// against staging or production at any time. Exit code 1 means a blocking
// finding; warnings do not fail the run.

type Level = 'ok' | 'info' | 'warn' | 'block'

interface Finding {
  level: Level
  message: string
}

const dataPoolTables = [
  'coordinate_reference_systems', 'variable_definitions', 'datasets', 'dataset_versions',
  'dataset_variables', 'observation_projection_bindings', 'observation_values',
  'drillhole_collars', 'drillhole_surveys', 'analysis_runs', 'derived_values',
  'derivation_inputs', 'analysis_result_packages', 'analysis_result_artifacts',
  'projection_checkpoints',
] as const

const findings: Finding[] = []
function report(level: Level, message: string): void {
  findings.push({ level, message })
}

async function tableColumns(client: PoolClient, table: string): Promise<Map<string, string> | null> {
  const result = await client.query<{ column_name: string; data_type: string }>(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `, [table])
  return result.rows.length === 0
    ? null
    : new Map(result.rows.map((row) => [row.column_name, row.data_type]))
}

async function count(client: PoolClient, sql: string): Promise<number> {
  const result = await client.query<{ value: string }>(sql)
  return Number(result.rows[0]?.value ?? 0)
}

async function inspect(client: PoolClient): Promise<void> {
  const server = await client.query<{
    version: string
    database: string
    username: string
    superuser: boolean
    bypassrls: boolean
    createrole: boolean
  }>(`
    SELECT current_setting('server_version') AS version, current_database() AS database,
           current_user AS username, role.rolsuper AS superuser,
           role.rolbypassrls AS bypassrls, role.rolcreaterole AS createrole
    FROM pg_roles AS role
    WHERE role.rolname = current_user
  `)
  const identity = server.rows[0]
  if (identity === undefined) throw new Error('Could not read the connection identity')
  report('info', `PostgreSQL ${identity.version}, database "${identity.database}", connected as "${identity.username}"`)
  if (Number.parseInt(identity.version, 10) < 15) {
    report('block', 'PostgreSQL 15 or newer is required')
  }
  if (!identity.createrole && !identity.superuser) {
    report('warn', 'This role cannot create roles; `db:provision-role` needs a role with CREATEROLE')
  }
  if (!identity.bypassrls && !identity.superuser) {
    report('warn', 'This role lacks BYPASSRLS; it cannot grant BYPASSRLS to geoeye_api')
  }

  // 1. Field prerequisites the Data Pool foreign keys depend on.
  for (const table of ['profiles', 'projects', 'drill_holes']) {
    const columns = await tableColumns(client, table)
    if (columns === null) {
      report('block', `Field table public.${table} is missing; deploy GeoEye Field to this database first`)
      continue
    }
    if (columns.get('id') !== 'uuid') {
      report('block', `public.${table}.id is ${columns.get('id') ?? 'absent'}; Data Pool foreign keys require uuid`)
    } else {
      report('ok', `Field table public.${table} present with a uuid primary key column`)
    }
    if (table === 'projects' && !columns.has('name') && !columns.has('title')) {
      report('warn', 'public.projects has neither name nor title; projects will be listed by id')
    }
    if (table === 'drill_holes') {
      if (!columns.has('project_id')) report('block', 'public.drill_holes.project_id is missing')
      if (!columns.has('hole_name') && !columns.has('name')) {
        report('warn', 'public.drill_holes has neither hole_name nor name; holes will be listed by id')
      }
    }
  }

  // 2. Field sources feeding the analytical projection.
  const structures = await tableColumns(client, 'logging_structures')
  if (structures === null) {
    report('warn', 'Field table public.logging_structures is missing; no structural observations will be projected')
  } else {
    const required = ['id', 'project_id', 'hole_id', 'row_id', 'depth_from', 'depth_to', 'angle_deg',
      'structure_type', 'selections_json', 'review_status', 'updated_at']
    const missing = required.filter((column) => !structures.has(column))
    if (missing.length > 0) {
      report('warn', `public.logging_structures lacks ${missing.join(', ')}; structural projection will be skipped`)
    } else {
      const byStatus = await client.query<{ review_status: string; rows: string }>(`
        SELECT review_status, count(*)::text AS rows
        FROM logging_structures GROUP BY review_status ORDER BY review_status
      `)
      const summary = byStatus.rows.map((row) => `${row.review_status}=${row.rows}`).join(', ')
      report('ok', `public.logging_structures ready (${summary === '' ? 'no rows yet' : summary})`)

      const keys = await client.query<{ key: string; rows: string }>(`
        SELECT selection.key, count(*)::text AS rows
        FROM logging_structures AS structure
        CROSS JOIN LATERAL jsonb_object_keys(
          CASE WHEN jsonb_typeof(structure.selections_json) = 'object'
               THEN structure.selections_json ELSE '{}'::jsonb END
        ) AS selection(key)
        GROUP BY selection.key
        ORDER BY count(*) DESC, selection.key
        LIMIT 40
      `)
      if (keys.rows.length > 0) {
        report('info', `selections_json keys in use: ${keys.rows.map((row) => `${row.key} (${row.rows})`).join(', ')}`)
        report('info', 'Only keys with a projection binding become observations; see docs/staging-runbook.md')
      }
    }
  }

  const coreRows = await tableColumns(client, 'core_rows')
  if (coreRows === null || !coreRows.has('stage3_rqd_json')) {
    report('warn', 'public.core_rows.stage3_rqd_json is unavailable; RQD will not be projected')
  } else {
    const rqdRows = await count(client, `
      SELECT count(*)::text AS value FROM core_rows
      WHERE stage3_rqd_json IS NOT NULL AND jsonb_typeof(stage3_rqd_json) = 'object'
    `)
    report('ok', `public.core_rows ready (${rqdRows} rows carry an RQD result)`)
  }

  report('info', `Field volume: ${await count(client, 'SELECT count(*)::text AS value FROM projects')} projects, `
    + `${await count(client, 'SELECT count(*)::text AS value FROM drill_holes')} drillholes`)

  // 3. Data Pool migration state and name collisions.
  const repositoryRoot = resolve(import.meta.dirname, '../../..')
  const files = await migrationFiles(repositoryRoot)
  const available = files.map((file) => file.name)

  const ledger = await tableColumns(client, 'geoeye_schema_migrations')
  const recorded = ledger === null
    ? []
    : (await client.query<{ name: string; checksum: string }>(
        'SELECT name, checksum FROM geoeye_schema_migrations ORDER BY name',
      )).rows
  const applied = recorded.map((row) => row.name)
  const pending = available.filter((name) => !applied.includes(name))
  for (const row of recorded) {
    const file = files.find((candidate) => candidate.name === row.name)
    if (file === undefined) {
      report('warn', `Applied migration ${row.name} has no file in this checkout; the database may be ahead of the code`)
    } else if (file.checksum !== row.checksum) {
      report('block', `Migration ${row.name} was edited after it was applied here; the migration command will refuse to run. `
        + 'Restore the applied file and put the change in a new numbered migration.')
    }
  }
  report('info', `Data Pool migrations applied: ${applied.length === 0 ? 'none' : applied.join(', ')}`)
  report(pending.length === 0 ? 'ok' : 'info', `Data Pool migrations pending: ${pending.length === 0 ? 'none' : pending.join(', ')}`)

  if (applied.length === 0) {
    const existing = await client.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name
    `, [dataPoolTables])
    if (existing.rows.length > 0) {
      report('block', 'Tables that the Data Pool migrations create already exist without a migration record: '
        + `${existing.rows.map((row) => row.table_name).join(', ')}. Resolve this before migrating.`)
    } else {
      report('ok', 'No table-name collisions with the Data Pool migrations')
    }
    const touch = await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'geoeye_touch_updated_at'`)
    if ((touch.rowCount ?? 0) > 0) {
      report('warn', 'Function geoeye_touch_updated_at already exists and will be replaced by migration 0001')
    }
  }

  const apiRole = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'geoeye_api'`)
  report('info', (apiRole.rowCount ?? 0) > 0
    ? 'Runtime role geoeye_api exists'
    : 'Runtime role geoeye_api does not exist yet; run `db:provision-role` after migrating')

  // 4. Supabase exposure. Tables in public without RLS are reachable through
  // the Supabase Data API with the anon key.
  const supabase = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'anon'`)
  if ((supabase.rowCount ?? 0) > 0) {
    const exposed = await client.query<{ relname: string }>(`
      SELECT class.relname
      FROM pg_class AS class
      JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public' AND class.relkind = 'r' AND NOT class.relrowsecurity
        AND has_table_privilege('anon', class.oid, 'SELECT')
      ORDER BY class.relname
    `)
    if (exposed.rows.length > 0) {
      report('warn', `Tables readable by the Supabase anon role without RLS: ${exposed.rows.map((row) => row.relname).join(', ')}`)
    } else {
      report('ok', 'No public table is readable by the Supabase anon role without RLS')
    }
    const bucket = await client.query(`
      SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets'
    `)
    if ((bucket.rowCount ?? 0) > 0) {
      const present = await client.query(`SELECT 1 FROM storage.buckets WHERE id = 'geoeye-analysis-results'`)
      report('info', (present.rowCount ?? 0) > 0
        ? 'Storage bucket geoeye-analysis-results exists'
        : 'Storage bucket geoeye-analysis-results is not created yet (database/production/supabase_analysis_storage.sql)')
    }
  } else {
    report('info', 'Supabase roles not detected; treating this as plain PostgreSQL')
  }
}

const pool = new Pool(loadMigrationConfig().database)
try {
  const client = await pool.connect()
  try {
    await client.query('BEGIN TRANSACTION READ ONLY')
    await inspect(client)
  } finally {
    await client.query('ROLLBACK').catch(() => undefined)
    client.release()
  }
} finally {
  await pool.end()
}

const labels: Record<Level, string> = { ok: 'OK   ', info: 'INFO ', warn: 'WARN ', block: 'BLOCK' }
for (const finding of findings) process.stdout.write(`${labels[finding.level]} ${finding.message}\n`)
const blocking = findings.filter((finding) => finding.level === 'block').length
const warnings = findings.filter((finding) => finding.level === 'warn').length
process.stdout.write(`\nPreflight finished: ${blocking} blocking, ${warnings} warnings.\n`)
if (blocking > 0) process.exitCode = 1
