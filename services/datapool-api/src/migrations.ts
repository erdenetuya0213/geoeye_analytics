import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Pool, PoolClient } from 'pg'

export interface MigrationOptions {
  repositoryRoot?: string
}

async function applySqlFile(pool: Pool, repositoryRoot: string, relativePath: string): Promise<void> {
  const sql = await readFile(resolve(repositoryRoot, relativePath), 'utf8')
  await pool.query(sql)
}

export interface MigrationFile {
  checksum: string
  name: string
  sql: string
}

/** Migration files in apply order with the checksum recorded when each is applied. */
export async function migrationFiles(repositoryRoot: string): Promise<MigrationFile[]> {
  const directory = resolve(repositoryRoot, 'database/migrations')
  const names = (await readdir(directory))
    .filter((name) => /^\d+_[a-z0-9_]+\.up\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right))

  return Promise.all(names.map(async (fileName) => {
    const sql = (await readFile(resolve(directory, fileName), 'utf8')).replace(/\r\n/g, '\n')
    return {
      name: fileName.replace(/\.up\.sql$/, ''),
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    }
  }))
}

async function assertFieldPrerequisites(client: PoolClient): Promise<void> {
  const result = await client.query<{ name: string; relation: string | null }>(`
    SELECT prerequisite.name, to_regclass('public.' || prerequisite.name)::text AS relation
    FROM unnest(ARRAY['profiles', 'projects', 'drill_holes']) AS prerequisite(name)
  `)
  const missing = result.rows.filter((row) => row.relation === null).map((row) => row.name)
  if (missing.length > 0) {
    throw new Error(
      `GeoEye Field prerequisites are missing: ${missing.join(', ')}. `
      + 'Deploy the Field schema to this database before running Data Pool migrations.',
    )
  }
}

export async function runMigrations(
  pool: Pool,
  options: MigrationOptions = {},
): Promise<readonly string[]> {
  const repositoryRoot = options.repositoryRoot ?? resolve(import.meta.dirname, '../../..')
  const files = await migrationFiles(repositoryRoot)
  const client = await pool.connect()
  const appliedNow: string[] = []
  let locked = false

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('geoeye_datapool_migrations'))")
    locked = true
    await client.query(`
      CREATE TABLE IF NOT EXISTS geoeye_schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await client.query('ALTER TABLE geoeye_schema_migrations ENABLE ROW LEVEL SECURITY')
    await client.query('REVOKE ALL ON TABLE geoeye_schema_migrations FROM PUBLIC')
    await assertFieldPrerequisites(client)

    const result = await client.query<{ name: string; checksum: string }>(`
      SELECT name, checksum
      FROM geoeye_schema_migrations
    `)
    const applied = new Map(result.rows.map((row) => [row.name, row.checksum]))

    for (const migration of files) {
      const existingChecksum = applied.get(migration.name)
      if (existingChecksum !== undefined) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(`Applied migration ${migration.name} no longer matches its recorded checksum`)
        }
        continue
      }

      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query(`
          INSERT INTO geoeye_schema_migrations (name, checksum)
          VALUES ($1, $2)
        `, [migration.name, migration.checksum])
        await client.query('COMMIT')
        appliedNow.push(migration.name)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
    return appliedNow
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('geoeye_datapool_migrations'))")
    } finally {
      client.release()
    }
  }
}

export async function applyDevelopmentPrerequisites(
  pool: Pool,
  options: MigrationOptions = {},
): Promise<void> {
  const repositoryRoot = options.repositoryRoot ?? resolve(import.meta.dirname, '../../..')
  await applySqlFile(pool, repositoryRoot, 'database/dev/0000_field_prerequisites.sql')
}

export async function applyFoundationMigration(
  pool: Pool,
  options: MigrationOptions = {},
): Promise<void> {
  const repositoryRoot = options.repositoryRoot ?? resolve(import.meta.dirname, '../../..')
  await applySqlFile(pool, repositoryRoot, 'database/migrations/0001_datapool_foundation.up.sql')
}

export async function seedCoreVariables(
  pool: Pool,
  options: MigrationOptions = {},
): Promise<void> {
  const repositoryRoot = options.repositoryRoot ?? resolve(import.meta.dirname, '../../..')
  await applySqlFile(pool, repositoryRoot, 'database/seeds/0001_core_variables.sql')
}
