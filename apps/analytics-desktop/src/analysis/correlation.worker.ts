import { computeCorrelationMatrix, type CorrelationRequest } from './correlationWorker.js'
self.onmessage = (event: MessageEvent<CorrelationRequest>) => {
  try { self.postMessage({ result: computeCorrelationMatrix(event.data) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
