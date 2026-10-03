import { useEffect, useState } from 'react'
import type { MultivariateRunRequest, MultivariateRunResult } from './multivariateEngine.js'

interface MultivariateEngineState {
  error: string | null
  pending: boolean
  requestId: string | null
  result: MultivariateRunResult | null
}

export function useMultivariateEngine(request: MultivariateRunRequest | null): MultivariateEngineState {
  const [state, setState] = useState<MultivariateEngineState>({ error: null, pending: false, requestId: null, result: null })

  useEffect(() => {
    if (request === null) return undefined
    const worker = new Worker(new URL('./multivariateEngine.worker.ts', import.meta.url), { type: 'module' })
    const requestId = request.runId
    setState({ error: null, pending: true, requestId, result: null })
    worker.addEventListener('message', (event: MessageEvent<{ error?: string; requestId: string; result?: MultivariateRunResult }>) => {
      if (event.data.requestId !== requestId) return
      if (event.data.result !== undefined) setState({ error: null, pending: false, requestId, result: event.data.result })
      else setState({ error: event.data.error ?? 'Multivariate analysis failed', pending: false, requestId, result: null })
      worker.terminate()
    })
    worker.postMessage({ request, requestId })
    return () => worker.terminate()
  }, [request])

  return state.requestId === request?.runId || request === null
    ? state
    : { error: null, pending: request !== null, requestId: request?.runId ?? null, result: null }
}
