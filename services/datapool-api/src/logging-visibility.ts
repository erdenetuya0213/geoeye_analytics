import { createHash } from 'node:crypto'

export interface StructureVisibility {
  id: string
  source: string | null
  row_bbox_json: unknown
  stage3_rqd_json: unknown
}

/** Match Cloud API's stable UUID mapping for Field's detector-generated IDs. */
export function structureModelId(id: string): string {
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return id.toLowerCase()
  const bytes = createHash('sha1')
    .update(Buffer.from('cb1f735acdb94ad8972ff529c45dc2a7', 'hex'))
    .update(`logging_structures:${id}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 15) | 80
  bytes[8] = (bytes[8]! & 63) | 128
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function visibleStructure(row: StructureVisibility): boolean {
  if (row.source !== 'model') return true
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object'
    ? value as Record<string, unknown> : {}
  const sources = [object(row.row_bbox_json).dismissedStructureIds, object(row.stage3_rqd_json).dismissed_structure_ids]
  return !sources.some(ids => Array.isArray(ids) && ids.some(id => typeof id === 'string'
    && (id === row.id || structureModelId(id) === row.id.toLowerCase())))
}
