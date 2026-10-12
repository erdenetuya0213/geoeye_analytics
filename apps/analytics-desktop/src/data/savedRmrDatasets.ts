import type { LocalTabularDraft } from './localProjectDb.js'
import type { StorageLike } from './geotechnicalDerivedStore.js'

export interface SavedRmrDataset { id: string; name: string; draft: LocalTabularDraft }
const key = 'geoeye.analytics.saved-rmr-datasets.v1'
export function readSavedRmrDatasets(storage: StorageLike): SavedRmrDataset[] {
  try { const value: unknown = JSON.parse(storage.getItem(key) ?? '[]'); return Array.isArray(value) ? value.filter(item => item?.id && item?.name && Array.isArray(item?.draft?.rows)) : [] } catch { return [] }
}
export function saveRmrDataset(storage: StorageLike, value: SavedRmrDataset) {
  storage.setItem(key, JSON.stringify([value, ...readSavedRmrDatasets(storage).filter(item => item.id !== value.id)]))
}
