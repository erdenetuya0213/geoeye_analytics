import { describe, expect, it, vi } from 'vitest'
import { mineralAssessmentFromPackage, persistMineralAssessment, readMineralAssessment } from './mineralAssessmentStore.js'
import { runMineralAssessment } from '../analysis/mineralSystems.js'
import { readAnalysisResultDocument, saveAnalysisResultPackage } from './analysisResultStore.js'
import type { EdaDataset } from './edaTypes.js'

const dataset: EdaDataset = { id: 'assay', name: 'Assay', source: 'live', producer: 'Lab', project: 'Test', snapshotAt: 'snapshot-1', support: 'interval', dimensions: [],
  variables: [{ key: 'cu', label: 'Cu', shortLabel: 'Cu', unit: 'ppm', decimals: 0 }],
  observations: [{ id: 'row', sourceObservationId: 'source', sourceObservationIds: ['source'], holeId: 'DH-1', depthFrom: 0, depthTo: 1, easting: 10, northing: 20, values: { cu: 2000 }, dimensions: {}, lithology: '', sampleId: 'sample', joinKey: 'join' }] }
const configuration = { baseDatasetId: 'assay', bindings: [{ id: 'binding', datasetId: 'assay', fieldKey: 'cu', criterionId: 'cu', operator: 'gte' as const, threshold: 1000, unit: 'ppm' as const, terms: [], polarity: 'support' as const, reliability: 0.9 }] }

describe('mineral assessment persistence', () => {
  it('roundtrips source evidence and waits for native document durability', async () => {
    const entries = new Map<string, string>(), flush = vi.fn().mockResolvedValue(undefined)
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) }, removeItem: (key: string) => { entries.delete(key) }, flush }
    const run = runMineralAssessment([dataset], configuration, 'run-1')
    await persistMineralAssessment(storage, run)
    expect(flush).toHaveBeenCalledOnce()
    expect(readMineralAssessment(storage)).toEqual(run)
    flush.mockRejectedValueOnce(new Error('Disk full'))
    await expect(persistMineralAssessment(storage, run)).rejects.toThrow('Disk full')
  })
  it('keeps saved mineral versions separate from population templates and restores their own observations', async () => {
    const entries = new Map<string, string>()
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) } }
    const original = runMineralAssessment([dataset], configuration, 'original')
    const changed = runMineralAssessment([dataset], { ...configuration, bindings: configuration.bindings.map(b => ({ ...b, threshold: 3000 })) }, 'changed')
    const input = { analysisFileId: 'file', boreholeIds: ['DH-1'], createdAt: '2026-10-06', derivedFieldKeys: ['mineral.fit'], feature: 'multivariate' as const, graphs: [], inputName: 'Mineral-system assessment',
      projectId: 'project', sourceFileName: 'assay.json', sourceObservationIds: ['source'], tenantId: 'tenant', templateId: 'mineral-assessment:assay', templateVersion: 1 }
    await saveAnalysisResultPackage(storage, { ...input, runId: original.runId, analysisPayload: { kind: 'mineral-system-assessment', run: original, selectedSystemId: 'porphyry' } })
    await saveAnalysisResultPackage(storage, { ...input, templateVersion: 2, runId: changed.runId, analysisPayload: { kind: 'mineral-system-assessment', run: changed, selectedSystemId: 'porphyry' } })
    await saveAnalysisResultPackage(storage, { ...input, templateId: 'assay', runId: 'pca-run', analysisPayload: { kind: 'pca' } })
    const packages = readAnalysisResultDocument(storage).packages
    expect(packages).toHaveLength(3)
    expect(mineralAssessmentFromPackage(packages.find(p => p.runId === 'original')!)?.run.evidence.find(e => e.criterionId === 'cu')?.state).toBe('supports')
    expect(mineralAssessmentFromPackage(packages.find(p => p.runId === 'changed')!)?.run.evidence.find(e => e.criterionId === 'cu')?.state).toBe('not-observed')
    expect(mineralAssessmentFromPackage(packages.find(p => p.runId === 'pca-run')!)).toBeNull()
  })
  it('ignores empty and corrupt project documents', () => {
    expect(readMineralAssessment({ getItem: () => null })).toBeNull()
    expect(readMineralAssessment({ getItem: () => '{bad json' })).toBeNull()
    expect(readMineralAssessment({ getItem: () => '{"version":1,"baseDatasetId":"assay"}' })).toBeNull()
    const run = runMineralAssessment([dataset], configuration)
    expect(readMineralAssessment({ getItem: () => JSON.stringify({ ...run, snapshots: [null] }) })).toBeNull()
    expect(readMineralAssessment({ getItem: () => JSON.stringify({ ...run, intervals: [{ observationId: 'row', sourceObservationIds: [], matches: [null] }] }) })).toBeNull()
  })
})
