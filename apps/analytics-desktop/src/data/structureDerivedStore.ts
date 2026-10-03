import type { StorageLike } from './geotechnicalDerivedStore.js'

export const STRUCTURE_DERIVED_STORAGE_KEY = 'geoeye.analytics.structure-derived.v1'

export interface StructureDerivedRow {
  datasetId: string
  jointSet: string
  observationId: string
  runId: string
  sourceObservationIds: string[]
}

export interface SavedStructureRun {
  datasetId: string
  holeFilter: string
  rowCount: number
  runId: string
  savedAt: string
  templateId: string
  templateVersion: number
}

export interface StructureDerivedDocument {
  field: {
    dataType: 'category'
    key: 'structure.joint_set'
    name: 'Joint set'
    origin: 'derived'
  }
  rows: StructureDerivedRow[]
  runs: SavedStructureRun[]
  version: 1
}

const emptyDocument: StructureDerivedDocument = {
  field: { dataType: 'category', key: 'structure.joint_set', name: 'Joint set', origin: 'derived' },
  rows: [],
  runs: [],
  version: 1,
}

export function readStructureDerivedDocument(storage?: StorageLike): StructureDerivedDocument {
  if (storage === undefined) return emptyDocument
  try {
    const parsed = JSON.parse(storage.getItem(STRUCTURE_DERIVED_STORAGE_KEY) ?? 'null') as Partial<StructureDerivedDocument> | null
    if (parsed?.version !== 1 || !Array.isArray(parsed.rows) || !Array.isArray(parsed.runs)) return emptyDocument
    return { ...emptyDocument, rows: parsed.rows, runs: parsed.runs }
  } catch {
    return emptyDocument
  }
}

export function saveStructureDerivedValues(
  storage: StorageLike,
  input: {
    datasetId: string
    holeFilter: string
    rows: ReadonlyArray<{ jointSet: string; observationId: string }>
    templateId: string
    templateVersion: number
  },
  savedAt = new Date().toISOString(),
): StructureDerivedDocument {
  const current = readStructureDerivedDocument(storage)
  const runId = `structure-${input.templateId}-v${input.templateVersion}-${Date.parse(savedAt)}`
  const replacedIds = new Set(input.rows.map((row) => `${input.datasetId}:${row.observationId}`))
  const rows: StructureDerivedRow[] = [
    ...current.rows.filter((row) => !replacedIds.has(`${row.datasetId}:${row.observationId}`)),
    ...input.rows.map((row) => ({
      datasetId: input.datasetId,
      jointSet: row.jointSet,
      observationId: row.observationId,
      runId,
      sourceObservationIds: [row.observationId],
    })),
  ]
  const run: SavedStructureRun = {
    datasetId: input.datasetId,
    holeFilter: input.holeFilter,
    rowCount: input.rows.length,
    runId,
    savedAt,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
  }
  const next: StructureDerivedDocument = {
    ...emptyDocument,
    rows,
    runs: [run, ...current.runs.filter((candidate) => candidate.runId !== runId)].slice(0, 30),
  }
  storage.setItem(STRUCTURE_DERIVED_STORAGE_KEY, JSON.stringify(next))
  return next
}
