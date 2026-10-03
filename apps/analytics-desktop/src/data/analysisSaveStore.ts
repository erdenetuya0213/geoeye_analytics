import type { StorageLike } from './geotechnicalDerivedStore.js'

export type AnalysisFeature = 'domain' | 'geotechnical' | 'multivariate' | 'structure'
export type AnalysisSaveMode = 'overwrite' | 'new-version'

export interface AnalysisTemplateSave {
  analysisFileId: string
  derivedFieldKeys: string[]
  feature: AnalysisFeature
  runId: string
  savedAt: string
  templateId: string
  templateVersion: number
}

export interface AnalysisSaveDocument {
  saves: AnalysisTemplateSave[]
  version: 1
}

export const ANALYSIS_SAVE_STORAGE_KEY = 'geoeye.analytics.template-saves.v1'
const emptyDocument: AnalysisSaveDocument = { saves: [], version: 1 }

export function readAnalysisSaveDocument(storage?: StorageLike): AnalysisSaveDocument {
  if (storage === undefined) return emptyDocument
  try {
    const parsed = JSON.parse(storage.getItem(ANALYSIS_SAVE_STORAGE_KEY) ?? 'null') as Partial<AnalysisSaveDocument> | null
    if (parsed?.version !== 1 || !Array.isArray(parsed.saves)) return emptyDocument
    return { saves: parsed.saves, version: 1 }
  } catch {
    return emptyDocument
  }
}

export function currentAnalysisTemplateVersion(
  storage: StorageLike,
  templateId: string,
  fallbackVersion: number,
): number {
  return readAnalysisSaveDocument(storage).saves
    .filter((save) => save.templateId === templateId)
    .reduce((latest, save) => Math.max(latest, save.templateVersion), fallbackVersion)
}

export function resolveAnalysisTemplateVersion(
  storage: StorageLike,
  input: {
    fallbackVersion: number
    mode: AnalysisSaveMode
    templateId: string
  },
): number {
  const current = currentAnalysisTemplateVersion(
    storage,
    input.templateId,
    input.fallbackVersion,
  )
  return input.mode === 'new-version' ? current + 1 : current
}

export function recordAnalysisTemplateSave(
  storage: StorageLike,
  save: AnalysisTemplateSave,
): AnalysisSaveDocument {
  const current = readAnalysisSaveDocument(storage)
  const next: AnalysisSaveDocument = {
    saves: [
      save,
      ...current.saves.filter((candidate) => !(
        candidate.feature === save.feature
        && candidate.templateId === save.templateId
        && candidate.templateVersion === save.templateVersion
      )),
    ].slice(0, 100),
    version: 1,
  }
  storage.setItem(ANALYSIS_SAVE_STORAGE_KEY, JSON.stringify(next))
  return next
}
