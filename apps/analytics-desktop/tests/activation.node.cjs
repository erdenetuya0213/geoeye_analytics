const { test } = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync, sign } = require('node:crypto')
const { verifyActivation, createActivationService } = require('../electron/activation.cjs')

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const now = Date.parse('2026-10-04T12:00:00Z')
const email = 'geologist@example.test'
function issue(changes = {}, signingKey = privateKey) {
  const body = Buffer.from(JSON.stringify({ v: 1, product: 'geoeye-analytics', id: 'license-test', email, nbf: now / 1000 - 60, exp: now / 1000 + 3600, ...changes })).toString('base64url')
  const message = `GEA1.${body}`
  return `${message}.${sign(null, Buffer.from(message), signingKey).toString('base64url')}`
}
function fixture(initial = new Map()) {
  let time = now
  const service = createActivationService({
    publicKey, now: () => time,
    read: (name) => initial.get(name) ?? null,
    write: (name, value) => initial.set(name, structuredClone(value)),
    remove: (name) => initial.delete(name),
  })
  return { service, records: initial, advance: (ms) => { time += ms } }
}

test('accepts a signed key offline, normalizes email, and exposes no key', () => {
  const result = verifyActivation(' Geologist@Example.Test ', issue(), publicKey, now)
  assert.equal(result.email, email)
  assert.equal(result.expiresAt, '2026-10-04T13:00:00.000Z')
  assert.match(result.accountId, /^offline-[a-f0-9]{64}$/)
  assert.equal(result.key, undefined)
})
test('rejects wrong email, changed claims, untrusted signer, and wrong product', () => {
  assert.throws(() => verifyActivation('other@example.test', issue(), publicKey, now), /different email/)
  const pieces = issue().split('.')
  pieces[1] = Buffer.from(JSON.stringify({ email: 'other@example.test' })).toString('base64url')
  assert.throws(() => verifyActivation(email, pieces.join('.'), publicKey, now), /invalid or was changed/)
  const other = generateKeyPairSync('ed25519')
  assert.throws(() => verifyActivation(email, issue({}, other.privateKey), publicKey, now), /invalid or was changed/)
  assert.throws(() => verifyActivation(email, issue({ product: 'other-app' }), publicKey, now), /invalid or was changed/)
})
test('expiry is exclusive; future, malformed, and unsupported licenses are rejected', () => {
  assert.throws(() => verifyActivation(email, issue({ exp: now / 1000 }), publicKey, now), /expired/)
  assert.throws(() => verifyActivation(email, issue({ nbf: now / 1000 + 1 }), publicKey, now), /not valid yet/)
  for (const claims of [{ v: 2 }, { exp: 'forever' }, { exp: -1 }, { exp: 0.5 }, { nbf: null }]) {
    assert.throws(() => verifyActivation(email, issue(claims), publicKey, now), /invalid/)
  }
  assert.throws(() => verifyActivation(email, 'GEA1.incomplete', publicKey, now), /complete/)
})
test('restores a valid activation across restarts and blocks access after expiry', () => {
  const f = fixture()
  f.service.login(email, issue())
  assert.equal(fixture(f.records).service.status().license.email, email)
  f.advance(3600_000)
  assert.equal(f.service.status().license, null)
  assert.throws(() => f.service.requireActive(), /expired/)
  f.advance(-60_000)
  assert.throws(() => f.service.login(email, issue()), /expired/)
})
test('logout retains clock protection and a renewed key preserves account identity', () => {
  const f = fixture()
  const before = f.service.login(email, issue()).license
  f.advance(600_000)
  f.service.requireActive()
  f.service.logout()
  assert.equal(f.service.status().license, null)
  assert.ok(f.records.has('activation-clock'))
  f.advance(-600_000)
  assert.throws(() => f.service.login(email, issue()), /clock has moved backwards/)
  f.advance(600_000)
  const after = f.service.login(email, issue({ id: 'renewal', exp: now / 1000 + 7200 })).license
  assert.equal(before.accountId, after.accountId)
})
test('storage failures never grant a session', () => {
  const service = createActivationService({ publicKey, now: () => now, read: () => null, write: () => { throw new Error('Disk full') }, remove: () => {} })
  assert.throws(() => service.login(email, issue()), /Disk full/)
  assert.equal(service.status().license, null)
})
