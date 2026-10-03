import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

export interface PersistentStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export const WORKSPACE_STATE_PREFIX = 'geoeye.analytics.workspace-state.v1.'
/** Larger values (analysis runs) stay in memory so they cannot exhaust the storage shared with saved results. */
export const MAX_PERSISTED_CHARACTERS = 1_000_000

const SET_TAG = '__geoeyeSet'

interface StoredEntry {
  /** Scope the value was saved under; a different scope on read discards the value. */
  s: string
  v: unknown
}

// Survives page navigation inside one session even when browser storage is unavailable or the value is too large.
const memory = new Map<string, StoredEntry>()

function replacer(_key: string, value: unknown) {
  return value instanceof Set ? { [SET_TAG]: [...value] } : value
}

function reviver(_key: string, value: unknown) {
  if (typeof value === 'object' && value !== null && SET_TAG in value) {
    const items = (value as Record<string, unknown>)[SET_TAG]
    if (Array.isArray(items)) return new Set(items)
  }
  return value
}

function sameShape(value: unknown, fallback: unknown) {
  // Null is only ever saved by a state that allows it, so it is always restorable.
  if (fallback === null || fallback === undefined || value === null) return true
  if (fallback instanceof Set) return value instanceof Set
  if (Array.isArray(fallback)) return Array.isArray(value)
  if (typeof fallback === 'object') return typeof value === 'object' && !Array.isArray(value) && !(value instanceof Set)
  return typeof value === typeof fallback
}

function browserStorage(): PersistentStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/** Returns the saved value, or `undefined` when nothing usable was saved for this key and scope. */
export function readPersistedState<T>(storage: PersistentStorage | undefined, key: string, fallback: T, scope = ''): T | undefined {
  let entry = memory.get(key)
  if (entry === undefined && storage !== undefined) {
    try {
      const raw = storage.getItem(WORKSPACE_STATE_PREFIX + key)
      const parsed = raw === null ? null : JSON.parse(raw, reviver) as Partial<StoredEntry> | null
      if (typeof parsed === 'object' && parsed !== null && typeof parsed.s === 'string' && 'v' in parsed) {
        entry = { s: parsed.s, v: parsed.v }
        memory.set(key, entry)
      }
    } catch {
      entry = undefined
    }
  }
  if (entry === undefined || entry.s !== scope || !sameShape(entry.v, fallback)) return undefined
  return entry.v as T
}

export function writePersistedState(storage: PersistentStorage | undefined, key: string, value: unknown, scope = '') {
  memory.set(key, { s: scope, v: value })
  if (storage === undefined) return
  try {
    const serialized = JSON.stringify({ s: scope, v: value }, replacer)
    if (serialized.length > MAX_PERSISTED_CHARACTERS) storage.removeItem(WORKSPACE_STATE_PREFIX + key)
    else storage.setItem(WORKSPACE_STATE_PREFIX + key, serialized)
  } catch {
    // The value stays available for this session when browser storage is unavailable or full.
  }
}

export function clearPersistedState(storage: PersistentStorage | undefined, key: string) {
  memory.delete(key)
  try { storage?.removeItem(WORKSPACE_STATE_PREFIX + key) } catch { /* Nothing was stored. */ }
}

/** Test hook: forgets the in-memory copies so reads fall through to storage. */
export function resetPersistedStateMemory() {
  memory.clear()
}

export function loadWorkspaceState<T>(key: string, fallback: T, scope = '') {
  return readPersistedState(browserStorage(), key, fallback, scope)
}

export function saveWorkspaceState(key: string, value: unknown, scope = '') {
  writePersistedState(browserStorage(), key, value, scope)
}

export function clearWorkspaceState(key: string) {
  clearPersistedState(browserStorage(), key)
}

interface PersistentStateOptions {
  /**
   * Identity of whatever the saved value belongs to (a project, a handoff, …).
   * A value saved under another scope is ignored and the initial value is used.
   */
  scope?: string
}

/**
 * Drop-in `useState` whose value is restored after navigating away or reloading.
 * Supports JSON values and `Set`s. Keys are namespaced per page, e.g. `explore.datasetId`.
 */
export function usePersistentState<T>(
  key: string,
  initial: T | (() => T),
  options: PersistentStateOptions = {},
): [T, Dispatch<SetStateAction<T>>] {
  const scope = options.scope ?? ''
  const identity = `${scope}\u0000${key}`
  const load = () => {
    const fallback = typeof initial === 'function' ? (initial as () => T)() : initial
    const saved = loadWorkspaceState(key, fallback, scope)
    return { identity, value: saved === undefined ? fallback : saved }
  }
  const [state, setState] = useState(load)
  // What storage already holds, so defaults and freshly restored values are not written back.
  const stored = useRef(state)
  // A reused component instance can switch key or scope (e.g. one page serving several sections).
  const current = state.identity === identity ? state : load()
  if (current !== state) {
    stored.current = current
    setState(current)
  }

  const latest = useRef(current)
  latest.current = current

  useEffect(() => {
    if (stored.current.identity === current.identity && Object.is(stored.current.value, current.value)) return
    stored.current = current
    saveWorkspaceState(key, current.value, scope)
  }, [current, key, scope])

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setState((previous) => {
      const base = previous.identity === latest.current.identity ? previous : latest.current
      const value = typeof action === 'function' ? (action as (value: T) => T)(base.value) : action
      return Object.is(value, base.value) ? base : { identity: base.identity, value }
    })
  }, [])

  return [current.value, setValue]
}
