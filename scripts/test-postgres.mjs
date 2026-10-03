import { spawnSync } from 'node:child_process'

// Runs the PostgreSQL integration tests.
//   pnpm test:postgres                         starts a disposable PostgreSQL 16 with Docker
//   TEST_DATABASE_URL=postgres://... pnpm test:postgres
//                                              uses an existing server instead (no Docker)
// Each test file creates and drops its own database, so the server itself is left untouched.
// The connecting role must be allowed to create databases and roles.

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    env: environment,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`)
}

function runTests(databaseUrl) {
  run('pnpm', ['--filter', '@geoeye/datapool-api...', 'build'])
  run(
    'pnpm',
    ['--filter', '@geoeye/datapool-api', 'exec', 'vitest', 'run', 'test/postgres.integration.test.ts', 'test/projection.integration.test.ts'],
    { ...process.env, TEST_DATABASE_URL: databaseUrl },
  )
}

const existing = process.env.TEST_DATABASE_URL?.trim()
if (existing !== undefined && existing !== '') {
  runTests(existing)
} else {
  try {
    run('docker', ['compose', 'down', '-v', '--remove-orphans'])
    run('docker', ['compose', 'up', '-d', '--wait', 'postgres'])
    runTests('postgres://geoeye:geoeye@127.0.0.1:54329/geoeye')
  } finally {
    run('docker', ['compose', 'down', '-v'])
  }
}
