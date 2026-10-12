import type { ExcavationType } from '../analysis/geotechnical.js'
import type { Rmr76CanonicalInputKey } from '../analysis/geotechnicalWorkflow.js'
import type { DatabaseRmrSource, Rmr76ParameterSourceMapping } from './geotechnicalDatabase.js'
import { buildCompositeRmrDataset, type CompositeRules, type CompositeRmrDataset } from './geotechnicalComposite.js'

export interface CompositePreviewInput {
  sources: readonly DatabaseRmrSource[]
  mapping: Rmr76ParameterSourceMapping
  excavation: ExcavationType
  rules: CompositeRules
  meanFills: Partial<Record<Rmr76CanonicalInputKey, boolean>>
  holeId: string
  depthRange: 'all' | 'shallow' | 'deep'
}

export function computeCompositePreview(input: CompositePreviewInput) {
  return buildCompositeRmrDataset(input.sources, input.mapping, input.excavation, input.rules, input.meanFills, (record, source) => {
    if (input.holeId !== 'all' && (source.holeNames.get(record.holeId ?? '') ?? record.holeId) !== input.holeId) return false
    if (input.depthRange === 'shallow') return record.depthFrom !== null && record.depthFrom < 60
    if (input.depthRange === 'deep') return record.depthTo !== null && record.depthTo > 60
    return true
  })
}

export async function prepareCompositePreview(input: CompositePreviewInput, signal?: AbortSignal): Promise<CompositeRmrDataset> {
  if (typeof Worker === 'undefined') return computeCompositePreview(input)
  if (signal?.aborted) throw new DOMException('Composite preview canceled', 'AbortError')
  const worker = new Worker(new URL('./compositePreview.worker.ts', import.meta.url), { type: 'module' })
  let abort: (() => void) | undefined
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(new DOMException('Composite preview canceled', 'AbortError'))
      signal?.addEventListener('abort', abort, { once: true })
      worker.onmessage = event => event.data.error === undefined ? resolve(event.data.result) : reject(new Error(event.data.error))
      worker.onerror = event => reject(new Error(event.message || 'Composite preview failed'))
      worker.postMessage(input)
    })
  } finally { if (abort) signal?.removeEventListener('abort', abort); worker.terminate() }
}
