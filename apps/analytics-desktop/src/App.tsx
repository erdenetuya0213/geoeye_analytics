import { DataPoolError } from '@geoeye/datapool-client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell } from './components/AppShell.js'
import { ConnectionDialog } from './components/ConnectionDialog.js'
import type { ConnectionDialogMode } from './components/ConnectionDialog.js'
import { LoginPage } from './components/LoginPage.js'
import { desktopBridge, type OfflineLicense } from './desktop/bridge.js'
import { ActivationProvider } from './desktop/ActivationContext.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { SignOutDialog } from './components/SignOutDialog.js'
import { themes } from './components/ThemeSwitcher.js'
import type { ThemeId } from './components/ThemeSwitcher.js'
import { DataPoolPage } from './pages/DataPoolPage.js'
import { checkDataPoolConnection } from './data/dataPoolConnection.js'
import { appStorage, clearStoredCredential, readStoredCredential, saveStoredCredential } from './desktop/runtime.js'
import { DatasetToolPage } from './pages/DatasetToolPage.js'
import type { DatasetSection } from './pages/DatasetToolPage.js'
import { DomainPage } from './pages/DomainPage.js'
import { DrillholesPage } from './pages/DrillholesPage.js'
import { ExplorePage } from './pages/ExplorePage.js'
import { GeotechnicalPage } from './pages/GeotechnicalPage.js'
import { LoggingPage } from './pages/LoggingPage.js'
import { MultivariatePage } from './pages/MultivariatePage.js'
import { OverviewPage } from './pages/OverviewPage.js'
import { PlaceholderPage } from './pages/PlaceholderPage.js'
import { GeologicalAnalysis3DPage } from './pages/GeologicalAnalysis3DPage.js'
import { StructurePage } from './pages/StructurePage.js'
import { StrengthPage } from './pages/StrengthPage.js'
import { ChartDesignProvider } from './state/ChartDesignContext.js'
import { loadWorkspaceState, saveWorkspaceState } from './state/persistentState.js'
import { DataPoolWorkspaceProvider } from './state/DataPoolWorkspaceContext.js'
import { ProjectStorageProvider } from './state/ProjectStorageContext.js'
import { StereonetThemeProvider } from './state/StereonetThemeContext.js'
import type { ConnectionSettings, ConnectionState, SectionId } from './types.js'
import { DEFAULT_CHART_DESIGN, isChartDesignId, type ChartDesignId } from './visualization/chartDesigns.js'
import { addRecentSceneBackground, loadSceneBackgroundPreferences, normalizeSceneBackground, saveSceneBackgroundPreferences } from './visualization/sceneBackgrounds.js'
import { loadSceneTextPreferences, saveSceneTextPreferences, type SceneTextPreferences } from './visualization/sceneTextPreferences.js'
import { DEFAULT_STEREONET_THEME, isStereonetThemeId, type StereonetThemeId } from './visualization/stereonetThemes.js'

const connectionStorageKey = 'geoeye.analytics.connection.v1'
const configuredEndpoint = import.meta.env.VITE_DATAPOOL_ENDPOINT?.trim()
const defaultConnection: ConnectionSettings = {
  version: 1,
  endpoint: configuredEndpoint === undefined || configuredEndpoint === ''
    ? typeof window !== 'undefined' && window.geoeyeDesktop !== undefined ? '' : '/api'
    : configuredEndpoint,
  token: '',
}
const themeStorageKey = 'theme'
const chartDesignStorageKey = 'geoeye.analytics.chart-design.v1'
const stereonetThemeStorageKey = 'geoeye.analytics.stereonet-theme.v1'
const sectionStateKey = 'app.section'
const datasetSections: readonly DatasetSection[] = ['laboratory', 'xrf', 'spectral']

function isDatasetSection(section: SectionId): section is DatasetSection {
  return datasetSections.includes(section as DatasetSection)
}

function loadTheme(): ThemeId {
  const stored = appStorage.getItem(themeStorageKey)
  return themes.some((theme) => theme.id === stored) ? stored as ThemeId : 'theme-core-console'
}

function loadChartDesign(): ChartDesignId {
  const stored = appStorage.getItem(chartDesignStorageKey)
  return isChartDesignId(stored) ? stored : DEFAULT_CHART_DESIGN
}

function loadStereonetTheme(): StereonetThemeId {
  const stored = appStorage.getItem(stereonetThemeStorageKey)
  return isStereonetThemeId(stored) ? stored : DEFAULT_STEREONET_THEME
}

function loadConnection(): ConnectionSettings {
  try {
    const raw = appStorage.getItem(connectionStorageKey)
    if (raw === null) return defaultConnection
    const candidate = JSON.parse(raw) as Partial<ConnectionSettings>
    if (candidate.version !== 1 || typeof candidate.endpoint !== 'string') {
      return defaultConnection
    }
    const endpoint = candidate.endpoint.trim().replace(/\/+$/, '')
    if (typeof window !== 'undefined' && window.geoeyeDesktop !== undefined) {
      try {
        const url = new URL(endpoint)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported protocol')
      } catch {
        clearStoredCredential()
        return defaultConnection
      }
    }
    // Tokens live in Windows-protected storage, not the general settings file.
    appStorage.setItem(connectionStorageKey, JSON.stringify({ version: 1, endpoint }))
    const credential = readStoredCredential()
    return {
      version: 1,
      endpoint,
      token: credential?.token ?? '',
      ...(credential?.accountId === undefined ? {} : { accountId: credential.accountId }),
    }
  } catch {
    return defaultConnection
  }
}

function loadInitialSection(): SectionId {
  const rawRequested = new URLSearchParams(window.location.search).get('section')
  const requested = (rawRequested === 'view-2d' ? 'view-3d' : rawRequested) as SectionId | null
  const sections: readonly SectionId[] = ['overview', 'data-pool', 'drillholes', 'field-logging', 'laboratory', 'strength', 'xrf', 'spectral', 'spatial-reference', 'explore', 'domain', 'grade', 'variography', 'structure', 'geotechnical', 'multivariate', 'view-3d']
  if (requested !== null && sections.includes(requested)) return requested
  const saved = loadWorkspaceState<SectionId>(sectionStateKey, 'data-pool')
  return saved !== undefined && sections.includes(saved) ? saved : 'data-pool'
}

export function App() {
  const [license, setLicense] = useState<OfflineLicense | null>(null)
  const [activationLoading, setActivationLoading] = useState(true)
  const [activationError, setActivationError] = useState<string | null>(null)
  const activationRequest = useRef(0)
  const [section, setActiveSection] = useState<SectionId>(loadInitialSection)
  const [connectionSettings, setConnectionSettings] = useState<ConnectionSettings>(loadConnection)
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking')
  const [theme, setTheme] = useState<ThemeId>(loadTheme)
  const [chartDesign, setChartDesign] = useState<ChartDesignId>(loadChartDesign)
  const [stereonetTheme, setStereonetTheme] = useState<StereonetThemeId>(loadStereonetTheme)
  const [sceneBackgroundPreferences, setSceneBackgroundPreferences] = useState(() => loadSceneBackgroundPreferences(appStorage))
  const [sceneTextPreferences, setSceneTextPreferences] = useState(() => loadSceneTextPreferences(appStorage))
  const [connectionDialogMode, setConnectionDialogMode] = useState<ConnectionDialogMode | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showSignOutConfirmation, setShowSignOutConfirmation] = useState(false)
  const sceneBackground = sceneBackgroundPreferences.color

  const acceptActivation = (value: OfflineLicense) => {
    activationRequest.current += 1
    setLicense(value)
    setActivationError(null)
    setActivationLoading(false)
  }

  useEffect(() => {
    let active = true
    const refresh = async () => {
      const request = ++activationRequest.current
      try {
        const result = await desktopBridge()?.activationStatus()
        if (!active || request !== activationRequest.current) return
        setLicense(result?.license ?? null)
        setActivationError(result?.error ?? null)
      } catch {
        if (!active || request !== activationRequest.current) return
        setLicense(null)
        setActivationError('The saved activation could not be verified. Enter your key again.')
      } finally {
        if (active && request === activationRequest.current) setActivationLoading(false)
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 60_000)
    const onResume = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', onResume)
    document.addEventListener('visibilitychange', onResume)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', onResume)
      document.removeEventListener('visibilitychange', onResume)
    }
  }, [])

  useEffect(() => {
    if (license === null) return
    const remaining = Date.parse(license.expiresAt) - Date.now()
    if (remaining > 2_147_483_647) return // Periodic checks cover long-lived licenses.
    const timer = window.setTimeout(() => {
      activationRequest.current += 1
      setLicense(null)
      setActivationError('Your activation key has expired. Enter a renewed key to continue.')
    }, Math.max(0, remaining))
    return () => window.clearTimeout(timer)
  }, [license])

  useEffect(() => {
    if (license === null) return
    let active = true
    void desktopBridge()?.databaseConfiguration().then((configuration) => {
      if (active && configuration !== null) {
        setConnectionSettings({ version: 1, endpoint: configuration.endpoint, accountId: configuration.accountId, managed: true, token: '' })
      }
    }).catch(() => { if (active) setConnectionState('unavailable') })
    return () => { active = false }
  }, [license?.accountId])

  useEffect(() => {
    // A Data Pool endpoint is not an authenticated session by itself. In
    // particular, do not let a public/open endpoint sign the user straight
    // back in after they explicitly removed their session token.
    if (license === null || (connectionSettings.token === '' && !connectionSettings.managed)) {
      setConnectionState('unavailable')
      return undefined
    }
    let active = true
    setConnectionState('checking')
    void checkDataPoolConnection(connectionSettings).then(
      () => { if (active) setConnectionState('connected') },
      (error) => {
        if (!active) return
        if (error instanceof DataPoolError && error.status === 401) {
          clearStoredCredential()
          setConnectionSettings((current) => ({ ...current, token: '' }))
        }
        setConnectionState('unavailable')
      },
    )
    return () => { active = false }
  }, [connectionSettings, license?.accountId])

  const disconnectDatabase = useCallback(() => {
    setShowSignOutConfirmation(false)
    clearStoredCredential()
    setConnectionSettings((current) => current.token === '' ? current : { ...current, token: '' })
    setConnectionState('unavailable')
  }, [])

  const signOut = useCallback(async () => {
    activationRequest.current += 1
    try {
      await desktopBridge()?.logoutActivation()
      activationRequest.current += 1
      disconnectDatabase()
      setConnectionSettings((current) => ({ version: 1, endpoint: current.endpoint, token: '' }))
      setLicense(null)
      setActivationError(null)
    } catch {
      setActivationError('Sign out could not be saved. Please try again.')
    }
  }, [disconnectDatabase])

  const requestSignOut = useCallback(() => setShowSignOutConfirmation(true), [])
  const cancelSignOut = useCallback(() => setShowSignOutConfirmation(false), [])
  const confirmSignOut = useCallback(() => { void signOut() }, [signOut])

  useEffect(() => {
    saveSceneBackgroundPreferences(appStorage, sceneBackgroundPreferences)
  }, [sceneBackgroundPreferences])

  useEffect(() => {
    saveSceneTextPreferences(appStorage, sceneTextPreferences)
  }, [sceneTextPreferences])

  const setSection = useCallback((next: SectionId) => {
    saveWorkspaceState(sectionStateKey, next)
    // Keep a deep link in step with navigation so a reload reopens the section that was left open.
    const url = new URL(window.location.href)
    if (url.searchParams.has('section') && url.searchParams.get('section') !== next) {
      url.searchParams.set('section', next)
      window.history.replaceState({}, '', url)
    }
    setActiveSection(next)
  }, [])

  const closeConnection = useCallback(() => setConnectionDialogMode(null), [])
  const closeSettings = useCallback(() => setShowSettings(false), [])

  const changeTheme = (nextTheme: ThemeId) => {
    appStorage.setItem(themeStorageKey, nextTheme)
    setTheme(nextTheme)
  }

  const changeChartDesign = (nextDesign: ChartDesignId) => {
    appStorage.setItem(chartDesignStorageKey, nextDesign)
    setChartDesign(nextDesign)
  }

  const changeStereonetTheme = (nextTheme: StereonetThemeId) => {
    appStorage.setItem(stereonetThemeStorageKey, nextTheme)
    setStereonetTheme(nextTheme)
  }

  const changeSceneBackground = useCallback((color: string) => {
    const normalized = normalizeSceneBackground(color)
    if (normalized === null) return
    setSceneBackgroundPreferences((current) => ({
      color: normalized,
      recentColors: addRecentSceneBackground(current.recentColors, normalized),
    }))
  }, [])

  const changeSceneText = useCallback((preferences: SceneTextPreferences) => {
    setSceneTextPreferences(preferences)
  }, [])

  const saveConnection = (settings: ConnectionSettings, state: ConnectionState) => {
    appStorage.setItem(
      connectionStorageKey,
      JSON.stringify({ version: settings.version, endpoint: settings.endpoint }),
    )
    if (settings.token === '') clearStoredCredential()
    else saveStoredCredential({ token: settings.token, ...(settings.accountId === undefined ? {} : { accountId: settings.accountId }) })
    setConnectionSettings(settings)
    setConnectionState(state)
    setConnectionDialogMode(null)
  }

  if (activationLoading) return <div className="app-bootstrap-state">Checking offline activation…</div>
  if (license === null) {
    return (
      <div className={`login-theme-surface theme-geoeye-industrial ${theme} chart-design-${chartDesign}`}>
        <LoginPage initialError={activationError} onActivated={acceptActivation} />
      </div>
    )
  }

  let page
  if (section === 'overview') {
    page = <OverviewPage onNavigate={setSection} />
  } else if (section === 'data-pool') {
    page = <DataPoolPage connectionSettings={connectionSettings} connectionState={connectionState} />
  } else if (section === 'drillholes') {
    page = <DrillholesPage />
  } else if (section === 'field-logging') {
    page = <LoggingPage />
  } else if (section === 'strength') {
    page = <StrengthPage />
  } else if (isDatasetSection(section)) {
    page = <DatasetToolPage section={section} />
  } else if (section === 'explore') {
    page = <ExplorePage />
  } else if (section === 'structure') {
    page = <StructurePage />
  } else if (section === 'geotechnical') {
    page = <GeotechnicalPage onNavigate={setSection} />
  } else if (section === 'view-3d') {
    page = <GeologicalAnalysis3DPage backgroundColor={sceneBackground} onBackgroundColorChange={changeSceneBackground} screenText={sceneTextPreferences} />
  } else if (section === 'multivariate') {
    page = <MultivariatePage onNavigate={setSection} />
  } else if (section === 'domain') {
    page = <DomainPage onNavigate={setSection} />
  } else {
    page = <PlaceholderPage section={section} />
  }

  return (
    <ActivationProvider license={license}>
    <DataPoolWorkspaceProvider
      key={`${license.accountId}:${connectionSettings.accountId ?? 'local'}:${connectionSettings.endpoint}`}
      connectionSettings={connectionSettings}
      connectionState={connectionState}
      onSessionExpired={disconnectDatabase}
      onSignOut={requestSignOut}
    >
      <ProjectStorageProvider>
        {activationError ? <div role="alert">{activationError}</div> : null}
        <StereonetThemeProvider themeId={stereonetTheme}>
          <ChartDesignProvider designId={chartDesign}>
            <AppShell
              active={section}
              chartDesign={chartDesign}
              onNavigate={setSection}
              onOpenConnection={() => setConnectionDialogMode('connection')}
              onOpenSettings={() => setShowSettings(true)}
              onSignIn={() => setConnectionDialogMode('sign-in')}
              onThemeChange={changeTheme}
              theme={theme}
            >
              {page}
            </AppShell>
          </ChartDesignProvider>
        </StereonetThemeProvider>
        {connectionDialogMode !== null ? (
          <ConnectionDialog
            initialSettings={connectionSettings}
            mode={connectionDialogMode}
            onClose={closeConnection}
            onSave={saveConnection}
          />
        ) : null}
        {showSettings ? <div className={`settings-theme-surface theme-geoeye-industrial ${theme}`}><SettingsDialog chartDesign={chartDesign} onChartDesignChange={changeChartDesign} onClose={closeSettings} onSceneBackgroundChange={changeSceneBackground} onSceneTextChange={changeSceneText} onStereonetThemeChange={changeStereonetTheme} sceneBackground={sceneBackground} sceneBackgroundHistory={sceneBackgroundPreferences.recentColors} sceneText={sceneTextPreferences} stereonetTheme={stereonetTheme} /></div> : null}
        {showSignOutConfirmation ? <SignOutDialog onCancel={cancelSignOut} onConfirm={confirmSignOut} /> : null}
      </ProjectStorageProvider>
    </DataPoolWorkspaceProvider>
    </ActivationProvider>
  )
}
