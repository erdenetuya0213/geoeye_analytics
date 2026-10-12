import { computeCompositePreview, type CompositePreviewInput } from './compositePreview.js'
self.onmessage = (event: MessageEvent<CompositePreviewInput>) => {
  try { self.postMessage({ result: computeCompositePreview(event.data) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Composite preview failed' }) }
}
