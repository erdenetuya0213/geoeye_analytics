/// <reference lib="webworker" />
import { calculateEdaRun, type EdaRunRequest } from './edaRun.js'

self.addEventListener('message', (event: MessageEvent<{ request: EdaRunRequest; requestId: string }>) => {
  try {
    self.postMessage({ requestId: event.data.requestId, result: calculateEdaRun(event.data.request) })
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Statistics run failed',
      requestId: event.data.requestId,
    })
  }
})
