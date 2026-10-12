const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createDatabaseConnection, validateConnection } = require('../electron/database-connection.cjs')
const now = Date.parse('2026-10-04T00:00:00Z')
const value = { endpoint: 'https://staging.example.test/api', token: 'private-user-token', accountId: 'user-1', email: 'info@example.test', expiresAt: '2026-11-01T00:00:00Z' }
function fixture(overrides = {}) {
  let stored = null
  const service = createDatabaseConnection({
    read: () => stored, write: (v) => { stored = v }, now: () => now,
    requireLicense: () => ({ email: value.email, expiresAt: '2026-11-03T00:00:00Z' }),
    fetch: async () => ({ ok: true, json: async () => ({ user: { id: value.accountId, email: value.email } }) }), ...overrides,
  })
  return service
}

test('local metadata restores the offline account without fetching or renewing expired Database access', () => {
  let requests = 0
  const service = fixture({ read: () => value, now: () => Date.parse(value.expiresAt), fetch: async () => { requests++; throw new Error('No network expected') } })
  assert.equal(service.metadata().accountId, value.accountId)
  assert.equal(service.metadata().token, undefined)
  assert.equal(requests, 0)
  assert.throws(() => service.headers('https://staging.example.test/api/v1/projects', {}), /expired/)
  assert.throws(() => fixture({ read: () => value, requireLicense: () => ({ email: 'other@example.test' }) }).metadata(), /another/)
})
test('provisioning verifies identity, hides tokens, and injects only into the pinned API', async () => {
  const service = fixture()
  const result = await service.provision(value)
  assert.equal(result.token, undefined)
  assert.equal(service.status().email, value.email)
  assert.equal(service.headers('https://staging.example.test/api/v1/projects', {}).authorization, `Bearer ${value.token}`)
  for (const url of ['https://evil.test/api/v1/projects', 'https://staging.example.test/api2/v1/projects', 'https://staging.example.test/api/v1/../../other']) {
    assert.throws(() => service.headers(url, {}), /outside/)
  }
})
test('wrong account, email, expiry, and rejected server never persist credentials', async () => {
  for (const change of [{ email: 'other@example.test' }, { expiresAt: '2026-12-01T00:00:00Z' }, { expiresAt: '2026-10-01T00:00:00Z' }]) {
    const service = fixture()
    await assert.rejects(service.provision({ ...value, ...change }))
    assert.equal(service.status(), null)
  }
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ user: { id: 'other', email: value.email } }) }]) {
    const service = fixture({ fetch: async () => response })
    await assert.rejects(service.provision(value))
    assert.equal(service.status(), null)
  }
})
test('expired or other-user records and unavailable protected storage fail closed', async () => {
  assert.throws(() => fixture({ read: () => value, now: () => Date.parse(value.expiresAt) }).status(), /expired/)
  assert.throws(() => fixture({ read: () => value, requireLicense: () => ({ email: 'other@example.test' }) }).status(), /another/)
  await assert.rejects(fixture({ write: () => { throw new Error('Protected storage unavailable') } }).provision(value), /Protected storage/)
})
test('allows local HTTP only, rejects URL credentials, query, fragment, and remote HTTP', () => {
  assert.equal(validateConnection({ ...value, endpoint: 'http://127.0.0.1:8080/' }).endpoint, 'http://127.0.0.1:8080')
  for (const endpoint of ['http://example.test', 'https://user:pass@example.test', 'https://example.test?token=x', 'https://example.test#fragment']) {
    assert.throws(() => validateConnection({ ...value, endpoint }))
  }
})
test('a valid native activation restores and renews the Database session automatically', async () => {
  let stored = null
  let requests = 0
  let prepared = 0
  const service = createDatabaseConnection({
    read: () => stored,
    write: (next) => { stored = next },
    now: () => now,
    defaultEndpoint: 'http://127.0.0.1:8080',
    requireLicense: () => ({ email: value.email, expiresAt: '2026-11-03T00:00:00Z' }),
    activeCredential: () => ({ email: value.email, key: 'GEA1.payload.signature' }),
    prepareEndpoint: async (endpoint) => {
      prepared += 1
      assert.equal(endpoint, 'http://127.0.0.1:8080')
    },
    fetch: async (url, init) => {
      requests += 1
      assert.equal(url, 'http://127.0.0.1:8080/v1/auth/activation')
      assert.deepEqual(JSON.parse(init.body), { email: value.email, activationKey: 'GEA1.payload.signature' })
      return {
        ok: true,
        json: async () => ({
          accessToken: `session-${requests}`,
          expiresAt: '2026-10-04T12:00:00Z',
          user: { id: value.accountId, email: value.email },
        }),
      }
    },
  })
  assert.equal((await service.connect()).email, value.email)
  assert.equal(prepared, 1)
  assert.equal(service.headers('http://127.0.0.1:8080/v1/projects', {}).authorization, 'Bearer session-1')
  await service.connect(true)
  assert.equal(prepared, 2)
  assert.equal(service.headers('http://127.0.0.1:8080/v1/projects', {}).authorization, 'Bearer session-2')
})
