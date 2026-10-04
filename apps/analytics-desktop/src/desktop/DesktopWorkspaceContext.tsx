import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { desktopBridge, type DesktopWorkspaceStatus } from './bridge.js'

interface DesktopWorkspaceValue extends DesktopWorkspaceStatus {
  choosing: boolean
  isDesktop: boolean
  chooseRoot: () => Promise<void>
  revision: number
}

const browserStatus: DesktopWorkspaceValue = {
  appDataPath: '',
  choosing: false,
  chooseRoot: async () => undefined,
  configured: true,
  isDesktop: false,
  revision: 0,
  rootPath: null,
}

const Context = createContext<DesktopWorkspaceValue>(browserStatus)

export function DesktopWorkspaceProvider({ children }: { children: ReactNode }) {
  const bridge = desktopBridge()
  const [status, setStatus] = useState<DesktopWorkspaceStatus | null>(bridge === undefined ? browserStatus : null)
  const [choosing, setChoosing] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (bridge === undefined) return
    let active = true
    void bridge.workspaceStatus().then((next) => { if (active) setStatus(next) })
    return () => { active = false }
  }, [bridge])

  const chooseRoot = useCallback(async () => {
    if (bridge === undefined) return
    setChoosing(true)
    try {
      const next = await bridge.chooseWorkspaceRoot()
      if (next !== null) {
        setStatus(next)
        setRevision((value) => value + 1)
      }
    } finally {
      setChoosing(false)
    }
  }, [bridge])

  const value = useMemo<DesktopWorkspaceValue>(() => ({
    appDataPath: status?.appDataPath ?? '',
    choosing,
    chooseRoot,
    configured: status?.configured ?? false,
    isDesktop: bridge !== undefined,
    revision,
    rootPath: status?.rootPath ?? null,
  }), [bridge, chooseRoot, choosing, revision, status])

  if (status === null) return <div className="app-bootstrap-state">Opening the local GeoEye workspace…</div>
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useDesktopWorkspace(): DesktopWorkspaceValue {
  return useContext(Context)
}
