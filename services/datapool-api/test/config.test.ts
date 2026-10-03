import { describe, expect, it } from 'vitest'
import { loadMigrationConfig, loadServerConfig } from '../src/config.js'

const localUrl = 'postgres://geoeye:geoeye@127.0.0.1:54329/geoeye'

describe('Data Pool configuration', () => {
  it('uses local-safe development defaults', () => {
    const config = loadServerConfig({ DATABASE_URL: localUrl })

    expect(config).toMatchObject({
      nodeEnvironment: 'development',
      host: '127.0.0.1',
      port: 8080,
      database: { max: 10, ssl: false },
    })
    expect(config.bearerToken).toBeUndefined()
  })

  it('requires encryption and a strong API token in production', () => {
    expect(() => loadServerConfig({
      NODE_ENV: 'production',
      DATABASE_URL: localUrl,
      DATAPOOL_BEARER_TOKEN: 'short',
    })).toThrow(/at least 32 characters/)

    expect(() => loadServerConfig({
      NODE_ENV: 'production',
      DATABASE_URL: localUrl,
      DATABASE_SSL: 'disable',
      DATAPOOL_BEARER_TOKEN: 'a'.repeat(32),
      DATAPOOL_SESSION_SECRET: 's'.repeat(32),
    })).toThrow(/cannot be disable/)
  })

  it('normalizes exact CORS origins and rejects production HTTP origins', () => {
    const config = loadServerConfig({
      DATABASE_URL: localUrl,
      DATAPOOL_CORS_ORIGINS: 'http://localhost:5173, https://analytics.example.com/',
    })
    expect([...config.corsOrigins]).toEqual([
      'http://localhost:5173',
      'https://analytics.example.com',
    ])

    expect(() => loadServerConfig({
      NODE_ENV: 'production',
      DATABASE_URL: localUrl,
      DATAPOOL_BEARER_TOKEN: 'a'.repeat(32),
      DATAPOOL_SESSION_SECRET: 's'.repeat(32),
      DATAPOOL_CORS_ORIGINS: 'http://analytics.example.com',
    })).toThrow(/must use HTTPS/)
  })

  it('uses a dedicated migration URL and removes URL-level SSL overrides', () => {
    const config = loadMigrationConfig({
      DATABASE_URL: localUrl,
      MIGRATION_DATABASE_URL: 'postgresql://postgres:secret@db.example.com:5432/postgres?sslmode=disable',
      DATABASE_SSL: 'verify-full',
      DATABASE_SSL_CA: 'line-one\\nline-two',
    })

    expect(config.database.connectionString).not.toContain('sslmode')
    expect(config.database).toMatchObject({
      max: 1,
      ssl: { rejectUnauthorized: true, ca: 'line-one\nline-two' },
    })
  })

  it('keeps the projection scheduler off by default and validates its settings', () => {
    expect(loadServerConfig({ DATABASE_URL: localUrl }).projection).toEqual({
      intervalSeconds: 0,
      includeUnaccepted: false,
    })
    expect(loadServerConfig({
      DATABASE_URL: localUrl,
      PROJECTION_INTERVAL_SECONDS: '300',
      PROJECTION_INCLUDE_UNACCEPTED: 'true',
    }).projection).toEqual({ intervalSeconds: 300, includeUnaccepted: true })

    expect(() => loadServerConfig({ DATABASE_URL: localUrl, PROJECTION_INTERVAL_SECONDS: '-5' }))
      .toThrow(/PROJECTION_INTERVAL_SECONDS/)
    expect(() => loadServerConfig({ DATABASE_URL: localUrl, PROJECTION_INCLUDE_UNACCEPTED: 'yes' }))
      .toThrow(/PROJECTION_INCLUDE_UNACCEPTED/)
  })

  it('requires user sign-in in production and keeps the service token optional', () => {
    const production = { NODE_ENV: 'production', DATABASE_URL: localUrl }
    expect(() => loadServerConfig(production)).toThrow(/DATAPOOL_SESSION_SECRET is required/)
    expect(() => loadServerConfig({ ...production, DATAPOOL_SESSION_SECRET: 'short' }))
      .toThrow(/at least 32 characters/)
    expect(() => loadServerConfig({
      ...production,
      DATAPOOL_SESSION_SECRET: 's'.repeat(32),
      DATAPOOL_BEARER_TOKEN: 's'.repeat(32),
    })).toThrow(/must be different/)

    const config = loadServerConfig({ ...production, DATAPOOL_SESSION_SECRET: 's'.repeat(32) })
    expect(config.sessionSecret).toBe('s'.repeat(32))
    expect(config.bearerToken).toBeUndefined()
    expect(config.sessionTtlSeconds).toBe(43_200)
  })
})
