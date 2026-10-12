import { calculatePointLoadIndex } from '../analysis/pointLoad.js'
import { createPointLoadRecord, type PointLoadRecord, type PointLoadRecordInput } from './pointLoadStore.js'
import type { SchmidtRecord } from './schmidtStore.js'

function validateInterval(holeId: string, from: number, to: number) {
  if (!holeId.trim()) throw new Error('Hole ID is required.')
  if (!Number.isFinite(from) || from < 0) throw new Error('From must be zero or greater.')
  if (!Number.isFinite(to) || to < from) throw new Error('To must be greater than or equal to From.')
}

export function editSchmidtRecord(record: SchmidtRecord, values: Pick<SchmidtRecord, 'holeId' | 'depthFromM' | 'depthToM' | 'reboundValue'>): SchmidtRecord {
  validateInterval(values.holeId, values.depthFromM, values.depthToM)
  if (!Number.isFinite(values.reboundValue) || values.reboundValue < 0) throw new Error('Smidth value must be zero or greater.')
  return { ...record, ...values, holeId: values.holeId.trim() }
}

export function editPointLoadRecord(record: PointLoadRecord, values: PointLoadRecordInput): PointLoadRecord {
  if (!record.sourceFile) return createPointLoadRecord(values, record.id, record.createdAt)
  validateInterval(values.holeId, values.depthFromM, values.depthToM)
  if (!values.sampleId.trim()) throw new Error('Sample ID is required.')
  const calculated = calculatePointLoadIndex(values.peakLoadKn, values.equivalentDiameterMm)
  const changed = values.peakLoadKn !== record.peakLoadKn || values.equivalentDiameterMm !== record.equivalentDiameterMm
  return { ...record, ...values, ...(changed ? calculated : {}), holeId: values.holeId.trim(), sampleId: values.sampleId.trim() }
}
