import { desktopBridge, type DesktopCredential } from './bridge.js'

export interface StorageAdapter {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

class MemoryBackedStorage implements StorageAdapter {
  readonly #values = new Map<string, string>()
  readonly #write: (key: string, value: string) => void
  readonly #remove: (key: string) => void

  constructor(
    initial: Record<string, string>,
    write: (key: string, value: string) => void,
    remove: (key: string) => void,
  ) {
    Object.entries(initial).forEach(([key, value]) => this.#values.set(key, value))
    this.#write = write
    this.#remove = remove
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
    this.#write(key, value)
  }

  removeItem(key: string): void {
    this.#values.delete(key)
    this.#remove(key)
  }
}

let backingStorage: StorageAdapter | undefined
let storedCredential: DesktopCredential | null = null

export const appStorage: StorageAdapter = {
  getItem: (key) => backingStorage?.getItem(key) ?? null,
  setItem: (key, value) => backingStorage?.setItem(key, value),
  removeItem: (key) => backingStorage?.removeItem(key),
}

export async function initializeDesktopRuntime(): Promise<void> {
  const bridge = desktopBridge()
  if (bridge === undefined) {
    backingStorage = window.localStorage
    storedCredential = window.sessionStorage.getItem('geoeye.analytics.connection-token.v1') === null
      ? null
      : { token: window.sessionStorage.getItem('geoeye.analytics.connection-token.v1') ?? '' }
    return
  }

  const [entries, credential] = await Promise.all([
    bridge.readAppStorage(),
    bridge.loadCredential(),
  ])
  backingStorage = new MemoryBackedStorage(
    entries,
    (key, value) => { void bridge.writeAppStorage({ key, value }) },
    (key) => { void bridge.removeAppStorage(key) },
  )
  storedCredential = credential
}

export function readStoredCredential(): DesktopCredential | null {
  return storedCredential
}

export function saveStoredCredential(credential: DesktopCredential): void {
  storedCredential = credential
  const bridge = desktopBridge()
  if (bridge === undefined) {
    window.sessionStorage.setItem('geoeye.analytics.connection-token.v1', credential.token)
  } else {
    void bridge.saveCredential(credential)
  }
}

export function clearStoredCredential(): void {
  storedCredential = null
  const bridge = desktopBridge()
  if (bridge === undefined) {
    window.sessionStorage.removeItem('geoeye.analytics.connection-token.v1')
  } else {
    void bridge.clearCredential()
  }
}
