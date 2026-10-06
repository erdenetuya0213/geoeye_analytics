import type { MineralAssessmentRun } from '../analysis/mineralSystems.js'
import type { PersistentStorage } from '../state/persistentState.js'
import type { AnalysisResultPackage } from './analysisResultStore.js'

export const MINERAL_ASSESSMENT_RUN_KEY = 'geoeye.analytics.mineral-assessment.v1'

export function readMineralAssessment(storage: Pick<PersistentStorage, 'getItem'>): MineralAssessmentRun | null {
  try {
    const run = JSON.parse(storage.getItem(MINERAL_ASSESSMENT_RUN_KEY) ?? 'null') as MineralAssessmentRun | null
    return run?.version === 1 && typeof run.baseDatasetId === 'string' && typeof run.ruleVersion === 'string'
      && Array.isArray(run.snapshots) && Array.isArray(run.intervals) && Array.isArray(run.systems) && Array.isArray(run.evidence)
      && run.configuration != null && Array.isArray(run.configuration.bindings)
      && run.snapshots.every(snapshot => snapshot != null && typeof snapshot.datasetId === 'string' && typeof snapshot.snapshotAt === 'string')
      && run.intervals.every(interval => interval != null && typeof interval.observationId === 'string' && Array.isArray(interval.sourceObservationIds) && Array.isArray(interval.matches)
        && interval.matches.every(match => match != null && typeof match.criterionId === 'string' && typeof match.datasetId === 'string' && Array.isArray(match.sourceObservationIds)))
      && run.systems.every(system => system != null && typeof system.systemId === 'string' && system.components != null && Array.isArray(system.contributions))
      && run.evidence.every(evidence => evidence != null && typeof evidence.criterionId === 'string' && Array.isArray(evidence.sourceObservationIds)) ? run : null
  } catch { return null }
}

export async function persistMineralAssessment(storage: PersistentStorage, run: MineralAssessmentRun) {
  storage.setItem(MINERAL_ASSESSMENT_RUN_KEY, JSON.stringify(run))
  await storage.flush?.()
}

/** Saved versions carry their own run, rather than reusing the latest assessment's colours. */
export function mineralAssessmentFromPackage(result: AnalysisResultPackage): { run: MineralAssessmentRun; systemId: string } | null {
  try {
    const document = JSON.parse(result.analysisFile.contents) as { payload?: { kind?: string; run?: MineralAssessmentRun; selectedSystemId?: string } }
    if (document.payload?.kind !== 'mineral-system-assessment') return null
    const serialized = JSON.stringify(document.payload.run ?? null)
    const run = readMineralAssessment({ getItem: () => serialized })
    if (run === null) return null
    return { run, systemId: typeof document.payload.selectedSystemId === 'string' ? document.payload.selectedSystemId : run.systems[0]?.systemId ?? 'porphyry' }
  } catch { return null }
}
