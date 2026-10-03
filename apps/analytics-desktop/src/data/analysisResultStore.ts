import type { AnalysisFeature } from './analysisSaveStore.js'
import type { StorageLike } from './geotechnicalDerivedStore.js'

export const ANALYSIS_RESULT_STORAGE_KEY = 'geoeye.analytics.result-packages.v1'

export interface AnalysisGraphImage {
  boreholeId: string | null
  chartName: string
  fileName: string
  imageDataUrl: string
  mediaType: 'image/png'
  objectKey: string
}

export interface AnalysisFileArtifact {
  contents: string
  fileName: string
  mediaType: 'application/json'
  objectKey: string
}

export interface AnalysisResultPackage {
  analysisFile: AnalysisFileArtifact
  analysisFileId: string
  boreholeIds: string[]
  createdAt: string
  derivedFieldKeys: string[]
  feature: AnalysisFeature
  graphs: AnalysisGraphImage[]
  inputName: string
  projectId: string
  resultId: string
  runId: string
  sourceFileName: string
  sourceObservationIds: string[]
  templateId: string
  templateVersion: number
  tenantId: string
}

export interface AnalysisResultDocument {
  packages: AnalysisResultPackage[]
  version: 1
}

export interface UnsavedGraphImage {
  boreholeId?: string | null
  chartName: string
  imageDataUrl: string
  mediaType: AnalysisGraphImage['mediaType']
}

const emptyDocument: AnalysisResultDocument = { packages: [], version: 1 }

function slug(value: string, fallback: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return (normalized || fallback).slice(0, 96)
}

function sourceStem(sourceFileName: string) {
  const leaf = sourceFileName.replaceAll('\\', '/').split('/').at(-1) ?? sourceFileName
  return leaf.replace(/\.[^.]+$/, '')
}

export function analysisGraphFileName(
  sourceFileName: string,
  inputName: string,
  chartName: string,
  templateVersion: number,
) {
  return `${slug(sourceStem(sourceFileName), 'source')}__${slug(inputName, 'input')}__${slug(chartName, 'graph')}__v${templateVersion}.png`
}

export function analysisFileName(
  sourceFileName: string,
  inputName: string,
  feature: AnalysisFeature,
  templateVersion: number,
) {
  return `${slug(sourceStem(sourceFileName), 'source')}__${slug(inputName, 'input')}__${feature}-analysis__v${templateVersion}.json`
}

export function analysisResultObjectKey(input: {
  boreholeId?: string | null
  feature: AnalysisFeature
  fileName: string
  projectId: string
  tenantId: string
  templateVersion: number
}) {
  const borehole = input.boreholeId == null ? '_all-boreholes' : slug(input.boreholeId, '_unknown-borehole')
  return [
    'tenants', slug(input.tenantId, '_unknown-tenant'),
    'projects', slug(input.projectId, '_unknown-project'),
    'boreholes', borehole,
    'analytics', input.feature,
    `v${input.templateVersion}`,
    input.fileName,
  ].join('/')
}

export function readAnalysisResultDocument(storage?: StorageLike): AnalysisResultDocument {
  if (storage === undefined) return emptyDocument
  try {
    const parsed = JSON.parse(storage.getItem(ANALYSIS_RESULT_STORAGE_KEY) ?? 'null') as Partial<AnalysisResultDocument> | null
    if (parsed?.version !== 1 || !Array.isArray(parsed.packages)) return emptyDocument
    return { packages: parsed.packages, version: 1 }
  } catch {
    return emptyDocument
  }
}

export function saveAnalysisResultPackage(
  storage: StorageLike,
  input: Omit<AnalysisResultPackage, 'analysisFile' | 'graphs' | 'resultId'> & {
    analysisPayload?: unknown
    graphs: readonly UnsavedGraphImage[]
  },
): AnalysisResultDocument {
  const { analysisPayload, ...packageInput } = input
  const resultId = `${input.feature}:${input.templateId}:v${input.templateVersion}`
  const graphs = input.graphs.map((graph): AnalysisGraphImage => {
    const fileName = analysisGraphFileName(
      input.sourceFileName,
      input.inputName,
      graph.chartName,
      input.templateVersion,
    )
    return {
      boreholeId: graph.boreholeId ?? null,
      chartName: graph.chartName,
      fileName,
      imageDataUrl: graph.imageDataUrl,
      mediaType: graph.mediaType,
      objectKey: analysisResultObjectKey({
        boreholeId: graph.boreholeId ?? null,
        feature: input.feature,
        fileName,
        projectId: input.projectId,
        tenantId: input.tenantId,
        templateVersion: input.templateVersion,
      }),
    }
  })
  const boreholeIds = [...new Set(input.boreholeIds)].sort()
  const derivedFieldKeys = [...new Set(input.derivedFieldKeys)].sort()
  const sourceObservationIds = [...new Set(input.sourceObservationIds)]
  const fileName = analysisFileName(
    input.sourceFileName,
    input.inputName,
    input.feature,
    input.templateVersion,
  )
  const analysisFile: AnalysisFileArtifact = {
    contents: JSON.stringify({
      schemaVersion: 1,
      feature: input.feature,
      runId: input.runId,
      template: { id: input.templateId, version: input.templateVersion },
      source: { fileName: input.sourceFileName, observationIds: sourceObservationIds },
      inputName: input.inputName,
      boreholeIds,
      derivedFieldKeys,
      payload: analysisPayload ?? null,
      graphImages: graphs.map((graph) => ({
        boreholeId: graph.boreholeId,
        chartName: graph.chartName,
        fileName: graph.fileName,
        mediaType: graph.mediaType,
        objectKey: graph.objectKey,
      })),
      createdAt: input.createdAt,
    }, null, 2),
    fileName,
    mediaType: 'application/json',
    objectKey: analysisResultObjectKey({
      boreholeId: boreholeIds.length === 1 ? boreholeIds[0]! : null,
      feature: input.feature,
      fileName,
      projectId: input.projectId,
      tenantId: input.tenantId,
      templateVersion: input.templateVersion,
    }),
  }
  const result: AnalysisResultPackage = {
    ...packageInput,
    analysisFile,
    boreholeIds,
    derivedFieldKeys,
    graphs,
    resultId,
    sourceObservationIds,
  }
  const current = readAnalysisResultDocument(storage)
  const next: AnalysisResultDocument = {
    packages: [result, ...current.packages.filter((candidate) => candidate.resultId !== resultId)].slice(0, 60),
    version: 1,
  }
  storage.setItem(ANALYSIS_RESULT_STORAGE_KEY, JSON.stringify(next))
  return next
}
