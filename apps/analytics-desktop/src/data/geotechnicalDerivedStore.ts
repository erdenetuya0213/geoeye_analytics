import type { Rmr76CalculationRun } from '../analysis/geotechnicalWorkflow.js'

export interface DerivedFieldDefinition {
  dataType: 'numeric' | 'category'
  key: string
  method: 'Bieniawski 1976'
  methodVersion: string
  name: string
  origin: 'derived'
  scoreType: 'bounded_ordinal_score' | null
}

export interface SavedRmr76Interval {
  calculationRunId: string
  componentRatings: Record<string, number | null> | null
  depthFrom: number
  depthTo: number
  holeId: string
  inputValues: { rqdPercent: number | null; ucsMpa: number | null }
  lithology: string
  methodVersion: string
  scenarioId: string
  scenarioName: string
  snapshotId: string
  rmr76: number
  rmr76Class: string
  savedAt: string
  sourceEntityId: string
  sourceLineage: Rmr76CalculationRun['intervals'][number]['lineage']
}

export interface SavedRmr76Run {
  classificationId: string
  datasetId: string
  fieldDefinitions: DerivedFieldDefinition[]
  includeComponentRatings: boolean
  intervals: SavedRmr76Interval[]
  methodVersion: string
  runId: string
  savedAt: string
  scenarioId: string
  scenarioName: string
  snapshotId: string
  scopeEntityIds: string[]
  sourceSignature: string
}

export interface GeotechnicalDerivedDocument {
  activeScenarioId: string
  fields: DerivedFieldDefinition[]
  intervals: SavedRmr76Interval[]
  runs: Array<Pick<SavedRmr76Run, 'classificationId' | 'datasetId' | 'includeComponentRatings' | 'methodVersion' | 'runId' | 'savedAt' | 'scenarioId' | 'scenarioName' | 'snapshotId' | 'sourceSignature'>>
  version: 1
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const GEOTECHNICAL_DERIVED_STORAGE_KEY = 'geoeye.analytics.geotechnical-derived.v1'

const DEFAULT_SCENARIO_ID = 'rmr76-base'
const DEFAULT_SCENARIO_NAME = 'RMR76 – Base'
const emptyDocument: GeotechnicalDerivedDocument = { activeScenarioId: DEFAULT_SCENARIO_ID, fields: [], intervals: [], runs: [], version: 1 }

export interface SaveRmr76Options {
  scenarioId?: string
  scenarioName?: string
}

export function buildSavedRmr76Run(
  run: Rmr76CalculationRun,
  datasetId: string,
  savedAt: string,
  includeComponentRatings: boolean,
  options: SaveRmr76Options = {},
): SavedRmr76Run {
  const scenarioId = options.scenarioId ?? DEFAULT_SCENARIO_ID
  const scenarioName = options.scenarioName ?? DEFAULT_SCENARIO_NAME
  const fieldDefinitions: DerivedFieldDefinition[] = [
    {
      dataType: 'numeric',
      key: 'geotech.rmr76',
      method: 'Bieniawski 1976',
      methodVersion: run.method.version,
      name: 'RMR76',
      origin: 'derived',
      scoreType: 'bounded_ordinal_score',
    },
    {
      dataType: 'category',
      key: 'geotech.rmr76_class',
      method: 'Bieniawski 1976',
      methodVersion: run.method.version,
      name: 'RMR76 class',
      origin: 'derived',
      scoreType: null,
    },
  ]
  if (includeComponentRatings) {
    for (const key of ['strength', 'rqd', 'joint_spacing', 'joint_condition', 'groundwater', 'orientation'] as const) {
      fieldDefinitions.push({
        dataType: 'numeric',
        key: `geotech.rmr76_component_${key}`,
        method: 'Bieniawski 1976',
        methodVersion: run.method.version,
        name: `RMR76 ${key.replaceAll('_', ' ')} rating`,
        origin: 'derived',
        scoreType: null,
      })
    }
  }
  const intervals = run.intervals.flatMap((interval): SavedRmr76Interval[] => {
    const calculation = interval.calculation
    if (interval.status !== 'valid' || calculation === null || calculation.total === null || calculation.classification === null) return []
    return [{
      calculationRunId: run.runId,
      componentRatings: includeComponentRatings ? {
        groundwater: calculation.scores.groundwater,
        jointCondition: calculation.scores.jointCondition,
        jointSpacing: calculation.scores.jointSpacing,
        orientation: calculation.orientationAdjustment,
        rqd: calculation.scores.rqd,
        strength: calculation.scores.strength,
      } : null,
      depthFrom: interval.depthFrom,
      depthTo: interval.depthTo,
      holeId: interval.holeId,
      inputValues: interval.inputValues,
      lithology: interval.lithology,
      methodVersion: run.method.version,
      scenarioId,
      scenarioName,
      snapshotId: run.snapshotId,
      rmr76: calculation.total,
      rmr76Class: calculation.classification,
      savedAt,
      sourceEntityId: interval.id,
      sourceLineage: interval.lineage,
    }]
  })
  return {
    classificationId: run.method.id,
    datasetId,
    fieldDefinitions,
    includeComponentRatings,
    intervals,
    methodVersion: run.method.version,
    runId: run.runId,
    savedAt,
    scenarioId,
    scenarioName,
    snapshotId: run.snapshotId,
    scopeEntityIds: run.intervals.map((interval) => interval.id),
    sourceSignature: run.sourceSignature,
  }
}

export function readGeotechnicalDerivedDocument(storage?: StorageLike): GeotechnicalDerivedDocument {
  if (storage === undefined) return emptyDocument
  try {
    const parsed = JSON.parse(storage.getItem(GEOTECHNICAL_DERIVED_STORAGE_KEY) ?? 'null') as Partial<GeotechnicalDerivedDocument> | null
    if (parsed?.version !== 1 || !Array.isArray(parsed.fields) || !Array.isArray(parsed.intervals) || !Array.isArray(parsed.runs)) return emptyDocument
    const activeScenarioId = typeof parsed.activeScenarioId === 'string' ? parsed.activeScenarioId : DEFAULT_SCENARIO_ID
    const intervals = parsed.intervals.map((interval) => ({
      ...interval,
      scenarioId: typeof interval.scenarioId === 'string' ? interval.scenarioId : DEFAULT_SCENARIO_ID,
      scenarioName: typeof interval.scenarioName === 'string' ? interval.scenarioName : DEFAULT_SCENARIO_NAME,
      snapshotId: typeof interval.snapshotId === 'string' ? interval.snapshotId : 'unversioned',
    }))
    const runs = parsed.runs.map((run) => ({
      ...run,
      classificationId: typeof run.classificationId === 'string' ? run.classificationId : 'rmr76',
      scenarioId: typeof run.scenarioId === 'string' ? run.scenarioId : DEFAULT_SCENARIO_ID,
      scenarioName: typeof run.scenarioName === 'string' ? run.scenarioName : DEFAULT_SCENARIO_NAME,
      snapshotId: typeof run.snapshotId === 'string' ? run.snapshotId : 'unversioned',
    }))
    return { activeScenarioId, fields: parsed.fields, intervals, runs, version: 1 }
  } catch {
    return emptyDocument
  }
}

export function saveRmr76DerivedFields(storage: StorageLike, savedRun: SavedRmr76Run): GeotechnicalDerivedDocument {
  const current = readGeotechnicalDerivedDocument(storage)
  const fieldMap = new Map(current.fields.map((field) => [field.key, field]))
  savedRun.fieldDefinitions.forEach((field) => fieldMap.set(field.key, field))
  const replacedScope = new Set(savedRun.scopeEntityIds)
  const intervalMap = new Map(current.intervals
    .filter((interval) => interval.scenarioId !== savedRun.scenarioId || !replacedScope.has(interval.sourceEntityId))
    .map((interval) => [`${interval.scenarioId}:${interval.sourceEntityId}`, interval]))
  savedRun.intervals.forEach((interval) => intervalMap.set(`${interval.scenarioId}:${interval.sourceEntityId}`, interval))
  const next: GeotechnicalDerivedDocument = {
    activeScenarioId: savedRun.scenarioId,
    fields: [...fieldMap.values()],
    intervals: [...intervalMap.values()],
    runs: [
      {
        datasetId: savedRun.datasetId,
        classificationId: savedRun.classificationId,
        includeComponentRatings: savedRun.includeComponentRatings,
        methodVersion: savedRun.methodVersion,
        runId: savedRun.runId,
        savedAt: savedRun.savedAt,
        scenarioId: savedRun.scenarioId,
        scenarioName: savedRun.scenarioName,
        snapshotId: savedRun.snapshotId,
        sourceSignature: savedRun.sourceSignature,
      },
      ...current.runs.filter((run) => run.runId !== savedRun.runId || run.scenarioId !== savedRun.scenarioId),
    ].slice(0, 20),
    version: 1,
  }
  storage.setItem(GEOTECHNICAL_DERIVED_STORAGE_KEY, JSON.stringify(next))
  return next
}
