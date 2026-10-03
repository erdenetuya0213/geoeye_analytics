import type { ReactNode } from 'react'
import type { SectionId } from '../types.js'
import { Sidebar } from './Sidebar.js'
import { Topbar } from './Topbar.js'
import type { ThemeId } from './ThemeSwitcher.js'
import { WorkspaceRibbon } from './WorkspaceRibbon.js'
import type { ChartDesignId } from '../visualization/chartDesigns.js'

interface AppShellProps {
  active: SectionId
  chartDesign: ChartDesignId
  children: ReactNode
  onNavigate: (section: SectionId) => void
  onOpenConnection: () => void
  onOpenSettings: () => void
  onSignIn: () => void
  onThemeChange: (theme: ThemeId) => void
  theme: ThemeId
}

export function AppShell({
  active,
  chartDesign,
  children,
  onNavigate,
  onOpenConnection,
  onOpenSettings,
  onSignIn,
  onThemeChange,
  theme,
}: AppShellProps) {
  const ribbonSections: readonly SectionId[] = ['data-pool', 'drillholes', 'field-logging', 'laboratory', 'strength', 'xrf', 'spectral']
  const hasWorkspaceRibbon = ribbonSections.includes(active)

  return (
    <div className={`app-shell theme-geoeye-industrial ${theme} chart-design-${chartDesign}`}>
      <Sidebar active={active} onNavigate={onNavigate} onOpenSettings={onOpenSettings} />
      <div className={`app-content ${active === 'overview' ? 'is-home' : ''} ${active === 'view-3d' ? 'is-scene3d' : ''} ${hasWorkspaceRibbon ? '' : 'is-ribbonless'}`}>
        <Topbar onSignIn={onSignIn} onThemeChange={onThemeChange} theme={theme} />
        <WorkspaceRibbon active={active} onNavigate={onNavigate} onOpenConnection={onOpenConnection} />
        <main className="page-content">{children}</main>
      </div>
    </div>
  )
}
