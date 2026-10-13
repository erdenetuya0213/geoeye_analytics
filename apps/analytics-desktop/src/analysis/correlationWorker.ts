import { analyzeCorrelationMatrix, type CorrelationVariableInput, type CorrelationAnalysisResult } from './chartResults.js'
import type { EdaObservation } from './eda.js'
import { matchesFieldFilters, type FieldFilters } from './fieldFilter.js'
export interface CorrelationRequest {
  variables: CorrelationVariableInput[]
  method: 'pearson' | 'spearman'
  activeFilterKeys: string[]
  filterValues: FieldFilters
}
export function computeCorrelationMatrix(input: CorrelationRequest) {
  const filtered = new Map<readonly EdaObservation[], EdaObservation[]>()
  return analyzeCorrelationMatrix(input.variables.map(variable => {
    let observations = filtered.get(variable.observations)
    if (!observations) {
      observations = variable.observations.filter(observation => matchesFieldFilters(observation, input.activeFilterKeys, input.filterValues))
      filtered.set(variable.observations, observations)
    }
    return { ...variable, observations }
  }), input.method)
}
export async function prepareCorrelationMatrix(input: CorrelationRequest, signal?: AbortSignal): Promise<CorrelationAnalysisResult> {
  if (signal?.aborted) throw new DOMException('Correlation canceled', 'AbortError')
  if (typeof Worker === 'undefined') return computeCorrelationMatrix(input)
  const worker = new Worker(new URL('./correlation.worker.ts', import.meta.url), { type: 'module' })
  let abort: (() => void) | undefined
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(new DOMException('Correlation canceled', 'AbortError'))
      signal?.addEventListener('abort', abort, { once: true })
      worker.onmessage = event => event.data.error === undefined ? resolve(event.data.result) : reject(new Error(event.data.error))
      worker.onerror = event => reject(new Error(event.message || 'Correlation failed'))
      worker.postMessage(input)
    })
  } finally { if (abort) signal?.removeEventListener('abort', abort); worker.terminate() }
}
