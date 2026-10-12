import type { buildLocalEdaDatasets } from './liveEda.js'
import type { EdaDataset } from './edaTypes.js'

export type LocalEdaBuildInput = Parameters<typeof buildLocalEdaDatasets>

/** One worker per snapshot build; React Query shares the result between pages. */
export async function buildLocalEdaInWorker(input: LocalEdaBuildInput, signal?: AbortSignal): Promise<EdaDataset[]> {
  if (typeof Worker === 'undefined') return (await import('./liveEda.js')).buildLocalEdaDatasets(...input)
  if (signal?.aborted) throw new DOMException('Local dataset build canceled', 'AbortError')
  const worker = new Worker(new URL('./localEda.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<EdaDataset[]>((resolve, reject) => {
      const abort = () => reject(new DOMException('Local dataset build canceled', 'AbortError'))
      signal?.addEventListener('abort', abort, { once: true })
      const finish = (action: () => void) => { signal?.removeEventListener('abort', abort); action() }
      worker.onmessage = event => finish(() => event.data.error === undefined ? resolve(event.data.datasets) : reject(new Error(event.data.error)))
      worker.onerror = event => finish(() => reject(new Error(event.message || 'Local dataset build failed')))
      worker.postMessage(input)
    })
  } finally { worker.terminate() }
}
