import { buildLocalEdaDatasets } from './liveEda.js'
import type { LocalEdaBuildInput } from './localEdaWorker.js'

self.onmessage = (event: MessageEvent<LocalEdaBuildInput>) => {
  try { self.postMessage({ datasets: buildLocalEdaDatasets(...event.data) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Local dataset build failed' }) }
}
