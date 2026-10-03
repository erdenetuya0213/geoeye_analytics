import { DataPoolClient } from '@geoeye/datapool-client'
import type { ConnectionSettings } from '../types.js'

export function createDataPoolClient(
  settings: ConnectionSettings,
  signal?: AbortSignal,
): DataPoolClient {
  return new DataPoolClient({
    endpoint: settings.endpoint,
    accessToken: () => settings.token || undefined,
    ...(signal === undefined ? {} : {
      fetch: (input, init) => globalThis.fetch(input, { ...init, signal }),
    }),
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
