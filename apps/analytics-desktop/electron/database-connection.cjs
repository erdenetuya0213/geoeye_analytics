const { normalizeEmail } = require('./activation.cjs')

function validateConnection(value) {
  if (!value || typeof value.endpoint !== 'string' || typeof value.token !== 'string'
    || value.token.length < 1 || value.token.length > 100_000 || typeof value.accountId !== 'string'
    || !value.accountId || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error('The configured Database connection is invalid.')
  const url = new URL(value.endpoint)
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new Error('Database connections require HTTPS, or a local loopback API.')
  }
  return { endpoint: url.toString().replace(/\/+$/, ''), token: value.token, accountId: value.accountId,
    email: normalizeEmail(value.email), expiresAt: new Date(value.expiresAt).toISOString() }
}

function createDatabaseConnection({ read, write, requireLicense, fetch: request = globalThis.fetch, now = Date.now }) {
  function current() {
    const license = requireLicense()
    const value = read()
    if (value === null) return null
    const connection = validateConnection(value)
    if (connection.email !== license.email) throw new Error('The configured Database connection belongs to another licensed email. Ask your administrator to configure this account.')
    if (Date.parse(connection.expiresAt) <= now()) throw new Error('The configured Database access has expired. Ask your administrator to renew it. Offline project files remain available.')
    return connection
  }
  function summary(connection) {
    if (connection === null) return null
    const { token, ...metadata } = connection
    return metadata
  }
  return {
    status() { return summary(current()) },
    headers(urlValue, headers) {
      const connection = current()
      if (connection === null) return headers
      const url = new URL(urlValue)
      const base = new URL(connection.endpoint)
      const prefix = `${base.pathname.replace(/\/+$/, '')}/v1/`
      if (url.origin !== base.origin || !url.pathname.startsWith(prefix) || url.username || url.password) {
        throw new Error('This request is outside the configured Database API.')
      }
      return { ...headers, authorization: `Bearer ${connection.token}` }
    },
    async provision(value) {
      const license = requireLicense()
      const connection = validateConnection(value)
      if (connection.email !== license.email || Date.parse(connection.expiresAt) > Date.parse(license.expiresAt)
        || Date.parse(connection.expiresAt) <= now()) throw new Error('Database provisioning must match the active license email and validity period.')
      const response = await request(`${connection.endpoint}/v1/auth/me`, {
        headers: { authorization: `Bearer ${connection.token}`, accept: 'application/json' },
        redirect: 'manual', signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error('The configured API did not accept this account connection.')
      const session = await response.json()
      if (session?.user?.id !== connection.accountId || normalizeEmail(session?.user?.email) !== connection.email) {
        throw new Error('The Database account does not match this activation.')
      }
      write(connection)
      return summary(connection)
    },
  }
}

module.exports = { createDatabaseConnection, validateConnection }
