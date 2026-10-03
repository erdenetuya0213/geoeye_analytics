/// <reference lib="webworker" />
import { calculateMultivariateRun, type MultivariateRunRequest } from './multivariateEngine.js'

self.addEventListener('message', (event: MessageEvent<{ request: MultivariateRunRequest; requestId: string }>) => {
  try {
    self.postMessage({ requestId: event.data.requestId, result: calculateMultivariateRun(event.data.request) })
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Multivariate analysis failed',
      requestId: event.data.requestId,
    })
  }
})
