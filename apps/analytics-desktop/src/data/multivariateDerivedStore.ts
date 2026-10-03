import type { MultivariateRunResult } from '../analysis/multivariateEngine.js'
import type { StorageLike } from './geotechnicalDerivedStore.js'

export interface MultivariateDerivedField {
  dataType: 'numeric' | 'category'
  datasetId: string
  key: string
  method: 'PCA' | 'k-means'
  name: string
  origin: 'derived'
  runId: string
  runNumber: number
  templateId: string
  templateVersion: number
  version: string
}

export interface MultivariateDerivedRow {
  depthFrom?: number
  depthTo?: number
  datasetId: string
  holeId?: string
  observationId: string
  runId: string
  sourceDatasetIds?: string[]
  sourceObservationIds: string[]
  templateId: string
  templateVersion: number
  values: Record<string, number>
}

export interface SavedMultivariateRun {
  algorithmVersion: string
  datasetId: string
  fields: MultivariateDerivedField[]
  missingPolicy: string
  runId: string
  runNumber: number
  savedAt: string
  scaling: string
  snapshotAt: string
  sourceObservationCount: number
  templateId: string
  templateVersion: number
  variableKeys: string[]
}

export interface MultivariateDerivedDocument {
  fields: MultivariateDerivedField[]
  rows: MultivariateDerivedRow[]
  runs: SavedMultivariateRun[]
  version: 1
}

export const MULTIVARIATE_DERIVED_STORAGE_KEY = 'geoeye.analytics.multivariate-derived.v1'
const emptyDocument: MultivariateDerivedDocument = { fields: [], rows: [], runs: [], version: 1 }

export function readMultivariateDerivedDocument(storage?: StorageLike): MultivariateDerivedDocument {
  if (storage === undefined) return emptyDocument
  try {
    const parsed = JSON.parse(storage.getItem(MULTIVARIATE_DERIVED_STORAGE_KEY) ?? 'null') as Partial<MultivariateDerivedDocument> | null
    if (parsed?.version !== 1 || !Array.isArray(parsed.fields) || !Array.isArray(parsed.rows) || !Array.isArray(parsed.runs)) return emptyDocument
    return {
      fields: parsed.fields.map((field) => ({
        ...field,
        templateId: typeof field.templateId === 'string' ? field.templateId : field.datasetId,
        templateVersion: typeof field.templateVersion === 'number' ? field.templateVersion : 1,
      })),
      rows: parsed.rows.map((row) => ({
        ...row,
        templateId: typeof row.templateId === 'string' ? row.templateId : row.datasetId,
        templateVersion: typeof row.templateVersion === 'number' ? row.templateVersion : 1,
      })),
      runs: parsed.runs.map((run) => ({
        ...run,
        templateId: typeof run.templateId === 'string' ? run.templateId : run.datasetId,
        templateVersion: typeof run.templateVersion === 'number' ? run.templateVersion : 1,
      })),
      version: 1,
    }
  } catch {
    return emptyDocument
  }
}

export function saveMultivariateDerivedVariables(
  storage: StorageLike,
  result: MultivariateRunResult,
  options: { clusterMetrics?: boolean; clusters: boolean; pcaComponents?: readonly number[]; pcaScores?: boolean; templateId?: string; templateVersion?: number },
  savedAt = new Date().toISOString(),
): MultivariateDerivedDocument {
  const pcaComponents = options.pcaComponents ?? (options.pcaScores ? result.pca.explainedVarianceRatio.map((_, index) => index) : [])
  if (!options.clusters && pcaComponents.length === 0 && !options.clusterMetrics) return readMultivariateDerivedDocument(storage)
  const templateId = options.templateId ?? result.configuration.datasetId
  const templateVersion = options.templateVersion ?? 1
  const fields: MultivariateDerivedField[] = []
  if (pcaComponents.length > 0) {
    pcaComponents.forEach((index) => fields.push({
      dataType: 'numeric', datasetId: result.configuration.datasetId, key: `multivariate.pc${index + 1}`,
      method: 'PCA', name: `PCA component ${index + 1}`, origin: 'derived', runId: result.runId,
      runNumber: result.runNumber, templateId, templateVersion, version: result.provenance.algorithmVersion,
    }))
  }
  if (options.clusters) fields.push({
    dataType: 'category', datasetId: result.configuration.datasetId, key: 'multivariate.cluster_id',
    method: 'k-means', name: 'Multivariate cluster ID', origin: 'derived', runId: result.runId,
    runNumber: result.runNumber, templateId, templateVersion, version: result.provenance.algorithmVersion,
  })
  if (options.clusterMetrics) {
    fields.push({
      dataType: 'numeric', datasetId: result.configuration.datasetId, key: 'multivariate.cluster_distance',
      method: 'k-means', name: 'Distance to cluster centroid', origin: 'derived', runId: result.runId,
      runNumber: result.runNumber, templateId, templateVersion, version: result.provenance.algorithmVersion,
    }, {
      dataType: 'numeric', datasetId: result.configuration.datasetId, key: 'multivariate.cluster_confidence',
      method: 'k-means', name: 'Cluster membership strength', origin: 'derived', runId: result.runId,
      runNumber: result.runNumber, templateId, templateVersion, version: result.provenance.algorithmVersion,
    })
  }
  const selectedKeys = new Set(fields.map((field) => field.key))
  const rows = result.rows.map((row): MultivariateDerivedRow => {
    const values: Record<string, number> = {}
    row.scores.forEach((value, index) => {
      const key = `multivariate.pc${index + 1}`
      if (selectedKeys.has(key)) values[key] = value
    })
    if (selectedKeys.has('multivariate.cluster_id')) values['multivariate.cluster_id'] = row.cluster
    if (selectedKeys.has('multivariate.cluster_distance')) values['multivariate.cluster_distance'] = row.clusterDistance ?? 0
    if (selectedKeys.has('multivariate.cluster_confidence')) values['multivariate.cluster_confidence'] = row.membershipStrength ?? 1
    return {
      ...(row.depthFrom === undefined ? {} : { depthFrom: row.depthFrom }),
      ...(row.depthTo === undefined ? {} : { depthTo: row.depthTo }),
      datasetId: result.configuration.datasetId,
      ...(row.holeId === undefined ? {} : { holeId: row.holeId }),
      observationId: row.observationId,
      runId: result.runId,
      sourceDatasetIds: [...(row.sourceDatasetIds ?? [result.configuration.datasetId])],
      sourceObservationIds: [...row.sourceObservationIds],
      templateId,
      templateVersion,
      values,
    }
  })
  const savedRun: SavedMultivariateRun = {
    algorithmVersion: result.provenance.algorithmVersion,
    datasetId: result.configuration.datasetId,
    fields,
    missingPolicy: result.configuration.missingPolicy,
    runId: result.runId,
    runNumber: result.runNumber,
    savedAt,
    scaling: result.configuration.scaling,
    snapshotAt: result.configuration.snapshotAt,
    sourceObservationCount: result.rows.length,
    templateId,
    templateVersion,
    variableKeys: [...result.configuration.variableKeys],
  }
  const current = readMultivariateDerivedDocument(storage)
  const replacedKeys = new Set(fields.map((field) => `${field.templateId}:${field.templateVersion}:${field.key}`))
  const mergedRows = new Map<string, MultivariateDerivedRow>()
  current.rows.forEach((row) => {
    const values = Object.fromEntries(Object.entries(row.values).filter(([key]) => !replacedKeys.has(`${row.templateId}:${row.templateVersion}:${key}`)))
    if (Object.keys(values).length > 0) mergedRows.set(`${row.templateId}:${row.templateVersion}:${row.observationId}`, { ...row, values })
  })
  rows.forEach((row) => {
    const key = `${row.templateId}:${row.templateVersion}:${row.observationId}`
    const previous = mergedRows.get(key)
    mergedRows.set(key, {
      ...row,
      sourceObservationIds: [...new Set([...(previous?.sourceObservationIds ?? []), ...row.sourceObservationIds])],
      values: { ...(previous?.values ?? {}), ...row.values },
    })
  })
  const next: MultivariateDerivedDocument = {
    fields: [...current.fields.filter((field) => !replacedKeys.has(`${field.templateId}:${field.templateVersion}:${field.key}`)), ...fields],
    rows: [...mergedRows.values()],
    runs: [savedRun, ...current.runs.filter((run) => !(
      run.runId === result.runId
      && run.templateId === templateId
      && run.templateVersion === templateVersion
    ))].slice(0, 30),
    version: 1,
  }
  storage.setItem(MULTIVARIATE_DERIVED_STORAGE_KEY, JSON.stringify(next))
  return next
}
