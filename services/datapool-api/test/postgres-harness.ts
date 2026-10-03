import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Pool } from 'pg'

export interface IsolatedDatabase {
  /** Superuser pool on the isolated database, for schema setup and fixtures. */
  admin: Pool
  /**
   * Applies database/production/geoeye_api_role.sql under a throwaway role name and
   * returns a connection URL for it. Roles are shared by the whole server, so the
   * real `geoeye_api` role is never created, altered, or given a test password.
   */
  provisionRuntimeRole(): Promise<string>
  drop(): Promise<void>
}

/**
 * Creates a throwaway database next to the one TEST_DATABASE_URL points at, so
 * integration test files can run in parallel and always start from an empty
 * schema regardless of what the server already contains.
 */
export async function createIsolatedDatabase(serverUrl: string): Promise<IsolatedDatabase> {
  const name = `geoeye_it_${randomUUID().replaceAll('-', '')}`
  const server = new Pool({ connectionString: serverUrl, max: 1 })
  await server.query(`CREATE DATABASE ${name}`)

  const databaseUrl = new URL(serverUrl)
  databaseUrl.pathname = `/${name}`
  const admin = new Pool({ connectionString: databaseUrl.toString() })

  const roles: string[] = []

  return {
    admin,
    async provisionRuntimeRole() {
      const role = `geoeye_api_it_${randomUUID().replaceAll('-', '')}`
      const password = randomUUID()
      const repositoryRoot = resolve(import.meta.dirname, '../../..')
      const sql = await readFile(resolve(repositoryRoot, 'database/production/geoeye_api_role.sql'), 'utf8')
      roles.push(role)
      await admin.query(sql.replaceAll('geoeye_api', role))
      await admin.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${password}'`)
      const url = new URL(databaseUrl)
      url.username = role
      url.password = password
      return url.toString()
    },
    async drop() {
      await admin.end()
      try {
        // Dropping the database removes every grant the throwaway roles held.
        await server.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
        for (const role of roles) await server.query(`DROP ROLE IF EXISTS ${role}`)
      } finally {
        await server.end()
      }
    },
  }
}
