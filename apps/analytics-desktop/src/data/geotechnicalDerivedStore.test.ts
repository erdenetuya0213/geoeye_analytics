import { describe, expect, it } from 'vitest'
import { calculateRmr76Intervals } from '../analysis/geotechnicalWorkflow.js'
import { edaDemoDataset, mergeSavedRmr76IntoEda } from './edaDemo.js'
import {
  buildSavedRmr76Run,
  GEOTECHNICAL_DERIVED_STORAGE_KEY,
  readGeotechnicalDerivedDocument,
  saveRmr76DerivedFields,
  type StorageLike,
} from './geotechnicalDerivedStore.js'
import { rmrDatasets } from './geotechnicalDemo.js'

const RmrMethodVersion = 'rmr76-bieniawski-1976.1'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe('saving RMR76 derived fields', () => {
  it('creates derived score and class fields with complete lineage metadata', () => {
    const dataset = rmrDatasets[0]
    expect(dataset).toBeDefined()
    if (dataset === undefined) return
    const sources = new Set(dataset.sources.map((source) => source.id))
    const run = calculateRmr76Intervals(dataset.intervals, sources, 'run-save', '2026-10-01T01:00:00.000Z')
    const saved = buildSavedRmr76Run(run, dataset.targetTemplateId, '2026-10-01T02:00:00.000Z', true)
    const storage = new MemoryStorage()
    const document = saveRmr76DerivedFields(storage, saved)

    expect(document.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'geotech.rmr76', method: 'Bieniawski 1976', origin: 'derived', scoreType: 'bounded_ordinal_score' }),
      expect.objectContaining({ key: 'geotech.rmr76_class', origin: 'derived' }),
    ]))
    expect(document.intervals[0]).toMatchObject({
      calculationRunId: 'run-save',
      methodVersion: RmrMethodVersion,
      savedAt: '2026-10-01T02:00:00.000Z',
    })
    expect(document.intervals[0]?.sourceLineage.length).toBe(6)
    expect(document.intervals[0]?.componentRatings).not.toBeNull()
    expect(storage.getItem(GEOTECHNICAL_DERIVED_STORAGE_KEY)).not.toBeNull()
    expect(readGeotechnicalDerivedDocument(storage)).toEqual(document)
  })

  it('updates derived interval values without modifying the source dataset', () => {
    const dataset = rmrDatasets[0]
    if (dataset === undefined) return
    const sourceSnapshot = JSON.stringify(dataset.intervals)
    const sources = new Set(dataset.sources.map((source) => source.id))
    const storage = new MemoryStorage()
    const firstRun = calculateRmr76Intervals(dataset.intervals, sources, 'run-1', '2026-10-01T01:00:00.000Z')
    const firstIntervalId = dataset.intervals[0]?.id
    const changedIntervals = dataset.intervals.map((interval, index) => index === 0
      ? { ...interval, candidates: interval.candidates.filter((candidate) => candidate.canonicalKey !== 'geotech.groundwater') }
      : interval)
    const secondRun = calculateRmr76Intervals(changedIntervals, sources, 'run-2', '2026-10-01T02:00:00.000Z')
    saveRmr76DerivedFields(storage, buildSavedRmr76Run(firstRun, dataset.targetTemplateId, '2026-10-01T01:30:00.000Z', false))
    const document = saveRmr76DerivedFields(storage, buildSavedRmr76Run(secondRun, dataset.targetTemplateId, '2026-10-01T02:30:00.000Z', false))

    expect(new Set(document.intervals.map((interval) => interval.sourceEntityId)).size).toBe(document.intervals.length)
    expect(document.intervals.every((interval) => interval.calculationRunId === 'run-2')).toBe(true)
    expect(document.intervals.some((interval) => interval.sourceEntityId === firstIntervalId)).toBe(false)
    expect(JSON.stringify(dataset.intervals)).toBe(sourceSnapshot)
  })

  it('makes saved RMR76 available through the normal EDA variable registry', () => {
    const dataset = rmrDatasets[0]
    if (dataset === undefined) return
    const sources = new Set(dataset.sources.map((source) => source.id))
    const run = calculateRmr76Intervals(dataset.intervals, sources, 'run-eda', '2026-10-01T01:00:00.000Z')
    const storage = new MemoryStorage()
    const document = saveRmr76DerivedFields(storage, buildSavedRmr76Run(run, dataset.targetTemplateId, '2026-10-01T02:00:00.000Z', false))
    const eda = mergeSavedRmr76IntoEda(edaDemoDataset, document)

    expect(eda.variables).toContainEqual(expect.objectContaining({
      key: 'geotech.rmr76',
      method: 'Bieniawski 1976',
      origin: 'derived',
      scoreType: 'bounded_ordinal_score',
    }))
    expect(eda.observations.some((observation) => typeof observation.values['geotech.rmr76'] === 'number')).toBe(true)
  })

  it('preserves snapshot lineage and keeps Save As template versions separate', () => {
    const dataset = rmrDatasets[0]
    if (dataset === undefined) return
    const sources = new Set(dataset.sources.map((source) => source.id))
    const run = calculateRmr76Intervals(dataset.intervals, sources, 'run-scenarios', '2026-10-01T01:00:00.000Z', '43')
    const storage = new MemoryStorage()
    saveRmr76DerivedFields(storage, buildSavedRmr76Run(run, dataset.targetTemplateId, '2026-10-01T02:00:00.000Z', false, {
      scenarioId: `${dataset.targetTemplateId}:v34`,
      scenarioName: 'Geotechnical logging v34',
    }))
    const document = saveRmr76DerivedFields(storage, buildSavedRmr76Run(run, dataset.targetTemplateId, '2026-10-01T02:05:00.000Z', true, {
      scenarioId: `${dataset.targetTemplateId}:v35`,
      scenarioName: 'Geotechnical logging v35',
    }))

    expect(document.activeScenarioId).toBe(`${dataset.targetTemplateId}:v35`)
    expect(new Set(document.intervals.map((interval) => interval.scenarioId))).toEqual(new Set([`${dataset.targetTemplateId}:v34`, `${dataset.targetTemplateId}:v35`]))
    expect(document.intervals.every((interval) => interval.snapshotId === '43')).toBe(true)
    expect(document.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ scenarioName: 'Geotechnical logging v34', snapshotId: '43' }),
      expect.objectContaining({ scenarioName: 'Geotechnical logging v35', snapshotId: '43' }),
    ]))
  })
})
