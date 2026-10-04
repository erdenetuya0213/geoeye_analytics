import { calculatePointLoadIndex, type PointLoadTestType } from '../analysis/pointLoad.js'

export interface PointLoadRecordInput {
  depthFromM: number
  depthToM: number
  equivalentDiameterMm: number
  holeId: string
  labName: string
  peakLoadKn: number
  sampleId: string
  testedAt: string
  testType: PointLoadTestType
  validBreak: boolean
}

export interface PointLoadRecord extends PointLoadRecordInput {
  correctionFactor: number
  createdAt: string
  id: string
  is50Mpa: number
  isMpa: number
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const storageKey = 'geoeye.analytics.point-load.v1'
const testTypes: readonly PointLoadTestType[] = ['diametral', 'axial', 'block-irregular']

function isTestType(value: unknown): value is PointLoadTestType {
  return typeof value === 'string' && testTypes.includes(value as PointLoadTestType)
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${label} is required.`)
  return trimmed
}

export function createPointLoadRecord(
  input: PointLoadRecordInput,
  id: string,
  createdAt = new Date().toISOString(),
): PointLoadRecord {
  const sampleId = requireText(input.sampleId, 'Sample ID')
  const holeId = requireText(input.holeId, 'Hole ID')
  const labName = requireText(input.labName, 'Laboratory')
  if (!Number.isFinite(input.depthFromM) || input.depthFromM < 0) throw new Error('From depth must be zero or greater.')
  if (!Number.isFinite(input.depthToM) || input.depthToM < input.depthFromM) throw new Error('To depth must be greater than or equal to from depth.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.testedAt)) throw new Error('Test date is required.')
  if (!isTestType(input.testType)) throw new Error('Select a supported test type.')

  const result = calculatePointLoadIndex(input.peakLoadKn, input.equivalentDiameterMm)
  return {
    ...input,
    ...result,
    createdAt,
    holeId,
    id,
    labName,
    sampleId,
  }
}

function parseRecord(candidate: unknown): PointLoadRecord | null {
  if (typeof candidate !== 'object' || candidate === null) return null
  const value = candidate as Partial<PointLoadRecord>
  if (
    typeof value.id !== 'string'
    || typeof value.createdAt !== 'string'
    || typeof value.sampleId !== 'string'
    || typeof value.holeId !== 'string'
    || typeof value.labName !== 'string'
    || typeof value.testedAt !== 'string'
    || !isTestType(value.testType)
    || typeof value.depthFromM !== 'number'
    || typeof value.depthToM !== 'number'
    || typeof value.peakLoadKn !== 'number'
    || typeof value.equivalentDiameterMm !== 'number'
    || typeof value.validBreak !== 'boolean'
  ) return null

  try {
    return createPointLoadRecord({
      depthFromM: value.depthFromM,
      depthToM: value.depthToM,
      equivalentDiameterMm: value.equivalentDiameterMm,
      holeId: value.holeId,
      labName: value.labName,
      peakLoadKn: value.peakLoadKn,
      sampleId: value.sampleId,
      testedAt: value.testedAt,
      testType: value.testType,
      validBreak: value.validBreak,
    }, value.id, value.createdAt)
  } catch {
    return null
  }
}

export function readPointLoadRecords(storage: StorageLike): PointLoadRecord[] {
  try {
    const raw = storage.getItem(storageKey)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(parseRecord).filter((record): record is PointLoadRecord => record !== null)
  } catch {
    return []
  }
}

export function writePointLoadRecords(storage: StorageLike, records: readonly PointLoadRecord[]): boolean {
  try {
    storage.setItem(storageKey, JSON.stringify(records))
    return true
  } catch {
    return false
  }
}
