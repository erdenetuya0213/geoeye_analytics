import { ChevronDown, LogIn, LogOut } from 'lucide-react'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { useOfflineLicense } from '../desktop/ActivationContext.js'
import { ThemeSwitcher } from './ThemeSwitcher.js'
import type { ThemeId } from './ThemeSwitcher.js'

interface TopbarProps {
  onSignIn: () => void
  onThemeChange: (theme: ThemeId) => void
  theme: ThemeId
}

function initials(name: string): string {
  const letters = name.split(/\s+/).filter(Boolean).map((word) => word[0] ?? '').join('')
  return (letters === '' ? '?' : letters).slice(0, 2).toUpperCase()
}

export function Topbar({ onSignIn, onThemeChange, theme }: TopbarProps) {
  const workspace = useDataPoolWorkspace()
  const license = useOfflineLicense()
  const userName = license?.email ?? workspace.session?.user.displayName ?? null
  const userEmail = license?.email ?? workspace.session?.user.email ?? null
  const userLabel = userName?.trim() || userEmail || 'Signed in'
  // Projects are grouped by the organization (tenant) that owns them.
  const organizations = [...new Set(workspace.projects.map((project) => project.organizationName ?? ''))]
    .sort((left, right) => left.localeCompare(right))

  return (
    <header className="topbar">
      {workspace.live ? (
        <label className="project-selector is-live" title="Switch project">
          <span className="project-selector-mark" aria-hidden="true">{initials(workspace.project?.name ?? '')}</span>
          <span className="project-selector-item">
            <small>{workspace.project?.organizationName ?? 'Project'}</small>
            <span className="project-selector-control">
              <select
                aria-label="Project"
                disabled={workspace.projects.length === 0}
                onChange={(event) => workspace.selectProject(event.target.value)}
                title={workspace.project?.name ?? 'Select project'}
                value={workspace.project?.id ?? ''}
              >
              {workspace.projects.length === 0 ? <option value="">{workspace.projectsLoading ? 'Loading…' : 'No projects'}</option> : null}
                {organizations.map((organization) => {
                  const options = workspace.projects
                    .filter((project) => (project.organizationName ?? '') === organization)
                    .map((project) => (
                      <option key={project.id} value={project.id}>{project.name}{project.isActive ? '' : ' (inactive)'}</option>
                    ))
                  return organizations.length === 1 && organization === ''
                    ? options
                    : <optgroup key={organization} label={organization === '' ? 'No organization' : organization}>{options}</optgroup>
                })}
              </select>
              <ChevronDown aria-hidden="true" className="project-selector-chevron" size={16} />
            </span>
          </span>
        </label>
      ) : (
        <span className="project-selector" title="No local project has been opened for this account.">
          <span className="project-selector-mark" aria-hidden="true">—</span>
          <span className="project-selector-item"><small>Local workspace</small><strong>No project open</strong></span>
        </span>
      )}

      <div className="topbar-actions">
        <ThemeSwitcher onChange={onThemeChange} theme={theme} />
        {license ? <span className="activation-expiry" title={`Activation expires ${new Date(license.expiresAt).toLocaleString()}`}>Valid until {new Date(license.expiresAt).toLocaleDateString()}</span> : null}
        {license !== null || workspace.connected ? (
          <div aria-label="Account" className="profile-controls" role="group">
            <span className="profile-button" title={userEmail === null ? userLabel : `Signed in as ${userEmail}`}>
              <span aria-hidden="true" className="profile-avatar">{initials(userLabel)}</span>
              <span className="profile-name">{userLabel}</span>
            </span>
            <button
              aria-label={userLabel === 'Signed in' ? 'Sign out' : `Sign out ${userLabel}`}
              className="icon-button profile-sign-out"
              onClick={workspace.signOut}
              title="Sign out"
              type="button"
            >
              <LogOut aria-hidden="true" size={16} />
            </button>
          </div>
        ) : (
          <button aria-label="Sign in to GeoEye Analytics" className="profile-button" onClick={onSignIn} type="button">
            <span className="profile-name">Sign in</span>
            <LogIn size={14} />
          </button>
        )}
      </div>
    </header>
  )
}
