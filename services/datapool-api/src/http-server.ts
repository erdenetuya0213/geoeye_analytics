import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { observationQuerySchema } from '@geoeye/types'
import { z, ZodError } from 'zod'
import {
  issueSessionToken,
  LoginThrottle,
  permissionFor,
  spendDecoyVerification,
  verifyPassword,
  verifySessionToken,
  type Principal,
  type ProjectPermission,
  type UserAccess,
} from './auth.js'
import { ApiError } from './errors.js'
import {
  analysisResultPackageBodySchema,
  analysisResultPackagesQuerySchema,
  collarBodySchema,
  createAnalysisRunSchema,
  derivedValuesBodySchema,
  loginBodySchema,
  optionalProjectIdQuerySchema,
  projectIdQuerySchema,
  projectionBindingsBodySchema,
  projectionRunBodySchema,
  surveysBodySchema,
  uuidPathParameterSchema,
} from './schemas.js'
import type { DataPoolStore } from './store.js'

// Survey replacements carry up to 20,000 stations; everything else is far smaller.
const maximumBodyBytes = 4_194_304

export interface AccessLogEntry {
  requestId: string
  method: string
  path: string
  status: number
  durationMs: number
}

export interface DataPoolServerOptions {
  store: DataPoolStore
  /** Static service token for release tooling and machine callers. */
  bearerToken?: string
  /** Enables sign-in with GeoEye accounts and signs the session tokens. */
  sessionSecret?: string
  sessionTtlSeconds?: number
  corsOrigins?: ReadonlySet<string>
  healthCheck?: () => Promise<void>
  logger?: Pick<Console, 'error'>
  /** Receives one entry per completed request. Never includes query strings or bodies. */
  accessLog?: (entry: AccessLogEntry) => void
}

function setResponseHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  const origin = request.headers.origin
  if (origin === undefined) return true
  // With a same-origin reverse proxy no CORS response headers are needed. The
  // browser will block cross-origin callers because preflights receive no grant.
  if (allowedOrigins.size === 0) return true
  if (!allowedOrigins.has(origin)) return false

  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  response.setHeader('Access-Control-Expose-Headers', 'X-Request-Id')
  response.setHeader('Access-Control-Max-Age', '600')
  response.setHeader('Vary', 'Origin')
  return true
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}

function tokensMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

const accessCacheMs = 30_000

function clientAddress(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for']
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  return first === undefined || first === '' ? request.socket.remoteAddress ?? 'unknown' : first
}

async function readJson(request: IncomingMessage, emptyValue?: unknown): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maximumBodyBytes) {
      throw new ApiError(413, 'payload_too_large', 'Request body exceeds 4 MiB')
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) {
    if (emptyValue !== undefined) return emptyValue
    throw new ApiError(400, 'invalid_json', 'A JSON request body is required')
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body is not valid JSON')
  }
}

function errorPayload(error: ApiError): Record<string, unknown> {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  }
}

function queryRecord(url: URL): Record<string, string> {
  return Object.fromEntries(url.searchParams.entries())
}

function postgresConstraintError(error: unknown): ApiError | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  if (code === '23503' || code === '23505' || code === '23514') {
    return new ApiError(409, 'constraint_violation', 'The request conflicts with stored Data Pool data')
  }
  return undefined
}

export function createDataPoolServer(options: DataPoolServerOptions): Server {
  const logger = options.logger ?? console
  const corsOrigins = options.corsOrigins ?? new Set<string>()
  const sessionTtlSeconds = options.sessionTtlSeconds ?? 43_200
  const throttle = new LoginThrottle()
  const accessCache = new Map<string, { access: UserAccess; expiresAt: number }>()

  // Membership is re-read at most every 30 s, so removing a user in Field takes
  // effect quickly without a database round trip on every request.
  async function userAccess(userId: string): Promise<UserAccess | null> {
    const cached = accessCache.get(userId)
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.access
    const access = await options.store.loadUserAccess(userId)
    if (access === null) {
      accessCache.delete(userId)
      return null
    }
    if (accessCache.size > 5_000) accessCache.clear()
    accessCache.set(userId, { access, expiresAt: Date.now() + accessCacheMs })
    return access
  }

  async function authenticate(request: IncomingMessage): Promise<Principal> {
    if (options.bearerToken === undefined && options.sessionSecret === undefined) return { kind: 'open' }
    const header = request.headers.authorization
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new ApiError(401, 'unauthorized', 'Sign in to use the Data Pool')
    }
    const token = header.slice('Bearer '.length)
    if (options.bearerToken !== undefined && tokensMatch(token, options.bearerToken)) return { kind: 'service' }
    if (options.sessionSecret !== undefined) {
      const userId = verifySessionToken(token, options.sessionSecret)
      const access = userId === null ? null : await userAccess(userId)
      if (access !== null) return { kind: 'user', access }
    }
    throw new ApiError(401, 'unauthorized', 'The session is invalid or has expired')
  }

  // A project the caller cannot reach is reported as missing, never as forbidden,
  // so project ids of other tenants cannot be probed.
  function requireProject(principal: Principal, projectId: string, needed: ProjectPermission): void {
    const permission = permissionFor(principal, projectId)
    if (permission === null) throw new ApiError(404, 'not_found', `Project ${projectId} was not found`)
    if (needed === 'write' && permission !== 'write') {
      throw new ApiError(403, 'read_only', 'Your role on this project is read-only')
    }
  }

  function requireGlobalAdministration(principal: Principal): void {
    if (principal.kind === 'user' && !principal.access.allProjects) {
      throw new ApiError(403, 'forbidden', 'Only a platform administrator can change settings shared by every project')
    }
  }

  async function requireRun(principal: Principal, runId: string): Promise<void> {
    if (principal.kind !== 'user') return
    const projectId = await options.store.getAnalysisRunProjectId(runId)
    if (projectId === null) throw new ApiError(404, 'not_found', `Analysis run ${runId} was not found`)
    requireProject(principal, projectId, 'write')
  }

  function actorId(principal: Principal): string | null {
    return principal.kind === 'user' ? principal.access.user.id : null
  }

  return createServer(async (request, response) => {
    const startedAt = performance.now()
    const requestId = randomUUID()
    const method = request.method ?? 'GET'
    let path = '/'
    if (options.accessLog !== undefined) {
      const accessLog = options.accessLog
      response.once('finish', () => accessLog({
        requestId,
        method,
        path,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      }))
    }
    try {
      setResponseHeaders(response)
      response.setHeader('X-Request-Id', requestId)
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
      path = url.pathname

      if (!applyCors(request, response, corsOrigins)) {
        throw new ApiError(403, 'origin_not_allowed', 'The request origin is not allowed')
      }

      if (method === 'OPTIONS') {
        response.writeHead(204)
        response.end()
        return
      }

      if (method === 'GET' && url.pathname === '/live') {
        sendJson(response, 200, { status: 'ok' })
        return
      }

      if (method === 'GET' && url.pathname === '/health') {
        try {
          await options.healthCheck?.()
          sendJson(response, 200, { status: 'ok' })
        } catch (error) {
          logger.error(error)
          sendJson(response, 503, { status: 'unavailable' })
        }
        return
      }

      if (method === 'POST' && url.pathname === '/v1/auth/login') {
        if (options.sessionSecret === undefined) {
          throw new ApiError(404, 'sign_in_unavailable', 'This Data Pool is not configured for user sign-in')
        }
        const { email, password } = loginBodySchema.parse(await readJson(request))
        const keys = [`email:${email}`, `address:${clientAddress(request)}`]
        if (keys.some((key) => throttle.blocked(key))) {
          throw new ApiError(429, 'too_many_attempts', 'Too many sign-in attempts. Try again in 15 minutes.')
        }
        const account = await options.store.findLoginAccount(email)
        let verified = false
        if (account === null) await spendDecoyVerification(password)
        else verified = await verifyPassword(password, account.passwordHash)
        if (account === null || !verified || !account.isActive) {
          for (const key of keys) throttle.recordFailure(key)
          throw new ApiError(401, 'invalid_credentials', 'The email or password is incorrect')
        }
        if (account.mustChangePassword) {
          throw new ApiError(403, 'password_change_required', 'Set a new password in GeoEye Field, then sign in here')
        }
        const access = await options.store.loadUserAccess(account.id)
        if (access === null) throw new ApiError(401, 'invalid_credentials', 'The email or password is incorrect')
        for (const key of keys) throttle.recordSuccess(key)
        accessCache.set(account.id, { access, expiresAt: Date.now() + accessCacheMs })
        const session = issueSessionToken(account.id, options.sessionSecret, sessionTtlSeconds)
        sendJson(response, 200, {
          accessToken: session.token,
          tokenType: 'bearer',
          expiresAt: session.expiresAt.toISOString(),
          user: access.user,
          organizations: access.organizations,
        })
        return
      }

      const principal = await authenticate(request)

      if (method === 'GET' && url.pathname === '/v1/auth/me') {
        if (principal.kind !== 'user') {
          throw new ApiError(404, 'not_found', 'This credential is not a user session')
        }
        sendJson(response, 200, { user: principal.access.user, organizations: principal.access.organizations })
        return
      }

      if (method === 'GET' && url.pathname === '/v1/variables') {
        sendJson(response, 200, await options.store.listVariables())
        return
      }

      if (method === 'GET' && url.pathname === '/v1/projects') {
        const projects = await options.store.listProjects()
        sendJson(response, 200, projects.filter((project) => project.isActive).flatMap((project) => {
          const permission = permissionFor(principal, project.id)
          return permission === null ? [] : [{ ...project, canWrite: permission === 'write' }]
        }))
        return
      }

      const drillholesMatch = /^\/v1\/projects\/([^/]+)\/drillholes$/.exec(url.pathname)
      if (method === 'GET' && drillholesMatch !== null) {
        const projectId = uuidPathParameterSchema.parse(drillholesMatch[1])
        requireProject(principal, projectId, 'read')
        sendJson(response, 200, await options.store.listDrillholes(projectId))
        return
      }

      const loggingMatch = /^\/v1\/projects\/([^/]+)\/logging$/.exec(url.pathname)
      if (method === 'GET' && loggingMatch !== null) {
        const projectId = uuidPathParameterSchema.parse(loggingMatch[1])
        requireProject(principal, projectId, 'read')
        sendJson(response, 200, await options.store.listFieldLogging(projectId))
        return
      }

      const collarMatch = /^\/v1\/projects\/([^/]+)\/drillholes\/([^/]+)\/collar$/.exec(url.pathname)
      if (method === 'PUT' && collarMatch !== null) {
        const projectId = uuidPathParameterSchema.parse(collarMatch[1])
        const holeId = uuidPathParameterSchema.parse(collarMatch[2])
        requireProject(principal, projectId, 'write')
        const input = collarBodySchema.parse(await readJson(request))
        sendJson(response, 200, await options.store.saveCollar(projectId, holeId, input))
        return
      }

      const surveysMatch = /^\/v1\/projects\/([^/]+)\/drillholes\/([^/]+)\/surveys$/.exec(url.pathname)
      if (surveysMatch !== null && (method === 'GET' || method === 'PUT')) {
        const projectId = uuidPathParameterSchema.parse(surveysMatch[1])
        const holeId = uuidPathParameterSchema.parse(surveysMatch[2])
        requireProject(principal, projectId, method === 'GET' ? 'read' : 'write')
        if (method === 'GET') {
          sendJson(response, 200, await options.store.listSurveys(projectId, holeId))
          return
        }
        const input = surveysBodySchema.parse(await readJson(request))
        sendJson(response, 200, await options.store.replaceSurveys(projectId, holeId, input))
        return
      }

      const projectionMatch = /^\/v1\/projects\/([^/]+)\/projection$/.exec(url.pathname)
      if (projectionMatch !== null && (method === 'GET' || method === 'POST')) {
        const projectId = uuidPathParameterSchema.parse(projectionMatch[1])
        requireProject(principal, projectId, method === 'GET' ? 'read' : 'write')
        if (method === 'GET') {
          sendJson(response, 200, await options.store.listProjectionStatus(projectId))
          return
        }
        const { force } = projectionRunBodySchema.parse(await readJson(request, {}))
        sendJson(response, 200, await options.store.runProjection(projectId, force))
        return
      }

      if (url.pathname === '/v1/projection-bindings' && method === 'GET') {
        const { projectId } = optionalProjectIdQuerySchema.parse(queryRecord(url))
        if (projectId !== undefined) requireProject(principal, projectId, 'read')
        sendJson(response, 200, await options.store.listProjectionBindings(projectId ?? null))
        return
      }

      if (url.pathname === '/v1/projection-bindings' && method === 'PUT') {
        const { bindings } = projectionBindingsBodySchema.parse(await readJson(request))
        for (const binding of bindings) {
          if (binding.projectId === null) requireGlobalAdministration(principal)
          else requireProject(principal, binding.projectId, 'write')
        }
        sendJson(response, 200, await options.store.saveProjectionBindings(bindings))
        return
      }

      if (method === 'GET' && url.pathname === '/v1/datasets') {
        const { projectId } = projectIdQuerySchema.parse(queryRecord(url))
        requireProject(principal, projectId, 'read')
        sendJson(response, 200, await options.store.listDatasets(projectId))
        return
      }

      if (method === 'POST' && url.pathname === '/v1/observations/query') {
        const input = observationQuerySchema.parse(await readJson(request))
        requireProject(principal, input.projectId, 'read')
        sendJson(response, 200, await options.store.queryObservations(input))
        return
      }

      if (method === 'POST' && url.pathname === '/v1/analysis-runs') {
        const input = createAnalysisRunSchema.parse(await readJson(request))
        requireProject(principal, input.projectId, 'write')
        sendJson(response, 201, await options.store.createAnalysisRun(input, actorId(principal)))
        return
      }

      if (method === 'POST' && url.pathname === '/v1/analysis-result-packages') {
        const input = analysisResultPackageBodySchema.parse(await readJson(request))
        requireProject(principal, input.projectId, 'write')
        sendJson(response, 201, await options.store.saveAnalysisResultPackage(input, actorId(principal)))
        return
      }

      if (method === 'GET' && url.pathname === '/v1/analysis-result-packages') {
        const query = analysisResultPackagesQuerySchema.parse(queryRecord(url))
        requireProject(principal, query.projectId, 'read')
        sendJson(response, 200, await options.store.listAnalysisResultPackages(query))
        return
      }

      const derivedMatch = /^\/v1\/analysis-runs\/([^/]+)\/derived-values$/.exec(url.pathname)
      if (method === 'POST' && derivedMatch !== null) {
        const runId = uuidPathParameterSchema.parse(derivedMatch[1])
        await requireRun(principal, runId)
        const { values } = derivedValuesBodySchema.parse(await readJson(request))
        sendJson(response, 201, { ids: await options.store.saveDerivedValues(runId, values) })
        return
      }

      const acceptMatch = /^\/v1\/analysis-runs\/([^/]+)\/accept$/.exec(url.pathname)
      if (method === 'POST' && acceptMatch !== null) {
        const runId = uuidPathParameterSchema.parse(acceptMatch[1])
        await requireRun(principal, runId)
        sendJson(response, 200, await options.store.acceptAnalysisRun(runId, actorId(principal)))
        return
      }

      throw new ApiError(404, 'not_found', 'Route not found')
    } catch (error) {
      if (error instanceof ZodError) {
        sendJson(response, 400, errorPayload(new ApiError(400, 'validation_error', 'Request validation failed', error.flatten())))
        return
      }
      if (error instanceof ApiError) {
        sendJson(response, error.status, errorPayload(error))
        return
      }
      const constraintError = postgresConstraintError(error)
      if (constraintError !== undefined) {
        sendJson(response, constraintError.status, errorPayload(constraintError))
        return
      }
      logger.error(error)
      sendJson(response, 500, errorPayload(new ApiError(500, 'internal_error', 'Internal server error')))
    }
  })
}
