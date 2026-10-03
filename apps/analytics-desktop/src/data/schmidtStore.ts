export interface SchmidtRecord {
  createdAt: string
  depthFromM: number
  depthToM: number
  holeId: string
  id: string
  reboundValue: number
  sampleId: string
  sourceFile: string
  sourceRow: number
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const storageKey = 'geoeye.analytics.schmidt.v1'

function parseRecord(candidate: unknown): SchmidtRecord | null {
  if (typeof candidate !== 'object' || candidate === null) return null
  const value = candidate as Partial<SchmidtRecord>
  if (
    typeof value.createdAt !== 'string'
    || typeof value.depthFromM !== 'number'
    || !Number.isFinite(value.depthFromM)
    || value.depthFromM < 0
    || typeof value.depthToM !== 'number'
    || !Number.isFinite(value.depthToM)
    || value.depthToM < value.depthFromM
    || typeof value.holeId !== 'string'
    || value.holeId.trim().length === 0
    || typeof value.id !== 'string'
    || typeof value.reboundValue !== 'number'
    || !Number.isFinite(value.reboundValue)
    || value.reboundValue <= 0
    || typeof value.sampleId !== 'string'
    || typeof value.sourceFile !== 'string'
    || typeof value.sourceRow !== 'number'
  ) return null

  return value as SchmidtRecord
}

export function readSchmidtRecords(storage: StorageLike): SchmidtRecord[] {
  try {
    const raw = storage.getItem(storageKey)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(parseRecord).filter((record): record is SchmidtRecord => record !== null)
  } catch {
    return []
  }
}

export function writeSchmidtRecords(storage: StorageLike, records: readonly SchmidtRecord[]): boolean {
  try {
    storage.setItem(storageKey, JSON.stringify(records))
    return true
  } catch {
    return false
  }
}
