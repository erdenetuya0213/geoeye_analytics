const { createHash, verify } = require('node:crypto')
const PRODUCT = 'geoeye-analytics'
const CLOCK_TOLERANCE_MS = 5 * 60_000

function normalizeEmail(value) {
  if (typeof value !== 'string' || value.length > 320) throw new Error('Enter the email address on your activation key.')
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.')
  return email
}

function verifyActivation(emailValue, keyValue, publicKey, now = Date.now(), lastSeen = 0) {
  const email = normalizeEmail(emailValue)
  if (typeof keyValue !== 'string' || keyValue.length > 8192) throw new Error('The activation key is invalid.')
  const key = keyValue.trim()
  const parts = key.split('.')
  if (parts.length !== 3 || parts[0] !== 'GEA1' || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
    throw new Error('Paste the complete activation key provided to you.')
  }
  let claims
  try {
    const signature = Buffer.from(parts[2], 'base64url')
    if (signature.length !== 64 || !verify(null, Buffer.from(`GEA1.${parts[1]}`), publicKey, signature)) throw new Error()
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (claims.v !== 1 || claims.product !== PRODUCT || typeof claims.id !== 'string' || claims.id.length < 1
      || claims.email !== normalizeEmail(claims.email)
      || !Number.isSafeInteger(claims.nbf) || !Number.isSafeInteger(claims.exp)
      || claims.nbf < 0 || claims.exp <= claims.nbf || claims.exp > 253402300799) throw new Error()
  } catch {
    throw new Error('The activation key is invalid or was changed. Request a new key.')
  }
  if (claims.email !== email) throw new Error('This activation key belongs to a different email address.')
  if (!Number.isFinite(now) || !Number.isFinite(lastSeen) || lastSeen < 0) throw new Error('The activation clock could not be verified.')
  if (now + CLOCK_TOLERANCE_MS < lastSeen) throw new Error('The computer clock has moved backwards. Correct the date and time, then try again.')
  const effectiveNow = Math.max(now, lastSeen)
  if (effectiveNow < claims.nbf * 1000) throw new Error('This activation key is not valid yet. Check the computer date and time.')
  if (effectiveNow >= claims.exp * 1000) {
    const error = new Error('Your activation key has expired. Enter a renewed key to continue.')
    error.code = 'ACTIVATION_EXPIRED'
    throw error
  }
  return {
    email,
    licenseId: claims.id,
    accountId: `offline-${createHash('sha256').update(email).digest('hex')}`,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  }
}

/** Only Windows-encrypted records are persisted; a logout retains the clock high-water mark. */
function createActivationService({ read, write, remove, publicKey, now = Date.now }) {
  let session = null
  function clock() {
    const saved = read('activation-clock')
    if (saved === null) return 0
    if (!Number.isFinite(saved.lastSeen) || saved.lastSeen < 0) throw new Error('The activation clock record is damaged.')
    return saved.lastSeen
  }
  function check(record) {
    const current = now()
    const previous = clock()
    let info
    try { info = verifyActivation(record.email, record.key, publicKey, current, previous) }
    catch (error) {
      // Once expiry has been observed, moving the clock back cannot revive the key.
      if (error.code === 'ACTIVATION_EXPIRED') write('activation-clock', { lastSeen: Math.max(current, previous) })
      throw error
    }
    write('activation-clock', { lastSeen: Math.max(current, previous) })
    return info
  }
  return {
    login(email, key) {
      const record = { email: normalizeEmail(email), key: typeof key === 'string' ? key.trim() : key }
      const info = check(record)
      write('activation', record)
      session = record
      return { license: info, error: null }
    },
    status() {
      try {
        const record = session ?? read('activation')
        if (record === null) return { license: null, error: null }
        const info = check(record)
        session = record
        return { license: info, error: null }
      } catch (error) {
        session = null
        return { license: null, error: error.message || 'Activation could not be verified.' }
      }
    },
    requireActive() {
      const result = this.status()
      if (result.license === null) throw new Error(result.error ?? 'Sign in with your email and activation key.')
      return result.license
    },
    logout() {
      remove('activation')
      session = null
    },
  }
}

module.exports = { PRODUCT, normalizeEmail, verifyActivation, createActivationService }
