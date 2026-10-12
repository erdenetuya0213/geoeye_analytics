import { verify } from 'node:crypto'

const product = 'geoeye-analytics'

export interface VerifiedActivation {
  email: string
  expiresAt: Date
  licenseId: string
}

function normalizedEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 320) throw new Error('invalid activation')
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('invalid activation')
  return email
}

/** Server-side verification is intentionally independent of the desktop clock. */
export function verifyAnalyticsActivation(
  emailValue: unknown,
  keyValue: unknown,
  publicKey: string,
  now: Date = new Date(),
): VerifiedActivation {
  const email = normalizedEmail(emailValue)
  if (typeof keyValue !== 'string' || keyValue.length > 8_192) throw new Error('invalid activation')
  const key = keyValue.trim()
  const parts = key.split('.')
  if (parts.length !== 3 || parts[0] !== 'GEA1' || !/^[A-Za-z0-9_-]+$/.test(parts[1] ?? '')
    || !/^[A-Za-z0-9_-]+$/.test(parts[2] ?? '')) throw new Error('invalid activation')
  try {
    const payload = parts[1]!
    const signature = Buffer.from(parts[2]!, 'base64url')
    if (signature.length !== 64 || !verify(null, Buffer.from(`GEA1.${payload}`), publicKey, signature)) throw new Error()
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const claimEmail = normalizedEmail(claims.email)
    if (claims.v !== 1 || claims.product !== product || typeof claims.id !== 'string' || claims.id.length < 1
      || claimEmail !== email || !Number.isSafeInteger(claims.nbf) || !Number.isSafeInteger(claims.exp)) throw new Error()
    const notBefore = Number(claims.nbf) * 1_000
    const expires = Number(claims.exp) * 1_000
    if (notBefore < 0 || expires <= notBefore || now.getTime() < notBefore || now.getTime() >= expires) throw new Error()
    return { email, expiresAt: new Date(expires), licenseId: claims.id }
  } catch {
    throw new Error('invalid activation')
  }
}
