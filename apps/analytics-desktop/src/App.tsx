import { useCallback, useEffect, useState } from 'react'
import { AppShell } from './components/AppShell.js'
import { ConnectionDialog } from './components/ConnectionDialog.js'
import type { ConnectionDialogMode } from './components/ConnectionDialog.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { SignOutDialog } from './components/SignOutDialog.js'
import { themes } from './components/ThemeSwitcher.js'
import type { ThemeId } from './components/ThemeSwitcher.js'
import { DataPoolPage } from './pages/DataPoolPage.js'
import { checkDataPoolConnection } from './data/dataPoolConnection.js'
import { demoWorkspaceAllowed } from './data/demoPolicy.js'
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
import { StereonetThemeProvider } from './state/StereonetThemeContext.js'
import type { ConnectionSettings, ConnectionState, SectionId } from './types.js'
import { DEFAULT_CHART_DESIGN, isChartDesignId, type ChartDesignId } from './visualization/chartDesigns.js'
import { addRecentSceneBackground, loadSceneBackgroundPreferences, normalizeSceneBackground, saveSceneBackgroundPreferences } from './visualization/sceneBackgrounds.js'
import { loadSceneTextPreferences, saveSceneTextPreferences, type SceneTextPreferences } from './visualization/sceneTextPreferences.js'
import { DEFAULT_STEREONET_THEME, isStereonetThemeId, type StereonetThemeId } from './visualization/stereonetThemes.js'

const connectionStorageKey = 'geoeye.analytics.connection.v1'
const connectionTokenStorageKey = 'geoeye.analytics.connection-token.v1'
const configuredEndpoint = import.meta.env.VITE_DATAPOOL_ENDPOINT?.trim()
const defaultConnection: ConnectionSettings = {
  version: 1,
  endpoint: configuredEndpoint === undefined || configuredEndpoint === '' ? '/api' : configuredEndpoint,
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
  const stored = window.localStorage.getItem(themeStorageKey)
  return themes.some((theme) => theme.id === stored) ? stored as ThemeId : 'theme-core-console'
}

function loadChartDesign(): ChartDesignId {
  const stored = window.localStorage.getItem(chartDesignStorageKey)
  return isChartDesignId(stored) ? stored : DEFAULT_CHART_DESIGN
}

function loadStereonetTheme(): StereonetThemeId {
  const stored = window.localStorage.getItem(stereonetThemeStorageKey)
  return isStereonetThemeId(stored) ? stored : DEFAULT_STEREONET_THEME
}

function loadConnection(): ConnectionSettings {
  try {
    const raw = window.localStorage.getItem(connectionStorageKey)
    if (raw === null) return defaultConnection
    const candidate = JSON.parse(raw) as Partial<ConnectionSettings>
    if (candidate.version !== 1 || typeof candidate.endpoint !== 'string') {
      return defaultConnection
    }
    // Access tokens are session-only. Rewriting also removes tokens persisted by older builds.
    window.localStorage.setItem(connectionStorageKey, JSON.stringify({ version: 1, endpoint: candidate.endpoint }))
    return {
      version: 1,
      endpoint: candidate.endpoint,
      token: window.sessionStorage.getItem(connectionTokenStorageKey) ?? '',
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
  const [section, setActiveSection] = useState<SectionId>(loadInitialSection)
  const [connectionSettings, setConnectionSettings] = useState<ConnectionSettings>(loadConnection)
  const [connectionState, setConnectionState] = useState<ConnectionState>('demo')
  const [theme, setTheme] = useState<ThemeId>(loadTheme)
  const [chartDesign, setChartDesign] = useState<ChartDesignId>(loadChartDesign)
  const [stereonetTheme, setStereonetTheme] = useState<StereonetThemeId>(loadStereonetTheme)
  const [sceneBackgroundPreferences, setSceneBackgroundPreferences] = useState(() => loadSceneBackgroundPreferences(window.localStorage))
  const [sceneTextPreferences, setSceneTextPreferences] = useState(() => loadSceneTextPreferences(window.localStorage))
  const [connectionDialogMode, setConnectionDialogMode] = useState<ConnectionDialogMode | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showSignOutConfirmation, setShowSignOutConfirmation] = useState(false)
  const sceneBackground = sceneBackgroundPreferences.color

  // Set when the user explicitly chooses the sample-data workspace (development only).
  const [preferDemo, setPreferDemo] = useState(false)

  useEffect(() => {
    if (preferDemo) {
      setConnectionState('demo')
      return undefined
    }
    // A Data Pool endpoint is not an authenticated session by itself. In
    // particular, do not let a public/open endpoint sign the user straight
    // back in after they explicitly removed their session token.
    if (connectionSettings.token === '') {
      setConnectionState('unavailable')
      return undefined
    }
    let active = true
    setConnectionState('checking')
    void checkDataPoolConnection(connectionSettings).then(
      () => { if (active) setConnectionState('connected') },
      () => { if (active) setConnectionState('unavailable') },
    )
    return () => { active = false }
  }, [connectionSettings, preferDemo])

  const signOut = useCallback(() => {
    setShowSignOutConfirmation(false)
    window.sessionStorage.removeItem(connectionTokenStorageKey)
    setPreferDemo(demoWorkspaceAllowed)
    setConnectionSettings((current) => current.token === '' ? current : { ...current, token: '' })
    setConnectionState(demoWorkspaceAllowed ? 'demo' : 'unavailable')
    // In demo-enabled builds the shell remains available, so explicitly show
    // the account form instead of leaving the user at an ambiguous connection
    // button. Production builds render the required sign-in gate below.
    setConnectionDialogMode('sign-in')
  }, [])

  const requestSignOut = useCallback(() => setShowSignOutConfirmation(true), [])
  const cancelSignOut = useCallback(() => setShowSignOutConfirmation(false), [])
  const confirmSignOut = useCallback(() => signOut(), [signOut])

  useEffect(() => {
    saveSceneBackgroundPreferences(window.localStorage, sceneBackgroundPreferences)
  }, [sceneBackgroundPreferences])

  useEffect(() => {
    saveSceneTextPreferences(window.localStorage, sceneTextPreferences)
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
    window.localStorage.setItem(themeStorageKey, nextTheme)
    setTheme(nextTheme)
  }

  const changeChartDesign = (nextDesign: ChartDesignId) => {
    window.localStorage.setItem(chartDesignStorageKey, nextDesign)
    setChartDesign(nextDesign)
  }

  const changeStereonetTheme = (nextTheme: StereonetThemeId) => {
    window.localStorage.setItem(stereonetThemeStorageKey, nextTheme)
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
    window.localStorage.setItem(
      connectionStorageKey,
      JSON.stringify({ version: settings.version, endpoint: settings.endpoint }),
    )
    if (settings.token === '') window.sessionStorage.removeItem(connectionTokenStorageKey)
    else window.sessionStorage.setItem(connectionTokenStorageKey, settings.token)
    setPreferDemo(state === 'demo')
    setConnectionSettings(settings)
    setConnectionState(state)
    setConnectionDialogMode(null)
  }

  const signedIn = connectionSettings.token !== '' && connectionState === 'connected'

  // Production builds have no sample-data workspace: without a session there is
  // nothing to show except the sign-in form.
  if (!demoWorkspaceAllowed && !signedIn) {
    return (
      <div className={`app-shell sign-in-gate theme-geoeye-industrial ${theme} chart-design-${chartDesign}`}>
        {connectionState === 'checking' ? null : (
          <ConnectionDialog initialSettings={connectionSettings} mode="sign-in" onClose={closeConnection} onSave={saveConnection} required />
        )}
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
    <DataPoolWorkspaceProvider
      connectionSettings={connectionSettings}
      connectionState={connectionState}
      onSessionExpired={signOut}
      onSignOut={requestSignOut}
    >
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
    </DataPoolWorkspaceProvider>
  )
}
