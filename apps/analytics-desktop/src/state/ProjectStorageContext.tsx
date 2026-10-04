import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { desktopBridge, type ProjectStorageAddress } from '../desktop/bridge.js'
import { useDesktopWorkspace } from '../desktop/DesktopWorkspaceContext.js'
import { useDataPoolWorkspace } from './DataPoolWorkspaceContext.js'
import type { PersistentStorage } from './persistentState.js'

export class MemoryProjectStorage implements PersistentStorage {
  readonly #values: Map<string, string>
  readonly #address: ProjectStorageAddress | null
  #pending: Promise<void> = Promise.resolve()
  #error: unknown = null
  #failed = new Map<string, () => Promise<void>>()
  readonly #report: (message: string | null) => void

  constructor(entries: Record<string, string>, address: ProjectStorageAddress | null, report: (message: string | null) => void = () => undefined) {
    this.#values = new Map(Object.entries(entries))
    this.#address = address
    this.#report = report
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
    const bridge = desktopBridge()
    if (bridge !== undefined && this.#address !== null) {
      const address = this.#address
      this.#queue(key, () => bridge.writeProjectDocument({ address, key, value }))
    }
  }

  removeItem(key: string): void {
    this.#values.delete(key)
    const bridge = desktopBridge()
    if (bridge !== undefined && this.#address !== null) {
      const address = this.#address
      this.#queue(key, () => bridge.removeProjectDocument({ address, key }))
    }
  }

  #queue(key: string, write: () => Promise<void>) {
    this.#pending = this.#pending.then(write).then(() => {
      this.#failed.delete(key)
      if (!this.#failed.size) { this.#error = null; this.#report(null) }
    }).catch(error => {
      this.#failed.set(key, write)
      this.#error = error
      this.#report('Some project changes could not be saved to disk. Keep this window open and check folder access and free space.')
    })
  }

  async flush() {
    await this.#pending
    for (const [key, write] of this.#failed) this.#queue(key, write)
    await this.#pending
    if (this.#error) throw this.#error
  }
}

interface ProjectStorageValue {
  ready: boolean
  storage: PersistentStorage
}

const fallbackStorage: PersistentStorage = {
  getItem: (key) => typeof window === 'undefined' ? null : window.localStorage.getItem(key),
  removeItem: (key) => { if (typeof window !== 'undefined') window.localStorage.removeItem(key) },
  setItem: (key, value) => { if (typeof window !== 'undefined') window.localStorage.setItem(key, value) },
}

const Context = createContext<ProjectStorageValue>({ ready: true, storage: fallbackStorage })
const nativeAddresses = new WeakMap<object, ProjectStorageAddress>()

export function ProjectStorageProvider({ children }: { children: ReactNode }) {
  const workspace = useDataPoolWorkspace()
  const desktop = useDesktopWorkspace()
  const address = workspace.storageAddress
  const identity = address === null
    ? 'none'
    : `${address.endpoint}\u0000${address.accountId ?? ''}\u0000${address.tenantId ?? ''}\u0000${address.projectId}`
  const [loaded, setLoaded] = useState<{ identity: string; storage: PersistentStorage } | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)

  useEffect(() => {
    const bridge = desktopBridge()
    if (bridge === undefined) {
      setLoaded({ identity, storage: fallbackStorage })
      return
    }
    if (!desktop.configured || address === null) {
      setLoaded({ identity, storage: new MemoryProjectStorage({}, null) })
      return
    }
    let active = true
    setStorageError(null)
    setLoaded(null)
    void bridge.readProjectDocuments(address).then((entries) => {
      if (active) {
        const storage = new MemoryProjectStorage(entries, address, message => { if (active) setStorageError(message) })
        nativeAddresses.set(storage, address)
        setLoaded({ identity, storage })
      }
    }).catch(() => { if (active) setStorageError('The project files could not be opened. Check folder access, then reopen the project.') })
    return () => { active = false }
  }, [address, desktop.configured, desktop.revision, identity])

  const value = useMemo<ProjectStorageValue>(() => ({
    ready: loaded?.identity === identity,
    storage: loaded?.identity === identity ? loaded.storage : new MemoryProjectStorage({}, null),
  }), [identity, loaded])

  if (!value.ready) return <div className="app-bootstrap-state" role="status">{storageError ?? 'Opening project files…'}</div>
  return <Context.Provider value={value}>{storageError ? <p className="pool-live-note is-error" role="alert">{storageError}</p> : null}{children}</Context.Provider>
}

export function useProjectStorage(): PersistentStorage {
  return useContext(Context).storage
}

export function projectStorageAddress(storage: object): ProjectStorageAddress | undefined {
  return nativeAddresses.get(storage)
}
