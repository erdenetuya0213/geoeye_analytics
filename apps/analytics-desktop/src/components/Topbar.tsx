import { ChevronDown, LogIn, LogOut } from 'lucide-react'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
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
  const userName = workspace.session?.user.displayName ?? null
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
        <span className="project-selector" title="Demo workspace with sample data. Sign in to open a real project.">
          <span className="project-selector-mark" aria-hidden="true">DE</span>
          <span className="project-selector-item"><small>Demo workspace</small><strong>Sample data</strong></span>
        </span>
      )}

      <div className="topbar-actions">
        <ThemeSwitcher onChange={onThemeChange} theme={theme} />
        {workspace.live ? (
          <button
            aria-label={userName === null ? 'Sign out' : `Sign out ${userName}`}
            className="profile-button"
            onClick={workspace.signOut}
            title={userName === null
              ? 'Signed in. Click to sign out.'
              : `Signed in as ${workspace.session?.user.email ?? userName}. Click to sign out.`}
            type="button"
          >
            {userName === null ? null : <span className="profile-avatar">{initials(userName)}</span>}
            <span className="profile-name">{userName ?? 'Signed in'}</span>
            <LogOut size={14} />
          </button>
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
