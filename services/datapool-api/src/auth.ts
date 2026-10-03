import { createHmac, timingSafeEqual } from 'node:crypto'
import type { OrganizationSummary, SessionUser } from '@geoeye/types'
import { randomBytes } from 'node:crypto'
import { argon2id, argon2Verify, bcryptVerify } from 'hash-wasm'

/**
 * Sign-in and authorization for the Data Pool API.
 *
 * Accounts, organizations (tenants) and project membership are shared GeoEye
 * data that Field already maintains. The Data Pool reads them, verifies the
 * password against the stored hash, and issues its own short-lived session
 * token. It never writes to those tables.
 */

export type ProjectPermission = 'read' | 'write'

/** The account row needed to verify a sign-in. */
export interface LoginAccount {
  id: string
  passwordHash: string
  isActive: boolean
  mustChangePassword: boolean
}

/** What one signed-in user may see and change. */
export interface UserAccess {
  user: SessionUser
  organizations: OrganizationSummary[]
  /** Platform administrators reach every project. */
  allProjects: boolean
  projects: ReadonlyMap<string, ProjectPermission>
}

export type Principal =
  /** No authentication configured: local development only. */
  | { kind: 'open' }
  /** The static service token, for release tooling and machine callers. */
  | { kind: 'service' }
  | { kind: 'user'; access: UserAccess }

const issuer = 'geoeye-datapool'

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url')
}

function sign(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest()
}

export function issueSessionToken(
  userId: string,
  secret: string,
  ttlSeconds: number,
  now: Date = new Date(),
): { token: string; expiresAt: Date } {
  const issuedAt = Math.floor(now.getTime() / 1000)
  const expiresAt = issuedAt + ttlSeconds
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify({ iss: issuer, sub: userId, iat: issuedAt, exp: expiresAt }))
  const signature = base64Url(sign(`${header}.${payload}`, secret))
  return { token: `${header}.${payload}.${signature}`, expiresAt: new Date(expiresAt * 1000) }
}

/** Returns the user id of a valid, unexpired session token, otherwise null. */
export function verifySessionToken(token: string, secret: string, now: Date = new Date()): string | null {
  const parts = token.split('.')
  const [header, payload, signature] = parts
  if (parts.length !== 3 || header === undefined || payload === undefined || signature === undefined) return null

  const expected = sign(`${header}.${payload}`, secret)
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null

  try {
    const head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: unknown }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      iss?: unknown
      sub?: unknown
      exp?: unknown
    }
    if (head.alg !== 'HS256' || claims.iss !== issuer) return null
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null
    if (claims.exp * 1000 <= now.getTime()) return null
    return claims.sub
  } catch {
    return null
  }
}

/** Verifies a password against the Argon2 or bcrypt hash GeoEye Field stores. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    if (storedHash.startsWith('$argon2')) return await argon2Verify({ password, hash: storedHash })
    if (/^\$2[aby]\$/.test(storedHash)) return await bcryptVerify({ password, hash: storedHash })
    return false
  } catch {
    return false
  }
}

// A hash with Field's Argon2 parameters to spend the same work on when the account
// does not exist, so response time does not reveal which emails are registered.
let decoyHash: Promise<string> | undefined

export async function spendDecoyVerification(password: string): Promise<void> {
  decoyHash ??= argon2id({
    password: randomBytes(24),
    salt: randomBytes(16),
    parallelism: 4,
    iterations: 3,
    memorySize: 65_536,
    hashLength: 32,
    outputType: 'encoded',
  })
  await verifyPassword(password, await decoyHash)
}

/** Slows down password guessing per account and per client address. */
export class LoginThrottle {
  readonly #attempts = new Map<string, { failures: number; resetAt: number }>()

  constructor(
    private readonly maximumFailures = 8,
    private readonly windowMs = 15 * 60_000,
  ) {}

  blocked(key: string, now = Date.now()): boolean {
    const entry = this.#attempts.get(key)
    if (entry === undefined) return false
    if (entry.resetAt <= now) {
      this.#attempts.delete(key)
      return false
    }
    return entry.failures >= this.maximumFailures
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.#attempts.get(key)
    if (entry === undefined || entry.resetAt <= now) {
      // Bound memory under a spray of distinct keys.
      if (this.#attempts.size > 10_000) this.#attempts.clear()
      this.#attempts.set(key, { failures: 1, resetAt: now + this.windowMs })
    } else {
      entry.failures += 1
    }
  }

  recordSuccess(key: string): void {
    this.#attempts.delete(key)
  }
}

export function permissionFor(principal: Principal, projectId: string): ProjectPermission | null {
  if (principal.kind !== 'user') return 'write'
  if (principal.access.allProjects) return 'write'
  return principal.access.projects.get(projectId) ?? null
}
