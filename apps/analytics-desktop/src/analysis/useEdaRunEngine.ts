import { useEffect, useState } from 'react'
import type { EdaRunRequest, EdaRunResult } from './edaRun.js'

interface EdaRunEngineState {
  error: string | null
  pending: boolean
  requestId: string | null
  result: EdaRunResult | null
}

export function useEdaRunEngine(request: EdaRunRequest | null): EdaRunEngineState {
  const [state, setState] = useState<EdaRunEngineState>({ error: null, pending: false, requestId: null, result: null })

  useEffect(() => {
    if (request === null) return undefined
    const worker = new Worker(new URL('./edaRun.worker.ts', import.meta.url), { type: 'module' })
    const requestId = request.runId
    setState({ error: null, pending: true, requestId, result: null })
    worker.addEventListener('message', (event: MessageEvent<{ error?: string; requestId: string; result?: EdaRunResult }>) => {
      if (event.data.requestId !== requestId) return
      if (event.data.result !== undefined) setState({ error: null, pending: false, requestId, result: event.data.result })
      else setState({ error: event.data.error ?? 'Statistics run failed', pending: false, requestId, result: null })
      worker.terminate()
    })
    worker.postMessage({ request, requestId })
    return () => worker.terminate()
  }, [request])

  return state.requestId === request?.runId || request === null
    ? state
    : { error: null, pending: request !== null, requestId: request?.runId ?? null, result: null }
}
