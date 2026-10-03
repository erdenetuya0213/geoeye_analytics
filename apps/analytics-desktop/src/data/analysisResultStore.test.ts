import { describe, expect, it } from 'vitest'
import {
  analysisFileName,
  analysisGraphFileName,
  analysisResultObjectKey,
  readAnalysisResultDocument,
  saveAnalysisResultPackage,
} from './analysisResultStore.js'
import type { AnalysisFeature } from './analysisSaveStore.js'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

const base = {
  analysisFileId: 'multivariate/source/v3.json',
  analysisPayload: { algorithm: 'pca-kmeans', clusters: 3 },
  boreholeIds: ['DH-002', 'DH-001'],
  createdAt: '2026-10-03T05:00:00.000Z',
  derivedFieldKeys: ['multivariate.pc1', 'multivariate.cluster_id'],
  feature: 'multivariate' as const,
  graphs: [{ chartName: 'PCA scores', imageDataUrl: 'data:image/png;base64,pca', mediaType: 'image/png' as const }],
  inputName: 'Au Cu As',
  projectId: 'Oyu Ridge',
  runId: 'run-3',
  sourceFileName: 'Integrated Gold.csv',
  sourceObservationIds: ['obs-2', 'obs-1', 'obs-1'],
  templateId: 'dataset.integrated',
  templateVersion: 3,
  tenantId: 'GeoEye Demo',
}

describe('analysis result packages', () => {
  it('names graph images after the source file and analysis inputs', () => {
    expect(analysisGraphFileName('folder/Integrated Gold.csv', 'Au + Cu', 'PCA scores', 3))
      .toBe('integrated-gold__au-cu__pca-scores__v3.png')
    expect(analysisFileName('folder/Integrated Gold.csv', 'Au + Cu', 'multivariate', 3))
      .toBe('integrated-gold__au-cu__multivariate-analysis__v3.json')
  })

  it('stores graph images under tenant, project, and borehole hierarchy', () => {
    expect(analysisResultObjectKey({
      boreholeId: 'DH-001', feature: 'geotechnical', fileName: 'source__rmr76__downhole__v4.png',
      projectId: 'Oyu Ridge', templateVersion: 4, tenantId: 'GeoEye Demo',
    })).toBe('tenants/geoeye-demo/projects/oyu-ridge/boreholes/dh-001/analytics/geotechnical/v4/source__rmr76__downhole__v4.png')
  })

  it('overwrites Save and retains Save As result packages', () => {
    const storage = memoryStorage()
    saveAnalysisResultPackage(storage, base)
    saveAnalysisResultPackage(storage, { ...base, runId: 'replacement' })
    let document = readAnalysisResultDocument(storage)
    expect(document.packages).toHaveLength(1)
    expect(document.packages[0]).toMatchObject({ boreholeIds: ['DH-001', 'DH-002'], runId: 'replacement', templateVersion: 3 })
    expect(document.packages[0]?.analysisFile.objectKey).toBe('tenants/geoeye-demo/projects/oyu-ridge/boreholes/_all-boreholes/analytics/multivariate/v3/integrated-gold__au-cu-as__multivariate-analysis__v3.json')
    expect(JSON.parse(document.packages[0]?.analysisFile.contents ?? '{}')).toMatchObject({
      feature: 'multivariate',
      inputName: 'Au Cu As',
      payload: { algorithm: 'pca-kmeans', clusters: 3 },
      template: { id: 'dataset.integrated', version: 3 },
    })
    expect(document.packages[0]?.graphs[0]?.objectKey).toBe('tenants/geoeye-demo/projects/oyu-ridge/boreholes/_all-boreholes/analytics/multivariate/v3/integrated-gold__au-cu-as__pca-scores__v3.png')

    saveAnalysisResultPackage(storage, { ...base, runId: 'new-version', templateVersion: 4 })
    document = readAnalysisResultDocument(storage)
    expect(document.packages.map((item) => item.templateVersion)).toEqual([4, 3])
  })

  it.each<AnalysisFeature>(['structure', 'geotechnical', 'multivariate', 'domain'])(
    'keeps one result per version on Save and both versions on Save As for %s',
    (feature) => {
      const storage = memoryStorage()
      const featureBase = { ...base, feature }
      saveAnalysisResultPackage(storage, featureBase)
      saveAnalysisResultPackage(storage, { ...featureBase, runId: 'replacement' })
      saveAnalysisResultPackage(storage, { ...featureBase, runId: 'new-version', templateVersion: 4 })

      const packages = readAnalysisResultDocument(storage).packages.filter((item) => item.feature === feature)
      expect(packages).toHaveLength(2)
      expect(packages.map((item) => item.templateVersion)).toEqual([4, 3])
      expect(packages.find((item) => item.templateVersion === 3)?.runId).toBe('replacement')
    },
  )
})
