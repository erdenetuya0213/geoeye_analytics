import type { EdaRunResult } from '../analysis/edaRun.js'
import type { StorageLike } from './geotechnicalDerivedStore.js'

const EDA_RUN_CACHE_KEY = 'geoeye.eda.runs.v1'
const MAX_CACHED_RUNS = 5

interface EdaRunCacheDocument {
  runs: EdaRunResult[]
  version: 1
}

export function readEdaRunCache(storage: StorageLike | undefined): EdaRunResult[] {
  if (storage === undefined) return []
  try {
    const parsed = JSON.parse(storage.getItem(EDA_RUN_CACHE_KEY) ?? '') as Partial<EdaRunCacheDocument>
    if (parsed.version !== 1 || !Array.isArray(parsed.runs)) return []
    return parsed.runs.filter((run): run is EdaRunResult => (
      typeof run === 'object'
      && run !== null
      && typeof run.runNumber === 'number'
      && typeof run.configurationSignature === 'string'
      && Array.isArray(run.populations)
    ))
  } catch {
    return []
  }
}

export function nextEdaRunNumber(storage: StorageLike | undefined) {
  return readEdaRunCache(storage).reduce((maximum, run) => Math.max(maximum, run.runNumber), 0) + 1
}

export function writeEdaRunCache(storage: StorageLike | undefined, run: EdaRunResult) {
  if (storage === undefined) return
  const current = readEdaRunCache(storage).filter((candidate) => candidate.runId !== run.runId)
  const document: EdaRunCacheDocument = { runs: [run, ...current].slice(0, MAX_CACHED_RUNS), version: 1 }
  try {
    storage.setItem(EDA_RUN_CACHE_KEY, JSON.stringify(document))
  } catch {
    // The active run remains usable in memory if browser storage is unavailable.
  }
}
