import type { PoolConfig } from 'pg'

export type RuntimeEnvironment = 'development' | 'test' | 'production'
export type DatabaseSslMode = 'disable' | 'require' | 'verify-full'

export interface ServerConfig {
  nodeEnvironment: RuntimeEnvironment
  host: string
  port: number
  /** Static token for release tooling and machine callers. Optional when users sign in. */
  bearerToken?: string
  /** Signs user session tokens. Enables sign-in with GeoEye accounts. */
  sessionSecret?: string
  sessionTtlSeconds: number
  corsOrigins: ReadonlySet<string>
  database: PoolConfig
  projection: ProjectionConfig
}

export interface ProjectionConfig {
  /** Seconds between in-process projection runs. 0 disables the scheduler. */
  intervalSeconds: number
  includeUnaccepted: boolean
}

export interface MigrationConfig {
  database: PoolConfig
}

function optionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

function requiredValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = optionalValue(environment[name])
  if (value === undefined) throw new Error(`${name} is required`)
  return value
}

function integerValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = optionalValue(environment[name])
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function booleanValue(environment: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = optionalValue(environment[name])?.toLowerCase()
  if (raw === undefined) return fallback
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  throw new Error(`${name} must be true or false`)
}

export function loadProjectionConfig(environment: NodeJS.ProcessEnv = process.env): ProjectionConfig {
  return {
    intervalSeconds: integerValue(environment, 'PROJECTION_INTERVAL_SECONDS', 0, 0, 86_400),
    includeUnaccepted: booleanValue(environment, 'PROJECTION_INCLUDE_UNACCEPTED', false),
  }
}

function runtimeEnvironment(environment: NodeJS.ProcessEnv): RuntimeEnvironment {
  const value = optionalValue(environment.NODE_ENV) ?? 'development'
  if (value !== 'development' && value !== 'test' && value !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production')
  }
  return value
}

function parseDatabaseUrl(value: string, variableName: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL`)
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`${variableName} must use the postgres or postgresql protocol`)
  }
  return url
}

function sslMode(environment: NodeJS.ProcessEnv, nodeEnvironment: RuntimeEnvironment): DatabaseSslMode {
  const value = optionalValue(environment.DATABASE_SSL)
  if (value !== undefined && value !== 'disable' && value !== 'require' && value !== 'verify-full') {
    throw new Error('DATABASE_SSL must be disable, require, or verify-full')
  }
  const mode = value ?? (nodeEnvironment === 'production' ? 'require' : 'disable')
  if (nodeEnvironment === 'production' && mode === 'disable') {
    throw new Error('DATABASE_SSL cannot be disable in production')
  }
  return mode
}

function poolConfig(
  environment: NodeJS.ProcessEnv,
  connectionStringVariable: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL',
  applicationName: string,
  defaultMaximumConnections: number,
): PoolConfig {
  const nodeEnvironment = runtimeEnvironment(environment)
  const fallbackUrl = connectionStringVariable === 'MIGRATION_DATABASE_URL'
    ? optionalValue(environment.MIGRATION_DATABASE_URL) ?? requiredValue(environment, 'DATABASE_URL')
    : requiredValue(environment, 'DATABASE_URL')
  const url = parseDatabaseUrl(fallbackUrl, connectionStringVariable)

  // node-postgres lets connection-string SSL options override the explicit SSL object.
  // Remove them so DATABASE_SSL is the single auditable source of transport policy.
  for (const parameter of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
    url.searchParams.delete(parameter)
  }

  const mode = sslMode(environment, nodeEnvironment)
  const certificate = optionalValue(environment.DATABASE_SSL_CA)?.replace(/\\n/g, '\n')
  if (mode === 'verify-full' && certificate === undefined) {
    throw new Error('DATABASE_SSL_CA is required when DATABASE_SSL=verify-full')
  }

  return {
    connectionString: url.toString(),
    application_name: applicationName,
    max: integerValue(environment, 'DATABASE_POOL_MAX', defaultMaximumConnections, 1, 50),
    connectionTimeoutMillis: integerValue(environment, 'DATABASE_CONNECT_TIMEOUT_MS', 10_000, 1_000, 120_000),
    idleTimeoutMillis: integerValue(environment, 'DATABASE_IDLE_TIMEOUT_MS', 30_000, 1_000, 600_000),
    statement_timeout: integerValue(environment, 'DATABASE_STATEMENT_TIMEOUT_MS', 30_000, 1_000, 900_000),
    idle_in_transaction_session_timeout: integerValue(
      environment,
      'DATABASE_IDLE_TRANSACTION_TIMEOUT_MS',
      30_000,
      1_000,
      900_000,
    ),
    ssl: mode === 'disable'
      ? false
      : mode === 'require'
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true, ca: certificate },
  }
}

function parseCorsOrigins(environment: NodeJS.ProcessEnv, nodeEnvironment: RuntimeEnvironment): ReadonlySet<string> {
  const raw = optionalValue(environment.DATAPOOL_CORS_ORIGINS)
  if (raw === undefined) return new Set()

  const origins = raw.split(',').map((value) => value.trim()).filter(Boolean)
  if (origins.includes('*')) {
    throw new Error('DATAPOOL_CORS_ORIGINS must list exact origins; wildcard origins are not allowed')
  }

  const normalized = origins.map((origin) => {
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      throw new Error(`DATAPOOL_CORS_ORIGINS contains an invalid origin: ${origin}`)
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== origin.replace(/\/$/, '')) {
      throw new Error(`DATAPOOL_CORS_ORIGINS must contain origins without paths: ${origin}`)
    }
    if (nodeEnvironment === 'production' && url.protocol !== 'https:') {
      throw new Error(`Production CORS origins must use HTTPS: ${origin}`)
    }
    return url.origin
  })

  return new Set(normalized)
}

export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnvironment = runtimeEnvironment(environment)
  const bearerToken = optionalValue(environment.DATAPOOL_BEARER_TOKEN)
  const sessionSecret = optionalValue(environment.DATAPOOL_SESSION_SECRET)
  if (bearerToken !== undefined && nodeEnvironment === 'production' && bearerToken.length < 32) {
    throw new Error('DATAPOOL_BEARER_TOKEN must contain at least 32 characters in production')
  }
  if (sessionSecret !== undefined && sessionSecret.length < 32) {
    throw new Error('DATAPOOL_SESSION_SECRET must contain at least 32 characters')
  }
  if (nodeEnvironment === 'production' && sessionSecret === undefined) {
    throw new Error('DATAPOOL_SESSION_SECRET is required in production so users sign in with their GeoEye account')
  }
  if (sessionSecret !== undefined && sessionSecret === bearerToken) {
    throw new Error('DATAPOOL_SESSION_SECRET and DATAPOOL_BEARER_TOKEN must be different values')
  }

  const host = optionalValue(environment.HOST) ?? (nodeEnvironment === 'production' ? '0.0.0.0' : '127.0.0.1')
  const config: ServerConfig = {
    nodeEnvironment,
    host,
    port: integerValue(environment, 'PORT', 8080, 1, 65_535),
    corsOrigins: parseCorsOrigins(environment, nodeEnvironment),
    database: poolConfig(environment, 'DATABASE_URL', 'geoeye-datapool-api', nodeEnvironment === 'production' ? 5 : 10),
    projection: loadProjectionConfig(environment),
    sessionTtlSeconds: integerValue(environment, 'DATAPOOL_SESSION_TTL_SECONDS', 43_200, 300, 2_592_000),
  }
  if (bearerToken !== undefined) config.bearerToken = bearerToken
  if (sessionSecret !== undefined) config.sessionSecret = sessionSecret
  return config
}

/** Runtime-role connection for one-off tools such as the projection command. */
export function loadToolConfig(
  applicationName: string,
  environment: NodeJS.ProcessEnv = process.env,
): MigrationConfig {
  return { database: poolConfig(environment, 'DATABASE_URL', applicationName, 2) }
}

export function loadMigrationConfig(environment: NodeJS.ProcessEnv = process.env): MigrationConfig {
  return {
    database: poolConfig(environment, 'MIGRATION_DATABASE_URL', 'geoeye-datapool-migrate', 1),
  }
}
