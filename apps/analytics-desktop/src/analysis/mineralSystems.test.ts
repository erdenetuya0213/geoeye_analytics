import { describe, expect, it } from 'vitest'
import { MINERAL_CRITERIA, MINERAL_SYSTEM_MODELS } from './mineralSystemModels.js'
import { assessmentIsCurrent, assessSourceSensitivity, concentrationFactor, investigationPriorities, mineralAssessmentDataset, runMineralAssessment, suggestEvidenceBindings, type EvidenceBinding } from './mineralSystems.js'
import type { EdaObservation } from './eda.js'
import type { EdaDataset } from '../data/edaTypes.js'

function row(id: string, values: Record<string, number | null>, dimensions: Record<string, string> = {}, overrides: Partial<EdaObservation> = {}): EdaObservation {
  return { id, sourceObservationId: id, sourceObservationIds: [id], sampleId: id, holeId: 'DH-01', depthFrom: 10, depthTo: 12, joinKey: id,
    easting: 100, northing: 200, lithology: 'Granodiorite', values, dimensions, ...overrides }
}
function dataset(id: string, observations: EdaObservation[], variables: Array<[string, string, string]>, dimensions: string[] = []): EdaDataset {
  return { id, name: id, producer: id, source: 'live', snapshotAt: '2026-10-06T00:00:00Z', project: 'Test', support: 'interval', observations,
    variables: variables.map(([key, label, unit]) => ({ key, label, shortLabel: label, unit, decimals: 2 })), dimensions: dimensions.map(key => ({ key, label: key })) }
}
function inputs() {
  return [
    dataset('assay', [row('lab-1', { cu: 0.2, mo: 100 }, { lithology: 'Granodiorite', structure: 'Quartz stockwork' })], [['cu', 'Cu', '%'], ['mo', 'Mo', 'ppm']], ['lithology', 'structure']),
    dataset('xrf', [row('xrf-1', { cu: 2200 }, {}, { depthFrom: 11, depthTo: 11 })], [['cu', 'Cu', 'ppm']]),
    dataset('spectral', [row('scan-1', {}, { mineral: 'Potassic alteration; secondary biotite' }, { depthFrom: 11, depthTo: 11 })], [], ['mineral']),
  ]
}
function mapping(overrides: Partial<EvidenceBinding> = {}): EvidenceBinding {
  return { id: 'cu:assay', criterionId: 'cu', datasetId: 'assay', fieldKey: 'cu', operator: 'gte', threshold: 1000,
    unit: 'ppm', terms: [], polarity: 'support', reliability: 0.9, ...overrides }
}
const getEvidence = (run: ReturnType<typeof runMineralAssessment>, id: string) => run.evidence.find(e => e.criterionId === id)!

describe('mineral-system assessment', () => {
  it('integrates assays, XRF and spectral mineralogy on one support with method-specific units and lineage', () => {
    const sources = inputs(), before = JSON.stringify(sources)
    const run = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: suggestEvidenceBindings(sources) }, 'run-1')
    expect(run.systems).toHaveLength(16)
    expect(new Set(MINERAL_SYSTEM_MODELS.map(m => m.id)).size).toBe(16)
    expect(MINERAL_SYSTEM_MODELS.every(m => m.criteria.every(c => MINERAL_CRITERIA.some(criterion => criterion.id === c.id)))).toBe(true)
    expect(getEvidence(run, 'cu').datasetIds).toEqual(['assay', 'xrf'])
    expect(getEvidence(run, 'potassic').sourceObservationIds).toEqual(['scan-1'])
    expect(run.intervals[0]?.sourceObservationIds).toEqual(['lab-1', 'xrf-1', 'scan-1'])
    expect(run.intervals[0]?.matches.find(m => m.datasetId === 'assay' && m.criterionId === 'cu')?.comparedValue).toBe(2000)
    expect(run.intervals[0]?.matches.find(m => m.datasetId === 'xrf' && m.criterionId === 'cu')?.comparedValue).toBe(2200)
    expect(run.systems.find(s => s.systemId === 'porphyry')?.fit).toBeGreaterThan(0)
    expect(JSON.stringify(sources)).toBe(before)
  })
  it('does not join different holes or invalid locations or treat a missing source as contradiction', () => {
    const sources = inputs()
    sources[1]!.observations[0]!.holeId = 'DH-02'
    sources[2]!.observations[0]!.locationValid = false
    const run = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: suggestEvidenceBindings(sources) })
    expect(getEvidence(run, 'cu').datasetIds).toEqual(['assay'])
    expect(getEvidence(run, 'potassic').state).toBe('not-observed')
    expect(getEvidence(run, 'heat').state).toBe('not-observed')
    expect(run.issues.some(issue => issue.includes('not evidence of absence'))).toBe(true)
  })
  it('converts concentration units and rejects unknown units rather than silently comparing them', () => {
    expect(concentrationFactor('%')).toBe(10_000)
    expect(concentrationFactor('g / t')).toBe(1)
    expect(concentrationFactor('ppb')).toBe(0.001)
    expect(concentrationFactor('counts')).toBeNull()
    const sources = inputs()
    sources[0]!.variables = sources[0]!.variables.map(v => ({ ...v, unit: '' }))
    const run = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: [mapping()] })
    expect(getEvidence(run, 'cu').state).toBe('not-observed')
    expect(run.systems.every(s => s.fit === null)).toBe(true)
    expect(run.issues.some(i => i.includes('Skipped invalid mapping'))).toBe(true)
  })
  it('caps repeated rows and correlated measurements instead of multiplying fit or reliability', () => {
    const sources = inputs()
    const first = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: suggestEvidenceBindings(sources) })
    sources[0]!.observations = Array.from({ length: 1000 }, (_, i) => ({ ...sources[0]!.observations[0]!, id: `repeat-${i}` }))
    const repeated = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: suggestEvidenceBindings(sources) })
    expect(repeated.systems.map(s => [s.systemId, s.fit, s.reliability, s.coverage])).toEqual(first.systems.map(s => [s.systemId, s.fit, s.reliability, s.coverage]))
    expect(getEvidence(repeated, 'cu').support).toBe(0.9)
  })
  it('preserves explicit tested absence and conflicting evidence, reducing signed fit', () => {
    const sources = inputs()
    const positive = mapping()
    const baseline = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: [positive] })
    const contradictory = mapping({ id: 'cu:contradiction', operator: 'lte', threshold: 3000, polarity: 'contradict', reliability: 0.8 })
    const run = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: [positive, contradictory] })
    expect(getEvidence(run, 'cu').state).toBe('conflicting')
    expect(run.systems.find(s => s.systemId === 'porphyry')!.fit).toBeLessThan(baseline.systems.find(s => s.systemId === 'porphyry')!.fit!)
    const absence = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: [contradictory] })
    expect(getEvidence(absence, 'cu').state).toBe('contradicts')
    expect(absence.systems.find(s => s.systemId === 'porphyry')!.coverage).toBeGreaterThan(0)
    expect(absence.systems.find(s => s.systemId === 'porphyry')!.fit).toBe(0)
  })
  it('rejects negated and uncertain mineral labels; tested absence requires an explicit literal mapping', () => {
    const sources = inputs()
    sources[2]!.observations[0]!.dimensions.mineral = 'No alunite; possible potassic alteration'
    const support = mapping({ id: 'mineral', criterionId: 'alunite', datasetId: 'spectral', fieldKey: 'mineral', operator: 'contains', terms: ['alunite'], unit: 'native' })
    const run = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: [support] })
    expect(getEvidence(run, 'alunite').state).toBe('not-observed')
    const absent = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: [{ ...support, operator: 'equals', terms: ['No alunite; possible potassic alteration'], polarity: 'contradict' }] })
    expect(getEvidence(absent, 'alunite').state).toBe('contradicts')
    sources[2]!.observations[0]!.dimensions.mineral = 'alunite?'
    expect(getEvidence(runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: [support] }), 'alunite').state).toBe('not-observed')
  })
  it('does not infer Au, Pt or Li from unvalidated portable XRF or mineral identity from numerical spectral scores', () => {
    const sources = [dataset('xrf', [row('x', { au: 1, pt: 1, li: 500, cu: 2000 })], [['au', 'Au', 'ppm'], ['pt', 'Pt', 'ppm'], ['li', 'Li', 'ppm'], ['cu', 'Cu', 'ppm']]),
      dataset('spectral', [row('s', { alunite_score: 0.8 })], [['alunite_score', 'Alunite score', '']])]
    expect(suggestEvidenceBindings(sources).map(b => b.criterionId)).toEqual(['cu'])
    const explicit = mapping({ id: 'spectral-score', criterionId: 'alunite', datasetId: 'spectral', fieldKey: 'alunite_score', threshold: 0.7, unit: 'native' })
    const run = runMineralAssessment(sources, { baseDatasetId: 'xrf', bindings: [explicit] })
    expect(getEvidence(run, 'alunite').state).toBe('supports')
  })
  it('compares source exclusions without mutating the observed assessment', () => {
    const sources = inputs(), run = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: suggestEvidenceBindings(sources) })
    const before = JSON.stringify(run)
    const reduced = assessSourceSensitivity(run, ['spectral'])
    expect(reduced.find(s => s.systemId === 'porphyry')!.fit).toBeLessThan(run.systems.find(s => s.systemId === 'porphyry')!.fit!)
    expect(assessSourceSensitivity(run, ['assay', 'xrf', 'spectral']).every(s => s.fit === null)).toBe(true)
    expect(JSON.stringify(run)).toBe(before)
    expect(investigationPriorities(run, 'porphyry').some(c => c.id === 'heat')).toBe(true)
  })
  it('requires an optional spectral identification quality gate on the same matched source observation', () => {
    const sources = inputs()
    sources[2]!.variables = [{ key: 'score', label: 'Identification score', shortLabel: 'Score', unit: '', decimals: 2 }]
    sources[2]!.observations[0]!.values.score = 0.3
    const binding = mapping({ criterionId: 'potassic', datasetId: 'spectral', fieldKey: 'mineral', operator: 'contains', terms: ['potassic'], unit: 'native', qualityFieldKey: 'score', minimumQuality: 0.7 })
    expect(getEvidence(runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: [binding] }), 'potassic').state).toBe('not-observed')
    sources[2]!.observations[0]!.values.score = 0.9
    const run = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: [binding] })
    expect(run.intervals[0]!.matches[0]!.quality).toEqual({ fieldKey: 'score', value: 0.9, minimum: 0.7 })
    sources[2]!.observations[0]!.values.score = null
    expect(getEvidence(runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: [binding] }), 'potassic').state).toBe('not-observed')
  })
  it('projects evidence into 3D on actual assessed supports, while stale datasets and other populations stay unmodified', () => {
    const sources = inputs()
    sources[0]!.observations.push(row('unassessed', { cu: 0 }, {}, { depthFrom: 20, depthTo: 22 }))
    const run = runMineralAssessment(sources, { baseDatasetId: 'assay', bindings: suggestEvidenceBindings(sources), baseObservationIds: ['lab-1'] })
    const projected = mineralAssessmentDataset(sources[0]!, run, 'porphyry')
    expect(projected.observations[0]!.values['mineral.fit']).toBeGreaterThan(0)
    expect(projected.observations[0]!.dimensions['mineral.methods']).toContain('spectral')
    expect(projected.observations[1]!.values['mineral.fit']).toBeNull()
    expect(projected.observations[1]!.dimensions['mineral.evidence']).toBe('Not assessed')
    expect(assessmentIsCurrent(run, sources)).toBe(true)
    sources[0]!.snapshotAt = '2026-10-06T01:00:00Z'
    expect(assessmentIsCurrent(run, sources)).toBe(false)
    expect(mineralAssessmentDataset(sources[0]!, run, 'porphyry')).toBe(sources[0])
    expect(mineralAssessmentDataset(sources[1]!, run, 'porphyry')).toBe(sources[1])
  })
  it('reports invalid base supports and handles all-missing data without synthetic rankings', () => {
    const source = dataset('assay', [row('invalid', { cu: 2000 }, {}, { depthFrom: -1 }), row('missing', { cu: null })], [['cu', 'Cu', 'ppm']])
    const run = runMineralAssessment([source], { baseDatasetId: source.id, bindings: [mapping()] })
    expect(run.excludedLocationCount).toBe(1)
    expect(run.inputCount).toBe(2)
    expect(run.intervals).toHaveLength(1)
    expect(run.systems.every(s => s.fit === null && s.coverage === 0)).toBe(true)
    expect(() => runMineralAssessment([], { baseDatasetId: 'missing', bindings: [] })).toThrow('available interval dataset')
  })
})
