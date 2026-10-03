import type { CollarRecord, SurveyStation } from '../analysis/structureAnalysis.js'

export interface StoredDrillholeImport {
  collar: CollarRecord[]
  survey: SurveyStation[]
}

const storageKey = 'geoeye.analytics.drillhole-import.v1'

export function saveDrillholeImport(value: StoredDrillholeImport) {
  window.localStorage.setItem(storageKey, JSON.stringify(value))
}

export function readDrillholeImport(): StoredDrillholeImport | undefined {
  const raw = window.localStorage.getItem(storageKey)
  if (raw === null) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDrillholeImport>
    if (!Array.isArray(parsed.collar) || !Array.isArray(parsed.survey)) return undefined
    return { collar: parsed.collar, survey: parsed.survey }
  } catch {
    return undefined
  }
}

