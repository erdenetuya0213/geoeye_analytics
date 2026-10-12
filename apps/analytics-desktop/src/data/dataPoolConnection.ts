import { DataPoolClient, DataPoolError } from '@geoeye/datapool-client'
import type { ConnectionSettings, ConnectionState } from '../types.js'
import { dataPoolFetch } from '../desktop/dataPoolFetch.js'

export function createDataPoolClient(
  settings: ConnectionSettings,
  signal?: AbortSignal,
): DataPoolClient {
  return new DataPoolClient({
    endpoint: settings.endpoint,
    accessToken: () => settings.token || undefined,
    fetch: (input, init) => dataPoolFetch(input, signal === undefined ? init : { ...init, signal }),
  })
}

export async function checkDataPoolConnection(settings: ConnectionSettings): Promise<number> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 5_000)
  try {
    const variables = await createDataPoolClient(settings, controller.signal).variables()
    return variables.length
  } finally {
    window.clearTimeout(timeout)
  }
}

/** Authentication and authorization failures need user/admin action; network
 * and startup failures are safe to retry because connection checks are reads. */
export function shouldRetryDataPoolConnection(error: unknown): boolean {
  return !(error instanceof DataPoolError && (error.status === 401 || error.status === 403))
}

export function dataPoolReconnectDelay(attempt: number): number {
  return [1_000, 3_000, 10_000, 30_000][Math.min(Math.max(0, attempt), 3)]!
}

/** Background checks must not close an already connected local workspace. */
export function connectionStateWhileChecking(current: ConnectionState): ConnectionState {
  return current === 'connected' ? current : 'checking'
}

export function restoreManagedConnection(current: ConnectionSettings, configuration: { endpoint: string; accountId: string }): ConnectionSettings {
  if (current.managed === true && current.endpoint === configuration.endpoint && current.accountId === configuration.accountId && current.token === '') return current
  return { version: 1, endpoint: configuration.endpoint, accountId: configuration.accountId, managed: true, token: '' }
}

/** An explicit refresh may connect while the workspace continues using local files. */
export async function clientForLocalRefresh(settings: ConnectionSettings, connect?: () => Promise<{ endpoint: string; accountId: string } | null>): Promise<DataPoolClient> {
  if (connect === undefined) {
    if (!settings.token && !settings.managed) throw new Error('Connect to the Database before refreshing the local copy.')
    return createDataPoolClient(settings)
  }
  const configuration = await connect()
  if (configuration === null) throw new Error('Database access has not been configured. Open Connection to configure it.')
  const normalize = (endpoint: string) => endpoint.replace(/\/+$/, '').toLowerCase()
  if (normalize(configuration.endpoint) !== normalize(settings.endpoint) || configuration.accountId !== settings.accountId) {
    throw new Error('The Database account or server changed. Open Connection before refreshing this project.')
  }
  return createDataPoolClient(restoreManagedConnection(settings, configuration))
}
