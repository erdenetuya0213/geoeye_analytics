import { Pool } from 'pg'
import { loadMigrationConfig } from './config.js'
import { runMigrations, seedCoreVariables } from './migrations.js'

const config = loadMigrationConfig()
const pool = new Pool(config.database)
try {
  const applied = await runMigrations(pool)
  await seedCoreVariables(pool)
  process.stdout.write(
    applied.length === 0
      ? 'Data Pool schema is current; core variable seed reconciled.\n'
      : `Applied Data Pool migrations: ${applied.join(', ')}; core variable seed reconciled.\n`,
  )
} finally {
  await pool.end()
}
