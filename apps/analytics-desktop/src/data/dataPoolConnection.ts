import { DataPoolClient } from '@geoeye/datapool-client'
import type { ConnectionSettings } from '../types.js'
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
