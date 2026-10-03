import { useEffect, useState } from 'react'
import type { DistributionRequest, DistributionResult } from './distributionEngine.js'

interface DistributionState {
  error: string | null
  pending: boolean
  request: DistributionRequest | null
  result: DistributionResult | null
}

export function useDistributionEngine(request: DistributionRequest | null): DistributionState {
  const [state, setState] = useState<DistributionState>({ error: null, pending: request !== null, request, result: null })

  useEffect(() => {
    if (request === null) {
      setState({ error: null, pending: false, request: null, result: null })
      return undefined
    }
    const worker = new Worker(new URL('./distributionEngine.worker.ts', import.meta.url), { type: 'module' })
    const requestId = crypto.randomUUID()
    setState({ error: null, pending: true, request, result: null })
    worker.addEventListener('message', (event: MessageEvent<{ error?: string; requestId: string; result?: DistributionResult }>) => {
      if (event.data.requestId !== requestId) return
      if (event.data.result !== undefined) setState({ error: null, pending: false, request, result: event.data.result })
      else setState({ error: event.data.error ?? 'Distribution calculation failed', pending: false, request, result: null })
      worker.terminate()
    })
    worker.postMessage({ request, requestId })
    return () => worker.terminate()
  }, [request])

  return state.request === request
    ? state
    : { error: null, pending: request !== null, request, result: null }
}
