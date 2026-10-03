import { Settings } from 'lucide-react'
import type { ComponentType } from 'react'
import type { SectionId } from '../types.js'
import {
  DataPoolIcon,
  DomainIcon,
  ExploreIcon,
  GeotechIcon,
  GradeIcon,
  MultivariateIcon,
  StructureIcon,
  VariogramIcon,
  View3DIcon,
} from './GeoEyeIcons.js'

interface FeatureItem {
  activeSections?: readonly SectionId[]
  icon: ComponentType<{ className?: string; size?: number; strokeWidth?: number }>
  label: string
  target: SectionId
}

const features: FeatureItem[] = [
  { label: 'Data', icon: DataPoolIcon, target: 'data-pool', activeSections: ['data-pool', 'drillholes', 'field-logging', 'laboratory', 'strength', 'xrf', 'spectral'] },
  { label: 'Statistics', icon: ExploreIcon, target: 'explore' },
  { label: 'Multivariate', icon: MultivariateIcon, target: 'multivariate' },
  { label: 'Domain', icon: DomainIcon, target: 'domain' },
  { label: 'Grade', icon: GradeIcon, target: 'grade' },
  { label: 'Variography', icon: VariogramIcon, target: 'variography' },
  { label: 'Structure', icon: StructureIcon, target: 'structure' },
  { label: 'Geotech', icon: GeotechIcon, target: 'geotechnical' },
  { label: '3D Analysis', icon: View3DIcon, target: 'view-3d' },
]

interface SidebarProps {
  active: SectionId
  onNavigate: (section: SectionId) => void
  onOpenSettings: () => void
}

export function Sidebar({ active, onNavigate, onOpenSettings }: SidebarProps) {
  return (
    <aside className="sidebar">
      <button aria-label="Open project overview" className="brand" onClick={() => onNavigate('overview')} title="Project overview" type="button">
        <div className="brand-mark" aria-hidden="true">
          <img className="home-brand-icon" src="/astro-geo-home.png" alt="" />
        </div>
        <div className="brand-copy">
          <strong>GeoEye</strong>
          <span>Analytics</span>
        </div>
      </button>

      <nav className="primary-nav feature-nav" aria-label="GeoEye Analytics features">
        {features.map((feature) => {
          const Icon = feature.icon
          const isActive = feature.activeSections?.includes(active) ?? active === feature.target
          return (
            <button
              aria-current={isActive ? 'page' : undefined}
              aria-label={feature.label}
              className={`nav-item feature-nav-item ${isActive ? 'is-active' : ''}`}
              key={feature.target}
              onClick={() => onNavigate(feature.target)}
              type="button"
            >
              <span className="workspace-icon"><Icon className="geo-icon" size={20} strokeWidth={1.7} /></span>
              <span>{feature.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="workspace-usage">
          <div className="usage-heading">
            <span>Local workspace</span>
            <span>2.4 GB</span>
          </div>
          <div className="usage-track"><span style={{ width: '34%' }} /></div>
          <p>Snapshot updated 8 min ago</p>
        </div>
        <button className="nav-item" onClick={onOpenSettings} type="button">
          <Settings size={17} strokeWidth={1.9} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}
