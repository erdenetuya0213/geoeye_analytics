import { describe, expect, it } from 'vitest'
import {
  type AnalysisFeature,
  currentAnalysisTemplateVersion,
  readAnalysisSaveDocument,
  recordAnalysisTemplateSave,
  resolveAnalysisTemplateVersion,
} from './analysisSaveStore.js'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

const save = (templateVersion: number, runId: string, feature: AnalysisFeature = 'structure') => ({
  analysisFileId: `${feature}-run-${runId}.json`,
  derivedFieldKeys: [`${feature}.derived_value`],
  feature,
  runId,
  savedAt: `2026-10-03T0${templateVersion}:00:00.000Z`,
  templateId: 'template.structure',
  templateVersion,
})

describe('analysis template save policy', () => {
  it('Save overwrites the active template version without duplicating its manifest', () => {
    const storage = memoryStorage()
    recordAnalysisTemplateSave(storage, save(3, 'run-1'))
    recordAnalysisTemplateSave(storage, save(3, 'run-2'))

    const document = readAnalysisSaveDocument(storage)
    expect(document.saves).toHaveLength(1)
    expect(document.saves[0]).toMatchObject({ runId: 'run-2', templateVersion: 3 })
    expect(resolveAnalysisTemplateVersion(storage, {
      fallbackVersion: 3,
      mode: 'overwrite',
      templateId: 'template.structure',
    })).toBe(3)
  })

  it('Save As creates the next template version and preserves the previous artifact', () => {
    const storage = memoryStorage()
    recordAnalysisTemplateSave(storage, save(3, 'run-1'))
    const nextVersion = resolveAnalysisTemplateVersion(storage, {
      fallbackVersion: 3,
      mode: 'new-version',
      templateId: 'template.structure',
    })
    recordAnalysisTemplateSave(storage, save(nextVersion, 'run-2'))

    expect(nextVersion).toBe(4)
    expect(currentAnalysisTemplateVersion(storage, 'template.structure', 1)).toBe(4)
    expect(readAnalysisSaveDocument(storage).saves.map((item) => item.templateVersion)).toEqual([4, 3])
  })

  it.each<AnalysisFeature>(['structure', 'geotechnical', 'multivariate', 'domain'])(
    'applies overwrite and new-version semantics to %s saves',
    (feature) => {
      const storage = memoryStorage()
      recordAnalysisTemplateSave(storage, save(7, 'first', feature))
      recordAnalysisTemplateSave(storage, save(7, 'replacement', feature))
      const nextVersion = resolveAnalysisTemplateVersion(storage, {
        fallbackVersion: 1,
        mode: 'new-version',
        templateId: 'template.structure',
      })
      recordAnalysisTemplateSave(storage, save(nextVersion, 'new-version', feature))

      const featureSaves = readAnalysisSaveDocument(storage).saves.filter((item) => item.feature === feature)
      expect(featureSaves).toHaveLength(2)
      expect(featureSaves.map((item) => item.templateVersion)).toEqual([8, 7])
      expect(featureSaves.find((item) => item.templateVersion === 7)?.runId).toBe('replacement')
    },
  )

  it('uses one version sequence when multiple analyses write to the same logging template', () => {
    const storage = memoryStorage()
    recordAnalysisTemplateSave(storage, save(4, 'multivariate-run', 'multivariate'))

    expect(resolveAnalysisTemplateVersion(storage, {
      fallbackVersion: 1,
      mode: 'overwrite',
      templateId: 'template.structure',
    })).toBe(4)
    expect(resolveAnalysisTemplateVersion(storage, {
      fallbackVersion: 1,
      mode: 'new-version',
      templateId: 'template.structure',
    })).toBe(5)
  })
})
