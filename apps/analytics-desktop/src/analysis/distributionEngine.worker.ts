import { calculateDistribution, type DistributionRequest } from './distributionEngine.js'

interface WorkerRequest {
  request: DistributionRequest
  requestId: string
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  try {
    const result = calculateDistribution(event.data.request)
    self.postMessage({ requestId: event.data.requestId, result })
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Distribution calculation failed',
      requestId: event.data.requestId,
    })
  }
})
