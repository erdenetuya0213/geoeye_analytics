import {
  BarChart3,
  ChevronDown,
  CircleSlash2,
  Cuboid,
  DatabaseZap,
  Eye,
  Filter,
  Layers3,
  MousePointer2,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import type { SectionId } from '../types.js'

interface NotLivePageProps {
  onNavigate: (section: SectionId) => void
  section: SectionId
}

interface FeatureShellDefinition {
  columns?: readonly string[]
  inspector: string
  kind: 'analysis' | 'records' | 'scene'
  stage: string
  title: string
}

const featureShells: Record<SectionId, FeatureShellDefinition> = {
  overview: { title: 'Project overview', stage: 'Project analytical trends', inspector: 'Validation summary', kind: 'analysis' },
  'data-pool': { title: 'Data Pool', stage: 'Project datasets', inspector: 'Dataset details', kind: 'records', columns: ['Dataset', 'Support', 'Records', 'Quality', 'Updated'] },
  drillholes: { title: 'Drillholes', stage: 'Drillhole records', inspector: 'Selected hole', kind: 'records', columns: ['Hole ID', 'Collar', 'Survey', 'Depth', 'Status'] },
  'field-logging': { title: 'Field logging', stage: 'Logging records', inspector: 'Record details', kind: 'records', columns: ['Hole ID', 'Depth', 'Log type', 'Geologist', 'Status'] },
  laboratory: { title: 'Laboratory', stage: 'Laboratory samples', inspector: 'Sample details', kind: 'records', columns: ['Sample ID', 'Hole ID', 'From', 'To', 'Result'] },
  strength: { title: 'Strength', stage: 'Strength test results', inspector: 'Test details', kind: 'records', columns: ['Sample ID', 'Hole ID', 'Depth', 'Test type', 'Result'] },
  xrf: { title: 'XRF', stage: 'XRF readings', inspector: 'Reading details', kind: 'records', columns: ['Reading', 'Hole ID', 'Depth', 'Element', 'Instrument'] },
  spectral: { title: 'Spectral', stage: 'Spectral scans', inspector: 'Scan details', kind: 'records', columns: ['Scan ID', 'Hole ID', 'Depth', 'Mineral', 'Score'] },
  'spatial-reference': { title: 'Spatial reference', stage: 'Project coordinate space', inspector: 'Coordinate system', kind: 'analysis' },
  explore: { title: 'Statistics', stage: 'Statistical analysis', inspector: 'Analysis settings', kind: 'analysis' },
  domain: { title: 'Domain', stage: 'Domain analysis', inspector: 'Domain definition', kind: 'analysis' },
  grade: { title: 'Grade', stage: 'Grade analysis', inspector: 'Grade settings', kind: 'analysis' },
  variography: { title: 'Variography', stage: 'Directional continuity', inspector: 'Variogram model', kind: 'analysis' },
  structure: { title: 'Structure', stage: 'Stereonet workspace', inspector: 'Joint sets', kind: 'analysis' },
  geotechnical: { title: 'Geotechnical', stage: 'Rock-mass classification', inspector: 'Classification settings', kind: 'analysis' },
  multivariate: { title: 'Multivariate', stage: 'Multivariate analysis', inspector: 'Analysis settings', kind: 'analysis' },
  'view-3d': { title: '3D Analysis', stage: '3D geological viewer', inspector: 'Display properties', kind: 'scene' },
}

interface EmptyDataMessageProps {
  onNavigate: (section: SectionId) => void
  projectName: string
  title: string
}

function EmptyDataMessage({ onNavigate, projectName, title }: EmptyDataMessageProps) {
  return (
    <div className="feature-empty-message" role="status">
      <span className="feature-empty-icon"><DatabaseZap size={24} /></span>
      <div>
        <strong>No project data for {title}</strong>
        <p>
          {projectName === '' ? 'The open project' : projectName} has no compatible data connected to this feature yet.
        </p>
      </div>
      <div className="feature-empty-actions">
        <button className="button button-primary" onClick={() => onNavigate('data-pool')} type="button">Open Data Pool</button>
        <button className="button button-secondary" onClick={() => onNavigate('drillholes')} type="button">Open Drillholes</button>
      </div>
    </div>
  )
}

function EmptySceneShell({ definition, onNavigate, projectName }: {
  definition: FeatureShellDefinition
  onNavigate: (section: SectionId) => void
  projectName: string
}) {
  const layerGroups = [
    { label: 'Drillholes', layers: ['Collars', 'Trajectories', 'Intervals'] },
    { label: 'Geology', layers: ['Lithology', 'Structures'] },
    { label: 'Reference', layers: ['Grid'] },
  ]

  return (
    <div className="page map2d-page scene3d-page feature-empty-scene">
      <h1 className="sr-only">{definition.title}</h1>
      <div className="map2d-workspace scene3d-workspace feature-empty-scene-workspace">
        <aside className="map2d-contents scene3d-contents">
          <div className="map2d-pane-title scene3d-layers-title">
            <div><Layers3 size={15} /><strong>Layers</strong></div>
          </div>
          <div className="map2d-layer-list scene3d-layer-tree">
            {layerGroups.map((group) => (
              <section className="scene3d-layer-group" key={group.label}>
                <header><button aria-expanded="true" disabled type="button"><ChevronDown size={11} /><strong>{group.label}</strong><span>0</span></button></header>
                {group.layers.map((layer) => (
                  <div className="map2d-layer is-empty" key={layer}>
                    <button aria-label={`Show ${layer}`} disabled type="button"><Eye size={13} /></button>
                    <span className="scene3d-layer-label"><strong>{layer}</strong><small>0 objects</small></span>
                    <span className="map2d-layer-menu">•••</span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </aside>

        <main className="scene3d-canvas feature-empty-scene-canvas">
          <div className="feature-empty-scene-grid" aria-hidden="true" />
          <div className="feature-empty-scene-tools" aria-label="3D viewer tools">
            <button aria-label="Select" disabled type="button"><MousePointer2 size={15} /></button>
            <button aria-label="Display properties" disabled type="button"><SlidersHorizontal size={15} /></button>
            <button aria-label="Fit scene" disabled type="button"><Cuboid size={15} /></button>
          </div>
          <EmptyDataMessage onNavigate={onNavigate} projectName={projectName} title={definition.title} />
        </main>
      </div>
      <footer className="map2d-statusbar scene3d-statusbar feature-empty-statusbar">
        <span>Ready</span><span>Isometric camera</span><span>Vertical 1.00×</span><span>0 visible · 0 selected</span>
      </footer>
    </div>
  )
}

function EmptyFeatureShell({ definition, onNavigate, projectName }: {
  definition: FeatureShellDefinition
  onNavigate: (section: SectionId) => void
  projectName: string
}) {
  const columns = definition.columns ?? ['Dataset', 'Variable', 'Method', 'Result', 'Status']

  return (
    <div className={`page feature-empty-page is-${definition.kind}`}>
      <h1 className="sr-only">{definition.title}</h1>
      <div className="filter-bar feature-empty-toolbar" aria-label={`${definition.title} controls`}>
        {definition.kind === 'records' ? (
          <label className="table-search">
            <Search size={16} />
            <input aria-label={`Search ${definition.title}`} disabled placeholder={`Search ${definition.title.toLowerCase()}…`} />
          </label>
        ) : (
          <button className="filter-button" disabled type="button"><BarChart3 size={15} /> Dataset: No data <ChevronDown size={13} /></button>
        )}
        <button className="filter-button" disabled type="button"><Filter size={15} /> All records</button>
        <button className="filter-button" disabled type="button"><SlidersHorizontal size={15} /> Options</button>
        <span className="result-count">0 records</span>
        <button className="button button-secondary" disabled type="button"><RefreshCw size={15} /> Refresh</button>
      </div>

      <div className="feature-empty-workspace">
        <section className="panel feature-empty-stage">
          <header className="panel-heading">
            <div><p className="eyebrow">{definition.title}</p><h2>{definition.stage}</h2></div>
            <span className="feature-empty-count">0 records</span>
          </header>
          <div className={`feature-empty-surface is-${definition.kind}`}>
            {definition.kind === 'records' ? (
              <div className="feature-empty-table-header" aria-hidden="true">
                {columns.map((column) => <span key={column}>{column}</span>)}
              </div>
            ) : (
              <div className="feature-empty-plot-frame" aria-hidden="true">
                <span /><span /><span /><span /><span />
              </div>
            )}
            <EmptyDataMessage onNavigate={onNavigate} projectName={projectName} title={definition.title} />
          </div>
        </section>

        <aside className="analysis-inspector feature-empty-inspector">
          <section className="panel">
            <header className="panel-heading compact-heading"><div><p className="eyebrow">Inspector</p><h2>{definition.inspector}</h2></div></header>
            <div className="feature-empty-inspector-fields">
              <div><span>Selection</span><strong>None</strong></div>
              <div><span>Records</span><strong>0</strong></div>
              <div><span>Status</span><strong>Awaiting data</strong></div>
            </div>
          </section>
          <section className="panel feature-empty-secondary-panel">
            <header className="panel-heading compact-heading"><div><p className="eyebrow">Project data</p><h2>Source</h2></div></header>
            <div><CircleSlash2 size={18} /><span>No compatible dataset</span></div>
          </section>
        </aside>
      </div>
    </div>
  )
}

/** Keeps the selected feature's workbench visible without exposing demo fixtures. */
export function NotLivePage({ onNavigate, section }: NotLivePageProps) {
  const projectName = useDataPoolWorkspace().project?.name ?? ''
  const definition = featureShells[section]
  return definition.kind === 'scene'
    ? <EmptySceneShell definition={definition} onNavigate={onNavigate} projectName={projectName} />
    : <EmptyFeatureShell definition={definition} onNavigate={onNavigate} projectName={projectName} />
}
