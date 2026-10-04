import { DataPoolClient, DataPoolError } from '@geoeye/datapool-client'
import { dataPoolFetch } from '../desktop/dataPoolFetch.js'

type LoginSession = Awaited<ReturnType<DataPoolClient['login']>>

export interface DataPoolLoginResult {
  endpoint: string
  session: LoginSession
}

export function dataPoolEndpointCandidates(value: string): string[] {
  const normalized = value.trim().replace(/\/+$/, '')
  if (normalized === '') return []
  const url = new URL(normalized)
  if (url.pathname !== '' && url.pathname !== '/') return [normalized]
  return [normalized, `${url.origin}/api`]
}

/** Try the entered server as a direct API and as the standard /api deployment. */
export async function loginToDataPool(endpoint: string, email: string, password: string): Promise<DataPoolLoginResult> {
  const candidates = dataPoolEndpointCandidates(endpoint)
  let lastFailure: unknown = new Error('No Database address was provided')
  for (const [index, candidate] of candidates.entries()) {
    try {
      const session = await new DataPoolClient({ endpoint: candidate, fetch: dataPoolFetch }).login({ email, password })
      return { endpoint: candidate, session }
    } catch (failure) {
      lastFailure = failure
      const isLast = index === candidates.length - 1
      const definitiveAccountFailure = failure instanceof DataPoolError && [401, 403, 429].includes(failure.status)
      if (isLast || definitiveAccountFailure) throw failure
    }
  }
  throw lastFailure
}
