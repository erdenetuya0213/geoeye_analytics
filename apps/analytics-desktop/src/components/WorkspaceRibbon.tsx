import type { ComponentType } from 'react'
import { PlugZap } from 'lucide-react'
import type { SectionId } from '../types.js'
import {
  AssayIcon,
  DataPoolIcon,
  DrillholeIcon,
  FieldLoggingIcon,
  SpectralIcon,
  StrengthIcon,
  XrfIcon,
} from './GeoEyeIcons.js'

interface RibbonTool {
  icon: ComponentType<{ className?: string; size?: number }>
  label: string
  primary?: boolean
  section: SectionId
}

const dataRibbon = {
  id: 'data',
  label: 'Data',
  tools: [
    { label: 'Data Pool', icon: DataPoolIcon, primary: true, section: 'data-pool' },
    { label: 'Drillholes', icon: DrillholeIcon, primary: true, section: 'drillholes' },
    { label: 'Logging', icon: FieldLoggingIcon, primary: true, section: 'field-logging' },
    { label: 'Lab', icon: AssayIcon, primary: true, section: 'laboratory' },
    { label: 'Strength', icon: StrengthIcon, primary: true, section: 'strength' },
    { label: 'XRF', icon: XrfIcon, primary: true, section: 'xrf' },
    { label: 'Spectral', icon: SpectralIcon, primary: true, section: 'spectral' },
  ] satisfies RibbonTool[],
} as const

const dataSections: readonly SectionId[] = [
  'data-pool',
  'drillholes',
  'field-logging',
  'laboratory',
  'strength',
  'xrf',
  'spectral',
]

function groupForSection(section: SectionId) {
  if (dataSections.includes(section)) return dataRibbon
  return undefined
}

interface WorkspaceRibbonProps {
  active: SectionId
  onNavigate: (section: SectionId) => void
  onOpenConnection: () => void
}

export function WorkspaceRibbon({ active, onNavigate, onOpenConnection }: WorkspaceRibbonProps) {
  const group = groupForSection(active)
  if (group === undefined) return null
  const ribbonLabel = group.tools.find((tool) => tool.section === active)?.label ?? group.label

  return (
    <nav aria-label={`${ribbonLabel} tools`} className={`workspace-ribbon ribbon-${group.id}`}>
      <section className="ribbon-group">
        <div className="ribbon-tools">
          {group.tools.map((tool) => {
            const Icon = tool.icon
            const isActive = tool.primary === true && active === tool.section
            return (
              <button
                aria-pressed={isActive}
                className={`ribbon-tool ${isActive ? 'is-active' : ''}`}
                key={tool.label}
                onClick={() => onNavigate(tool.section)}
                title={tool.label}
                type="button"
              >
                <Icon className="geo-icon" size={22} />
                <span>{tool.label}</span>
              </button>
            )
          })}
        </div>
        <p>{ribbonLabel}</p>
      </section>
      {group.id === 'data' ? (
        <div className="ribbon-workspace-action">
          <button className="button button-secondary" onClick={onOpenConnection} title="Data Pool connection" type="button"><PlugZap size={14} /> Connection</button>
        </div>
      ) : null}
    </nav>
  )
}
