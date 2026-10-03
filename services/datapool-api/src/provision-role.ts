import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { loadMigrationConfig } from './config.js'

const password = process.env.DATABASE_APP_PASSWORD
if (password === undefined || password.length < 32) {
  throw new Error('DATABASE_APP_PASSWORD must contain at least 32 characters')
}

const config = loadMigrationConfig()
const pool = new Pool(config.database)
try {
  const repositoryRoot = resolve(import.meta.dirname, '../../..')
  const sql = await readFile(resolve(repositoryRoot, 'database/production/geoeye_api_role.sql'), 'utf8')
  await pool.query(sql)

  // PostgreSQL utility statements do not accept bind parameters. Let PostgreSQL produce
  // the password literal, then use that server-escaped value in the ALTER ROLE statement.
  const escaped = await pool.query<{ literal: string }>(
    'SELECT quote_literal($1::text) AS literal',
    [password],
  )
  const literal = escaped.rows[0]?.literal
  if (literal === undefined) throw new Error('PostgreSQL could not escape the application-role password')
  await pool.query(`ALTER ROLE geoeye_api WITH LOGIN PASSWORD ${literal} VALID UNTIL 'infinity'`)
  process.stdout.write('Provisioned the least-privilege geoeye_api database login.\n')
} finally {
  await pool.end()
}
