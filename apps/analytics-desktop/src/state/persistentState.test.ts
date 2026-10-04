import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_PERSISTED_CHARACTERS,
  WORKSPACE_STATE_PREFIX,
  clearPersistedState,
  readPersistedState,
  resetPersistedStateMemory,
  writePersistedState,
  type PersistentStorage,
} from './persistentState.js'

function memoryStorage(): PersistentStorage & { items: Map<string, string> } {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    removeItem: (key) => { items.delete(key) },
    setItem: (key, value) => { items.set(key, value) },
  }
}

describe('persistent workspace state', () => {
  beforeEach(() => resetPersistedStateMemory())

  it('restores a saved value after the in-memory copy is gone', () => {
    const storage = memoryStorage()
    writePersistedState(storage, 'explore.variableKeys', ['assay.au', 'assay.cu'])
    resetPersistedStateMemory()

    expect(readPersistedState(storage, 'explore.variableKeys', [] as string[])).toEqual(['assay.au', 'assay.cu'])
  })

  it('returns undefined when nothing was saved', () => {
    expect(readPersistedState(memoryStorage(), 'explore.view', 'statistics')).toBeUndefined()
  })

  it('does not share transient values between project storage adapters', () => {
    const firstProject = memoryStorage()
    const secondProject = memoryStorage()
    writePersistedState(firstProject, 'explore.view', 'histogram')

    expect(readPersistedState(firstProject, 'explore.view', 'statistics')).toBe('histogram')
    expect(readPersistedState(secondProject, 'explore.view', 'statistics')).toBeUndefined()
  })

  it('round-trips sets and nested objects', () => {
    const storage = memoryStorage()
    writePersistedState(storage, 'view3d.visibleLayers', new Set(['collars', 'grid']))
    writePersistedState(storage, 'view3d.section', { azimuth: 90, centreX: null, visible: true })
    resetPersistedStateMemory()

    expect(readPersistedState(storage, 'view3d.visibleLayers', new Set<string>())).toEqual(new Set(['collars', 'grid']))
    expect(readPersistedState(storage, 'view3d.section', { azimuth: 0 })).toEqual({ azimuth: 90, centreX: null, visible: true })
  })

  it('restores null for nullable state', () => {
    const storage = memoryStorage()
    writePersistedState(storage, 'multivariate.groupBy', null)
    resetPersistedStateMemory()

    expect(readPersistedState<string | null>(storage, 'multivariate.groupBy', 'lithology')).toBeNull()
  })

  it('ignores a value saved under another scope', () => {
    const storage = memoryStorage()
    writePersistedState(storage, 'view3d.symbolBy', 'domain', 'handoff-1')

    expect(readPersistedState(storage, 'view3d.symbolBy', 'lithology', 'handoff-2')).toBeUndefined()
    expect(readPersistedState(storage, 'view3d.symbolBy', 'lithology', 'handoff-1')).toBe('domain')
  })

  it('ignores corrupt entries and values of another shape', () => {
    const storage = memoryStorage()
    storage.setItem(`${WORKSPACE_STATE_PREFIX}a`, '{not json')
    storage.setItem(`${WORKSPACE_STATE_PREFIX}b`, JSON.stringify({ s: '', v: 'text' }))

    expect(readPersistedState(storage, 'a', 1)).toBeUndefined()
    expect(readPersistedState(storage, 'b', 1)).toBeUndefined()
    expect(readPersistedState(storage, 'b', [] as string[])).toBeUndefined()
  })

  it('keeps oversized values for the session without writing them to storage', () => {
    const storage = memoryStorage()
    const large = 'x'.repeat(MAX_PERSISTED_CHARACTERS + 1)
    writePersistedState(storage, 'multivariate.activeRun', 'small')
    writePersistedState(storage, 'multivariate.activeRun', large)

    expect(storage.items.size).toBe(0)
    expect(readPersistedState(storage, 'multivariate.activeRun', '')).toBe(large)
    resetPersistedStateMemory()
    expect(readPersistedState(storage, 'multivariate.activeRun', '')).toBeUndefined()
  })

  it('keeps the value for the session when storage rejects the write', () => {
    const storage: PersistentStorage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => { throw new Error('quota exceeded') },
    }
    writePersistedState(storage, 'structure.pointSize', 2)

    expect(readPersistedState(storage, 'structure.pointSize', 1)).toBe(2)
  })

  it('clears a saved value', () => {
    const storage = memoryStorage()
    writePersistedState(storage, 'view3d.pose.0', { position: [1, 2, 3] })
    clearPersistedState(storage, 'view3d.pose.0')

    expect(readPersistedState(storage, 'view3d.pose.0', null)).toBeUndefined()
  })
})
