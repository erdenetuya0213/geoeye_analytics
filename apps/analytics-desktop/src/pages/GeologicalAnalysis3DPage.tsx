import {
  Axis3d, ChevronDown, ChevronLeft, ChevronRight, Crosshair, Cuboid, Eye, Hash,
  EyeOff, Filter, Focus, Grid3X3, Image as ImageIcon, Layers3, Maximize2,
  Minimize2, MousePointer2, PanelLeftClose, Pentagon, Rotate3d, Ruler, Save,
  SlidersHorizontal, Sparkles, Spline, Tag, Type, X,
} from 'lucide-react'
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { EdaObservation } from '../analysis/eda.js'
import type { Scene3DHole, Scene3DStructure } from '../components/GeoEyeScene3D.js'
import type { SceneGridDensity } from '../visualization/scene3dThreeMath.js'
import { readDrillholeImport } from '../data/drillholeImportStore.js'
import { readAnalysisResultDocument, type AnalysisResultPackage } from '../data/analysisResultStore.js'
import { useProjectEdaDatasets } from '../data/liveEda.js'
import { readSpatialViewRequest } from '../data/spatialViewStore.js'
import { useGeoEyeSelection } from '../state/SelectionContext.js'
import { sceneCollarRenderPoint, sceneElevation, type SceneBounds, type SceneViewMode } from '../visualization/scene3dProjection.js'
import { compileSceneQuery } from '../visualization/scene3dQuery.js'
import type { SceneTextPreferences } from '../visualization/sceneTextPreferences.js'
import {
  clampSceneSplitRatio,
  parseSceneSplitLayout,
  type ScenePaneCount,
  type SceneSplitAxis,
  type SceneSplitLayout,
} from '../visualization/sceneSplitLayout.js'
import {
  buildSceneColorScale,
  buildSceneLayers,
  sceneLayerColorField,
  scenePaneView,
  scenePaneViewKey,
  withScenePaneColor,
  withScenePaneLayers,
  type SceneLayer,
  type ScenePaneView,
  type ScenePaneViews,
} from '../visualization/sceneLayers.js'
import {
  SCENE_VIEWPORT_CONTENT_STORAGE_KEY,
  SCENE_GRAPH_DRAG_TYPE,
  graphViewportPane,
  parseGraphDrag,
  parseSceneViewportContents,
  resolveViewportGraph,
  serializeGraphDrag,
  type SceneViewportContents,
} from '../visualization/sceneViewportContent.js'
import { usePersistentState } from '../state/persistentState.js'
import { useProjectStorage } from '../state/ProjectStorageContext.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { desktopBridge } from '../desktop/bridge.js'
import {
  anchoredSelection,
  createSavedSceneSelection,
  extractStructureObservations,
  sectionCorridorState,
  sourceObservationIds,
  uniqueSourceObservationIds,
} from '../visualization/scene3dAnalysis.js'

const GeoEyeScene3D = lazy(() => import('../components/GeoEyeScene3D.js'))

type CameraMode = SceneViewMode | 'section'
type ViewportCamera = CameraMode | 'east' | 'north'
type SceneTool = 'pick' | 'rectangle' | 'lasso'
type ToolGroup = 'layout' | 'measurements' | 'selection' | 'grid' | 'axis' | null
type Panel = 'display' | 'legend' | 'query' | 'section' | null
type Classification = 'continuous' | 'equal' | 'quantile' | 'custom' | 'categorical'
type LayerGroup = 'Drilling' | 'Geology' | 'Geotech' | 'Structure' | 'Analytics'

interface GeologicalAnalysis3DPageProps {
  backgroundColor: string
  onBackgroundColorChange: (color: string) => void
  screenText: SceneTextPreferences
}
type Layer = SceneLayer
interface SectionDefinition {
  azimuth: number; back: number; centreX: number | null; centreY: number | null; centreZ: number | null
  clip: boolean; corridor: number; dip: number; front: number
  preset: 'plan' | 'north-south' | 'east-west' | 'custom'; visible: boolean
}
const groupOrder: LayerGroup[] = ['Drilling', 'Geology', 'Geotech', 'Structure', 'Analytics']
const palette = ['#315f78', '#3d8390', '#62a181', '#c2b559', '#e67840']
const categoryPalette = ['#6f91b8', '#dc8748', '#5fa487', '#a67eb2', '#d0b455', '#4fa2b1', '#b96d73', '#839664']
const sceneSelectionStorageKey = 'geoeye.analytics.scene-selections.v1'
const sceneLayoutStorageKey = 'geoeye.analytics.scene-layout.v1'

const dispatchViewportCameras: readonly ViewportCamera[] = ['plan', 'isometric', 'north', 'east']
const viewportLabel = (index: number) => `Viewport ${index + 1}`

function SceneLayoutIcon({ count }: { count: ScenePaneCount }) {
  return <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 20 20" width="18">
    <rect height="15" rx="1.5" width="15" x="2.5" y="2.5" />
    {count > 1 ? <path d="M10 3v14" /> : null}
    {count === 3 ? <path d="M10 10h7" /> : null}
    {count === 4 ? <path d="M3 10h14" /> : null}
  </svg>
}

function ToolboxStateIcon({ open }: { open: boolean }) {
  return <svg aria-hidden="true" className="scene3d-toolbox-state-icon" fill="none" height="19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" viewBox="0 0 24 24" width="19">
    {open ? <>
      <path d="M7.8 5.2V4.6c0-.9.7-1.6 1.6-1.6h5.2c.9 0 1.6.7 1.6 1.6" />
      <path d="M4.3 9.7 6.2 4.9l12.3-1.1 1.4 4.7Z" fill="currentColor" fillOpacity=".14" />
      <path d="M4.3 9.7 6.2 4.9l12.3-1.1 1.4 4.7" />
      <path d="M4 10h16.2c.7 0 1.3.6 1.2 1.4l-.9 7.4c-.1 1.2-1.1 2.2-2.4 2.2H5.9c-1.2 0-2.3-.9-2.4-2.2l-.8-7.4C2.6 10.6 3.2 10 4 10Z" fill="currentColor" fillOpacity=".1" />
      <path d="M3 13h18" />
      <path d="M10.3 11.8h3.4v2.6h-3.4z" fill="currentColor" fillOpacity=".24" />
    </> : <>
      <path d="M8 7.5V5.7C8 4.8 8.8 4 9.7 4h4.6c.9 0 1.7.8 1.7 1.7v1.8" />
      <rect fill="currentColor" fillOpacity=".12" height="13.5" rx="2.2" width="19" x="2.5" y="7.5" />
      <path d="M2.8 12.2h18.4" />
      <path d="M10.2 10.9h3.6v2.8h-3.6z" fill="currentColor" fillOpacity=".26" />
    </>}
  </svg>
}

interface ScenePaneToolboxProps {
  active: boolean
  axesVisible: boolean
  axisNumbersVisible: boolean
  axisTitlesVisible: boolean
  gizmoVisible: boolean
  gridCoordinatesVisible: boolean
  gridDensity: SceneGridDensity
  gridVisible: boolean
  index: number
  isolate: boolean
  layoutCount: ScenePaneCount
  layoutFocused: boolean
  panel: Panel
  selectedCount: number
  tool: SceneTool
  onAxesChange: (visible: boolean) => void
  onAxisNumbersChange: (visible: boolean) => void
  onAxisTitlesChange: (visible: boolean) => void
  onGizmoChange: (visible: boolean) => void
  onGridCoordinatesChange: (visible: boolean) => void
  onGridChange: (visible: boolean) => void
  onGridDensityChange: (density: SceneGridDensity) => void
  onIsolateChange: (isolated: boolean) => void
  onLayoutChange: (count: ScenePaneCount) => void
  onSectionToggle: () => void
  onToolChange: (tool: SceneTool) => void
}

function ScenePaneToolbox(props: ScenePaneToolboxProps) {
  const [expanded, setExpanded] = usePersistentState(`view3d.toolbox.${props.index}.expanded`, props.index === 0)
  const [openGroup, setOpenGroup] = usePersistentState<ToolGroup>(`view3d.toolbox.${props.index}.openGroup`, props.index === 0 ? 'selection' : null)
  const toolboxRef = useRef<HTMLDivElement>(null)
  const toggleGroup = (group: Exclude<ToolGroup, null>) => setOpenGroup((current) => current === group ? null : group)
  const close = () => { setExpanded(false); setOpenGroup(null) }

  useEffect(() => {
    if (openGroup === null) return
    const collapseOpenGroup = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (target instanceof Node && toolboxRef.current?.contains(target)) return
      setOpenGroup(null)
    }
    document.addEventListener('pointerdown', collapseOpenGroup, true)
    return () => document.removeEventListener('pointerdown', collapseOpenGroup, true)
  }, [openGroup])

  return <div
    aria-disabled={!props.active}
    aria-label={`${viewportLabel(props.index)} toolbox`}
    className={`scene3d-tool-rail${expanded ? ' is-expanded' : ''}${props.active ? '' : ' is-locked'}`}
    data-pane={props.index}
    ref={toolboxRef}
    role="toolbar"
  >
    <button
      aria-expanded={expanded}
      aria-label={expanded ? `Close ${viewportLabel(props.index)} toolbox` : `Open ${viewportLabel(props.index)} toolbox`}
      className="scene3d-tool-toggle"
      onClick={() => expanded ? close() : setExpanded(true)}
      type="button"
    ><ToolboxStateIcon open={expanded} /></button>
    {expanded ? <>
      <div className={`scene3d-tool-group${openGroup === 'layout' ? ' is-open' : ''}`}>
        <button aria-expanded={openGroup === 'layout'} aria-label="Split screen layout" className={props.layoutCount > 1 ? 'is-active' : ''} onClick={() => toggleGroup('layout')} type="button"><SceneLayoutIcon count={props.layoutCount} /></button>
        {openGroup === 'layout' ? <div aria-label="Split screen" className="scene3d-tool-flyout" role="menu">
          {([1, 2, 3, 4] as const).map((count) => <button
            aria-label={`${count} pane${count === 1 ? '' : 's'}`}
            aria-pressed={props.layoutCount === count && !props.layoutFocused}
            className={props.layoutCount === count && !props.layoutFocused ? 'is-active' : ''}
            key={count}
            onClick={() => { props.onLayoutChange(count); setOpenGroup(null) }}
            type="button"
          ><SceneLayoutIcon count={count} /></button>)}
        </div> : null}
      </div>
      <div className={`scene3d-tool-group${openGroup === 'measurements' ? ' is-open' : ''}`}>
        <button aria-expanded={openGroup === 'measurements'} aria-label="Measurements" onClick={() => toggleGroup('measurements')} type="button"><Ruler size={17} /></button>
        {openGroup === 'measurements' ? <div aria-label="Measurement tools" className="scene3d-tool-flyout" role="menu">
          <button aria-label="Section and corridor" aria-pressed={props.panel === 'section'} className={props.panel === 'section' ? 'is-active' : ''} onClick={() => { props.onSectionToggle(); close() }} type="button"><Ruler size={17} /></button>
        </div> : null}
      </div>
      <div className={`scene3d-tool-group${openGroup === 'selection' ? ' is-open' : ''}`}>
        <button aria-expanded={openGroup === 'selection'} aria-label="Selection tools" onClick={() => toggleGroup('selection')} type="button"><MousePointer2 size={17} /></button>
        {openGroup === 'selection' ? <div aria-label="Selection tools" className="scene3d-tool-flyout" role="menu">
          <button aria-label="Click or touch selection" aria-pressed={props.tool === 'pick'} className={props.tool === 'pick' ? 'is-active' : ''} onClick={() => props.onToolChange('pick')} type="button"><MousePointer2 size={17} /></button>
          <button aria-label="Line selection" aria-pressed={props.tool === 'lasso'} className={props.tool === 'lasso' ? 'is-active' : ''} onClick={() => props.onToolChange('lasso')} type="button"><Spline size={17} /></button>
          <button aria-label="Area selection" aria-pressed={props.tool === 'rectangle'} className={props.tool === 'rectangle' ? 'is-active' : ''} onClick={() => props.onToolChange('rectangle')} type="button"><Pentagon size={17} /></button>
          <button aria-label="Isolate selection" aria-pressed={props.isolate} className={props.isolate ? 'is-active' : ''} disabled={props.selectedCount === 0} onClick={() => props.onIsolateChange(!props.isolate)} type="button"><Eye size={17} /></button>
        </div> : null}
      </div>
      <div className={`scene3d-tool-group${openGroup === 'grid' ? ' is-open' : ''}`}>
        <button aria-expanded={openGroup === 'grid'} aria-label="Grid" className={props.gridVisible ? 'is-active' : ''} onClick={() => toggleGroup('grid')} type="button"><Grid3X3 size={17} /></button>
        {openGroup === 'grid' ? <div aria-label="Grid tools" className="scene3d-tool-flyout" role="menu">
          <button aria-label={props.gridVisible ? 'Hide reference grid' : 'Show reference grid'} aria-pressed={props.gridVisible} className={props.gridVisible ? 'is-active' : ''} onClick={() => props.onGridChange(!props.gridVisible)} type="button">{props.gridVisible ? <Eye size={17} /> : <EyeOff size={17} />}</button>
          <button aria-label="Easting and northing grid values" aria-pressed={props.gridCoordinatesVisible} className={props.gridCoordinatesVisible ? 'is-active' : ''} data-tooltip="Easting / Northing values" disabled={!props.gridVisible} onClick={() => props.onGridCoordinatesChange(!props.gridCoordinatesVisible)} title="Easting / Northing values" type="button"><Hash size={17} /></button>
          {([['fine', 19], ['medium', 16], ['coarse', 13]] as const).map(([value, size]) => <button aria-label={`${value.charAt(0).toUpperCase() + value.slice(1)} spacing`} aria-pressed={props.gridDensity === value} className={props.gridDensity === value ? 'is-active' : ''} data-density={value} disabled={!props.gridVisible} key={value} onClick={() => props.onGridDensityChange(value)} type="button"><Grid3X3 size={size} /></button>)}
        </div> : null}
      </div>
      <div className={`scene3d-tool-group${openGroup === 'axis' ? ' is-open' : ''}`}>
        <button aria-expanded={openGroup === 'axis'} aria-label="Axis" className={props.axesVisible ? 'is-active' : ''} onClick={() => toggleGroup('axis')} type="button"><Axis3d size={17} /></button>
        {openGroup === 'axis' ? <div aria-label="Axis visibility tools" className="scene3d-tool-flyout" role="menu">
          <button aria-label="Axis lines" aria-pressed={props.axesVisible} className={props.axesVisible ? 'is-active' : ''} onClick={() => props.onAxesChange(!props.axesVisible)} type="button"><Axis3d size={17} /></button>
          <button aria-label="Axis numbers" aria-pressed={props.axisNumbersVisible} className={props.axisNumbersVisible ? 'is-active' : ''} disabled={!props.axesVisible} onClick={() => props.onAxisNumbersChange(!props.axisNumbersVisible)} type="button"><Hash size={17} /></button>
          <button aria-label="Axis titles X Y Z" aria-pressed={props.axisTitlesVisible} className={props.axisTitlesVisible ? 'is-active' : ''} disabled={!props.axesVisible} onClick={() => props.onAxisTitlesChange(!props.axisTitlesVisible)} type="button"><Type size={17} /></button>
        </div> : null}
      </div>
      <button aria-label="Orientation gizmo" aria-pressed={props.gizmoVisible} className={props.gizmoVisible ? 'is-active' : ''} onClick={() => props.onGizmoChange(!props.gizmoVisible)} type="button"><Rotate3d size={18} /></button>
    </> : null}
  </div>
}

const sourceIds = sourceObservationIds
const matchesIds = (row: EdaObservation, ids: ReadonlySet<string>) => sourceIds(row).some((id) => ids.has(id))
const displayNumber = (value: number | null | undefined, decimals = 1) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : '—'

function initialCamera(): CameraMode {
  if (typeof window === 'undefined') return 'isometric'
  return new URLSearchParams(window.location.search).get('sceneView') === 'plan' ? 'plan' : 'isometric'
}

function valueFor(row: EdaObservation, key: string): string | number | null {
  if (key === 'lithology') return row.lithology
  if (row.dimensions[key] !== undefined) return row.dimensions[key] ?? null
  return row.values[key] ?? null
}

export function GeologicalAnalysis3DPage({ backgroundColor, onBackgroundColorChange, screenText }: GeologicalAnalysis3DPageProps) {
  const storage = useProjectStorage()
  const workspace = useDataPoolWorkspace()
  const datasetsQuery = useProjectEdaDatasets()
  const handoff = useMemo(() => readSpatialViewRequest(storage), [storage])
  const datasets = datasetsQuery.data ?? []
  const [datasetId] = useState(handoff?.datasetId ?? '')
  // A new handoff from another module wins over the view state saved for the previous one.
  const handoffScope = handoff?.createdAt ?? ''
  const [camera, setCamera] = usePersistentState<CameraMode>('view3d.camera', initialCamera, { scope: handoffScope })
  const [tool, setTool] = usePersistentState<SceneTool>('view3d.tool', 'pick')
  const [panel, setPanel] = usePersistentState<Panel>('view3d.panel', null)
  const [sharedLayers] = usePersistentState('view3d.visibleLayers', new Set(['collars', 'trajectories', 'intervals', 'lithology', 'grid', ...(handoff === null ? [] : ['candidate'])]), { scope: handoffScope })
  const [sharedSymbolBy] = usePersistentState('view3d.symbolBy', handoff?.colorBy === 'candidate' ? 'domain' : handoff?.colorBy ?? 'lithology', { scope: handoffScope })
  const [classification, setClassification] = usePersistentState<Classification>('view3d.classification', 'continuous')
  const [customBreaks, setCustomBreaks] = usePersistentState('view3d.customBreaks', '0, 0.5, 1, 2, 5')
  const [opacity, setOpacity] = usePersistentState('view3d.opacity', 92)
  const [thickness, setThickness] = usePersistentState('view3d.thickness', 5)
  const [verticalExaggeration, setVerticalExaggeration] = usePersistentState('view3d.verticalExaggeration', 1)
  const [labels, setLabels] = usePersistentState('view3d.labels', true)
  const [showAxes, setShowAxes] = usePersistentState('view3d.showAxes', true)
  const [showAxisNumbers, setShowAxisNumbers] = usePersistentState('view3d.showAxisNumbers', true)
  const [showAxisTitles, setShowAxisTitles] = usePersistentState('view3d.showAxisTitles', true)
  const [showGridCoordinates, setShowGridCoordinates] = usePersistentState('view3d.showGridCoordinates', false)
  const [gridDensity, setGridDensity] = usePersistentState<SceneGridDensity>('view3d.gridDensity', 'medium')
  const [zoom, setZoom] = usePersistentState('view3d.zoom', 1)
  const [fitRequest, setFitRequest] = useState(0)
  const [isolate, setIsolate] = usePersistentState('view3d.isolate', false)
  const [fadeBackground, setFadeBackground] = usePersistentState('view3d.fadeBackground', handoff !== null, { scope: handoffScope })
  const [ghostNonSelected, setGhostNonSelected] = usePersistentState('view3d.ghostNonSelected', false)
  const [fadeOutsideCorridor, setFadeOutsideCorridor] = usePersistentState('view3d.fadeOutsideCorridor', false)
  const [leftCollapsed, setLeftCollapsed] = usePersistentState('view3d.leftCollapsed', false)
  const [collapsedGroups, setCollapsedGroups] = usePersistentState<Set<LayerGroup>>('view3d.collapsedGroups', () => new Set())
  const [queryPresentation, setQueryPresentation] = usePersistentState<'highlight' | 'isolate'>('view3d.queryPresentation', 'highlight')
  const [selectionLabel, setSelectionLabel] = usePersistentState('view3d.selectionLabel', '3D Analysis selection')
  const [savedSelectionMessage, setSavedSelectionMessage] = useState<string | null>(null)
  const [sizeByPersistence, setSizeByPersistence] = usePersistentState('view3d.sizeByPersistence', true)
  const [queryDraft, setQueryDraft] = usePersistentState('view3d.queryDraft', '')
  const [appliedQuery, setAppliedQuery] = usePersistentState('view3d.appliedQuery', '')
  const [queryError, setQueryError] = useState<string | null>(null)
  const [paneGizmos, setPaneGizmos] = usePersistentState<Record<number, boolean>>('view3d.paneGizmos', () => ({ 0: true, 1: true, 2: true, 3: true }))
  const [sceneLayout, setSceneLayout] = useState<SceneSplitLayout>(() => {
    if (typeof window === 'undefined') return parseSceneSplitLayout(null)
    try { return parseSceneSplitLayout(storage.getItem(sceneLayoutStorageKey)) } catch { return parseSceneSplitLayout(null) }
  })
  const [paneContent, setPaneContent] = useState<SceneViewportContents>(() => {
    if (typeof window === 'undefined') return {}
    try { return parseSceneViewportContents(storage.getItem(SCENE_VIEWPORT_CONTENT_STORAGE_KEY)) } catch { return {} }
  })
  const [activePane, setActivePane] = usePersistentState('view3d.activePane', 0)
  const [graphDropPane, setGraphDropPane] = useState<number | null>(null)
  const [focusedPane, setFocusedPane] = usePersistentState<number | null>('view3d.focusedPane', null)
  // Each viewport keeps its own visible layers and colour field; the Layers panel edits the active viewport.
  const [paneViews, setPaneViews] = usePersistentState<ScenePaneViews>('view3d.paneViews', () => ({}), { scope: handoffScope })
  const fallbackPaneView: ScenePaneView = { colorBy: sharedSymbolBy, layers: [...sharedLayers] }
  const paneViewFor = (index: number) => scenePaneView(paneViews, index, fallbackPaneView)
  const activePaneView = paneViewFor(activePane)
  const visibleLayers = new Set(activePaneView.layers)
  const symbolBy = activePaneView.colorBy
  const setVisibleLayers = (update: (current: Set<string>) => Set<string>) => setPaneViews((current) => withScenePaneLayers(current, activePane, fallbackPaneView, update))
  const setSymbolBy = (colorBy: string) => setPaneViews((current) => withScenePaneColor(current, activePane, fallbackPaneView, colorBy))
  const splitStageRef = useRef<HTMLDivElement>(null)
  const splitDragRef = useRef<{ axis: SceneSplitAxis; pointerId: number; value: number } | null>(null)
  const splitFrameRef = useRef<number | null>(null)
  const [section, setSection] = usePersistentState<SectionDefinition>('view3d.section', {
    azimuth: 0, back: 40, centreX: null, centreY: null, centreZ: null,
    clip: false, corridor: 80, dip: 90, front: 40, preset: 'north-south', visible: false,
  })
  const { replaceSelection, selectedIds, toggleSelection } = useGeoEyeSelection()
  const dataset = datasets.find((item) => item.id === datasetId) ?? datasets[0]
  const importedDrillholes = useMemo(
    () => workspace.localDrillholeDraft
      ?? (typeof window === 'undefined' ? undefined : readDrillholeImport(storage)),
    [storage, workspace.localDrillholeDraft],
  )
  const [savedAnalysisResults, setSavedAnalysisResults] = useState(
    () => readAnalysisResultDocument(storage).packages,
  )

  useEffect(() => {
    const bridge = desktopBridge()
    if (bridge === undefined || workspace.storageAddress === null) {
      setSavedAnalysisResults(readAnalysisResultDocument(storage).packages)
      return
    }
    let active = true
    void bridge.readAnalysisResultPackages(workspace.storageAddress).then((packages) => {
      if (active) setSavedAnalysisResults(packages)
    })
    return () => { active = false }
  }, [storage, workspace.storageAddress])

  useEffect(() => () => {
    if (splitFrameRef.current !== null) cancelAnimationFrame(splitFrameRef.current)
  }, [])

  if (datasetsQuery.isPending) return <div className="page map2d-page scene3d-page"><div className="eda-state panel">Opening the central 3D analysis viewer…</div></div>
  if (datasetsQuery.isError || dataset === undefined) return <div className="page map2d-page scene3d-page"><div className="eda-state panel">The 3D analysis dataset is unavailable.</div></div>

  const rows = dataset.observations
  const holes = [...new Set(rows.map((row) => row.holeId))]
  const rowSourceIdSet = new Set(rows.flatMap((row) => sourceIds(row)))
  const applicableAnalysisResults = savedAnalysisResults.filter((result) => (
    (workspace.project === null || result.projectId === workspace.project.id)
    && (
      result.templateId === dataset.id
      || result.sourceObservationIds.some((id) => rowSourceIdSet.has(id))
      || result.boreholeIds.some((id) => holes.includes(id))
    )
  ))
  const importedCollars = new Map((importedDrillholes?.collar ?? []).map((collar) => [collar.holeId, collar]))
  const collarElevationFrom = (row: EdaObservation | undefined) => {
    if (row === undefined) return 0
    const value = row.values['collar.elevation'] ?? row.values.elevation ?? row.values.rl
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  const collars = new Map(holes.map((hole) => {
    const imported = importedCollars.get(hole)
    const firstRow = rows.find((row) => row.holeId === hole)
    return [hole, imported?.elevation ?? collarElevationFrom(firstRow)]
  }))
  const elevations = rows.flatMap((row) => [sceneElevation(collars.get(row.holeId) ?? 0, row.depthFrom), sceneElevation(collars.get(row.holeId) ?? 0, row.depthTo)])
  const collarCoordinates = holes.flatMap((hole) => {
    const imported = importedCollars.get(hole)
    return imported === undefined ? [] : [{ x: imported.easting, y: imported.northing }]
  })
  const allX = [...rows.map((row) => row.easting), ...collarCoordinates.map((point) => point.x)]
  const allY = [...rows.map((row) => row.northing), ...collarCoordinates.map((point) => point.y)]
  const bounds: SceneBounds = {
    maxX: Math.max(...allX) + 30, maxY: Math.max(...allY) + 30, maxZ: Math.max(...elevations),
    minX: Math.min(...allX) - 30, minY: Math.min(...allY) - 30, minZ: Math.min(...elevations) - 10,
  }
  const resolvedSection = {
    ...section,
    centreX: section.centreX ?? (bounds.minX + bounds.maxX) / 2,
    centreY: section.centreY ?? (bounds.minY + bounds.maxY) / 2,
    centreZ: section.centreZ ?? (bounds.minZ + bounds.maxZ) / 2,
  }
  const query = compileSceneQuery(dataset, appliedQuery)
  const corridorFor = (row: EdaObservation) => sectionCorridorState(row, resolvedSection, sceneElevation(collars.get(row.holeId) ?? 0, (row.depthFrom + row.depthTo) / 2))
  const queryRows = rows.filter((row) => query.matches(row))
  const querySourceIds = new Set(uniqueSourceObservationIds(queryRows))
  const filteredRows = rows.filter((row) => !section.clip || corridorFor(row).inside)
  const selectedSet = new Set(selectedIds)
  const handoffIds = new Set(handoff?.sourceObservationIds ?? [])
  const renderRows = (isolate && selectedIds.length > 0) || (queryPresentation === 'isolate' && appliedQuery !== '')
    ? filteredRows.filter((row) => matchesIds(row, selectedSet) || (queryPresentation === 'isolate' && query.matches(row)))
    : filteredRows
  const renderIds = new Set(renderRows.map((row) => row.id))
  const registeredDimensionKeys = new Set(dataset.dimensions.map((item) => item.key))
  const additionalDimensions = [...new Set(rows.flatMap((row) => Object.keys(row.dimensions)))]
    .filter((key) => !registeredDimensionKeys.has(key))
    .map((key) => ({ key, label: key.split(/[._-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') }))
  const symbolOptions = [
    ...dataset.dimensions.map((item) => ({ categorical: true, key: item.key, label: item.label, unit: '' })),
    ...additionalDimensions.map((item) => ({ categorical: true, key: item.key, label: item.label, unit: '' })),
    ...dataset.variables.map((item) => ({ categorical: item.dataType === 'category', key: item.key, label: item.shortLabel, unit: item.unit })),
  ]
  const colorScaleFor = (key: string) => {
    const definition = symbolOptions.find((item) => item.key === key) ?? symbolOptions[0]
    return {
      definition,
      ...buildSceneColorScale({
        categorical: definition?.categorical ?? false,
        categoryPalette,
        classification,
        customBreaks: customBreaks.split(',').map(Number),
        palette,
        values: filteredRows.map((row) => valueFor(row, key)),
      }),
    }
  }
  const activeColorScale = colorScaleFor(symbolBy)
  const symbolDefinition = activeColorScale.definition
  const { categories, maximum, minimum, values: symbolValues } = activeColorScale
  const effectiveClassification: Classification = activeColorScale.classification
  const structures = extractStructureObservations(rows, (row) => sceneElevation(collars.get(row.holeId) ?? 0, (row.depthFrom + row.depthTo) / 2))
  const layers: Layer[] = buildSceneLayers({
    datasetName: dataset.name,
    handoff: handoff === null ? null : { count: rows.filter((row) => matchesIds(row, handoffIds)).length, label: handoff.label, sourceModule: handoff.sourceModule },
    holeCount: holes.length,
    results: applicableAnalysisResults.map((result) => {
      const resultIds = new Set(result.sourceObservationIds)
      return { count: rows.filter((row) => matchesIds(row, resultIds) || result.boreholeIds.includes(row.holeId)).length, result }
    }),
    rows,
    selectedCount: selectedIds.length,
    structures,
  })

  const updateSceneLayout = (next: SceneSplitLayout) => {
    setSceneLayout(next)
    setActivePane((current) => current < next.count ? current : 0)
    try { storage.setItem(sceneLayoutStorageKey, JSON.stringify(next)) } catch { /* Keep the workspace usable when storage is unavailable. */ }
  }
  const updatePaneContent = (next: SceneViewportContents) => {
    setPaneContent(next)
    try { storage.setItem(SCENE_VIEWPORT_CONTENT_STORAGE_KEY, JSON.stringify(next)) } catch { /* Keep the pane content for this session when storage is unavailable. */ }
  }
  const openGraphInViewport = (resultId: string, objectKey: string, requestedPane = activePane) => {
    const pane = graphViewportPane(sceneLayout.count, requestedPane)
    updatePaneContent({ ...paneContent, [pane]: { kind: 'graph', objectKey, resultId } })
    setFocusedPane((current) => current === null ? null : pane)
    setActivePane(pane)
  }
  const showSceneInViewport = (index: number) => {
    const { [index]: _removed, ...rest } = paneContent
    updatePaneContent(rest)
  }
  const commitSplitRatio = (axis: SceneSplitAxis, value: number) => {
    const next = clampSceneSplitRatio(value)
    const nextLayout = { ...sceneLayout, [axis]: next }
    setSceneLayout(nextLayout)
    splitStageRef.current?.style.setProperty(`--scene-split-${axis}`, `${next}%`)
    try { storage.setItem(sceneLayoutStorageKey, JSON.stringify(nextLayout)) } catch { /* Keep resizing when storage is unavailable. */ }
  }
  const startSplitResize = (axis: SceneSplitAxis, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    splitDragRef.current = { axis, pointerId: event.pointerId, value: sceneLayout[axis] }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveSplitResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = splitDragRef.current
    const stage = splitStageRef.current
    if (drag === null || stage === null || drag.pointerId !== event.pointerId) return
    const bounds = stage.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    drag.value = clampSceneSplitRatio(drag.axis === 'column'
      ? (event.clientX - bounds.left) / bounds.width * 100
      : (event.clientY - bounds.top) / bounds.height * 100)
    if (splitFrameRef.current !== null) return
    splitFrameRef.current = requestAnimationFrame(() => {
      splitFrameRef.current = null
      const current = splitDragRef.current
      if (current !== null) stage.style.setProperty(`--scene-split-${current.axis}`, `${current.value}%`)
    })
  }
  const finishSplitResize = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (splitFrameRef.current !== null) cancelAnimationFrame(splitFrameRef.current)
    splitFrameRef.current = null
    const drag = splitDragRef.current
    splitDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag === null) return
    commitSplitRatio(drag.axis, cancelled ? sceneLayout[drag.axis] : drag.value)
  }

  const toggleLayer = (id: string) => setVisibleLayers((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const toggleGroup = (group: LayerGroup) => setCollapsedGroups((current) => {
    const next = new Set(current)
    next.has(group) ? next.delete(group) : next.add(group)
    return next
  })
  const applyQuery = (expression = queryDraft) => {
    const compiled = compileSceneQuery(dataset, expression)
    setQueryError(compiled.error)
    if (compiled.error === null) {
      setAppliedQuery(expression.trim())
      setSavedSelectionMessage(null)
    }
  }
  const selectQueryMatches = (presentation: 'highlight' | 'isolate') => {
    if (appliedQuery === '') return
    replaceSelection(uniqueSourceObservationIds(queryRows))
    setQueryPresentation(presentation)
    setGhostNonSelected(presentation === 'highlight')
    setIsolate(false)
  }
  const saveQuerySelection = () => {
    if (typeof window === 'undefined' || appliedQuery === '' || queryRows.length === 0) return
    const saved = createSavedSceneSelection(selectionLabel, queryRows, appliedQuery)
    let existing: unknown = []
    try { existing = JSON.parse(storage.getItem(sceneSelectionStorageKey) ?? '[]') } catch { existing = [] }
    const selections = Array.isArray(existing) ? existing : []
    storage.setItem(sceneSelectionStorageKey, JSON.stringify([...selections, saved]))
    setSavedSelectionMessage(`${saved.label} saved · ${saved.sourceObservationIds.length} source IDs`)
  }
  const usePreset = (preset: SectionDefinition['preset']) => setSection((current) => ({
    ...current, preset, visible: true,
    azimuth: preset === 'east-west' ? 90 : 0,
    dip: preset === 'plan' ? 0 : 90,
  }))
  const moveSection = (direction: -1 | 1) => {
    const radians = resolvedSection.azimuth * Math.PI / 180
    setSection((current) => ({
      ...current,
      centreX: resolvedSection.centreX + Math.cos(radians) * current.corridor * direction,
      centreY: resolvedSection.centreY - Math.sin(radians) * current.corridor * direction,
      centreZ: resolvedSection.centreZ,
    }))
  }
  const selectRow = (row: EdaObservation) => {
    if (tool === 'pick') toggleSelection(anchoredSelection(rows, row, 'pick'))
    if (tool === 'rectangle') replaceSelection(anchoredSelection(rows, row, 'rectangle'))
    if (tool === 'lasso') replaceSelection(anchoredSelection(rows, row, 'lasso'))
  }
  const changeSymbolFromLayer = (layer: Layer) => {
    const key = sceneLayerColorField(layer, new Set(symbolOptions.map((option) => option.key)))
    if (key !== undefined) setSymbolBy(key)
  }

  const loadAnalysisResult = (result: AnalysisResultPackage) => {
    const resultIds = new Set(result.sourceObservationIds)
    const matchedRows = rows.filter((row) => matchesIds(row, resultIds) || result.boreholeIds.includes(row.holeId))
    replaceSelection(uniqueSourceObservationIds(matchedRows))
    const field = result.derivedFieldKeys.find((key) => symbolOptions.some((option) => option.key === key))
    if (field !== undefined) setSymbolBy(field)
    setVisibleLayers((current) => new Set([...current, `result:${result.resultId}`]))
    setFadeBackground(true)
    setFitRequest((value) => value + 1)
  }
  const holeRowsById = new Map<string, EdaObservation[]>()
  rows.forEach((row) => {
    const holeRows = holeRowsById.get(row.holeId) ?? []
    holeRows.push(row)
    holeRowsById.set(row.holeId, holeRows)
  })
  const buildSceneHoles = (paneLayers: ReadonlySet<string>, colorOf: (row: EdaObservation) => string): Scene3DHole[] => holes.flatMap((hole) => {
    const holeRows = [...(holeRowsById.get(hole) ?? [])].sort((left, right) => left.depthFrom - right.depthFrom)
    const collarRow = holeRows[0]
    if (collarRow === undefined) return []
    const importedCollar = importedCollars.get(hole)
    const collarZ = collars.get(hole) ?? 0
    const sourceCollar = {
      x: importedCollar?.easting ?? collarRow.easting,
      y: importedCollar?.northing ?? collarRow.northing,
      z: collarZ,
    }
    // Analytical datasets can begin below MD 0. Keep the collar marker attached
    // to the first available interval while retaining the source collar as datum.
    const firstIntervalStart = {
      x: collarRow.easting,
      y: collarRow.northing,
      z: sceneElevation(collarZ, collarRow.depthFrom),
    }
    const collar = sceneCollarRenderPoint(sourceCollar, firstIntervalStart)
    return [{
      collar,
      id: hole,
      intervals: holeRows.flatMap((row, index) => {
        if (!renderIds.has(row.id)) return []
        const next = holeRows[index + 1]
        const selected = matchesIds(row, selectedSet)
        const linked = paneLayers.has('candidate') && matchesIds(row, handoffIds)
        const queryMatched = appliedQuery !== '' && matchesIds(row, querySourceIds)
        const faded = (fadeBackground && handoffIds.size > 0 && !linked)
          || (ghostNonSelected && selectedIds.length > 0 && !selected)
          || (fadeOutsideCorridor && !corridorFor(row).inside)
          || (queryPresentation === 'highlight' && appliedQuery !== '' && !queryMatched)
        return [{
          color: colorOf(row),
          faded,
          from: { x: row.easting, y: row.northing, z: sceneElevation(collarZ, row.depthFrom) },
          id: row.id,
          label: `${hole} ${row.depthFrom.toFixed(0)} m`,
          linked,
          queryMatched,
          selected,
          thickness,
          title: `${hole} · ${row.depthFrom.toFixed(1)}–${row.depthTo.toFixed(1)} m · ${sourceIds(row).join(', ')}`,
          to: { x: next?.easting ?? row.easting, y: next?.northing ?? row.northing, z: sceneElevation(collarZ, row.depthTo) },
        }]
      }),
      trajectory: [collar, ...holeRows.map((row) => ({ x: row.easting, y: row.northing, z: sceneElevation(collarZ, row.depthTo) }))],
    }]
  })
  const buildSceneStructures = (paneLayers: ReadonlySet<string>): Scene3DStructure[] => structures.flatMap((structure) => {
    const visible = structure.kind === 'fault' ? paneLayers.has('faults') : paneLayers.has('discontinuities') || paneLayers.has('joint-sets')
    const sourceRow = rows.find((row) => sourceIds(row).some((id) => structure.sourceObservationIds.includes(id)))
    if (!visible || sourceRow === undefined) return []
    const jointSet = structure.jointSet.toLowerCase().replace(/[^a-z0-9]/g, '')
    return [{
      color: structure.kind === 'fault' ? '#e16368' : jointSet === 'j2' ? '#5eb7ac' : jointSet === 'j3' ? '#a797cb' : jointSet === 'unclassified' ? '#c1c4b7' : '#e7a36d',
      dipDirection: structure.dipDirection,
      id: structure.id,
      kind: structure.kind,
      label: `${structure.jointSet} · true dip ${structure.trueDip.toFixed(1)}° / ${structure.dipDirection.toFixed(1)}°`,
      persistence: sizeByPersistence ? structure.persistence : 1,
      point: { x: structure.x, y: structure.y, z: structure.z },
      rowId: sourceRow.id,
      trueDip: structure.trueDip,
    }]
  })
  const viewportCameras: ViewportCamera[] = sceneLayout.count === 1
    ? [camera]
    : dispatchViewportCameras.slice(0, sceneLayout.count)
  const paneSceneCache = new Map<string, { colorLabel: string; holes: Scene3DHole[]; layers: ReadonlySet<string>; structures: Scene3DStructure[] }>()
  const paneScenes = viewportCameras.map((_, index) => {
    const view = paneViewFor(index)
    const key = scenePaneViewKey(view)
    let scene = paneSceneCache.get(key)
    if (scene === undefined) {
      const paneLayers = new Set(view.layers)
      const scale = colorScaleFor(view.colorBy)
      scene = {
        colorLabel: scale.definition?.label ?? view.colorBy,
        holes: buildSceneHoles(paneLayers, (row) => scale.color(valueFor(row, view.colorBy))),
        layers: paneLayers,
        structures: buildSceneStructures(paneLayers),
      }
      paneSceneCache.set(key, scene)
    }
    return scene
  })
  const viewportGraphs = viewportCameras.map((_, index) => resolveViewportGraph(savedAnalysisResults, paneContent[index]))
  const setPaneGizmo = (index: number, visible: boolean) => setPaneGizmos((current) => ({ ...current, [index]: visible }))
  const splitDivider = (axis: SceneSplitAxis) => {
    const vertical = axis === 'column'
    const negativeKey = vertical ? 'ArrowLeft' : 'ArrowUp'
    const positiveKey = vertical ? 'ArrowRight' : 'ArrowDown'
    return <div
      aria-label={`Resize ${axis}`}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuemax={75}
      aria-valuemin={25}
      aria-valuenow={Math.round(sceneLayout[axis])}
      className={`scene3d-split-divider is-${axis}`}
      onDoubleClick={() => commitSplitRatio(axis, 50)}
      onKeyDown={(event) => {
        if (![negativeKey, positiveKey, 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 25 : event.key === 'End' ? 75 : sceneLayout[axis] + (event.key === negativeKey ? -5 : 5)
        commitSplitRatio(axis, next)
      }}
      onPointerCancel={(event) => finishSplitResize(event, true)}
      onPointerDown={(event) => startSplitResize(axis, event)}
      onPointerMove={moveSplitResize}
      onPointerUp={finishSplitResize}
      role="separator"
      tabIndex={0}
    />
  }

  return <div className="page map2d-page scene3d-page">
    <h1 className="sr-only">GeoEye 3D geological analysis viewer</h1>
    <div className={`map2d-workspace scene3d-workspace ${leftCollapsed ? 'is-left-collapsed' : ''}`}>
      <aside className="map2d-contents scene3d-contents">
        <div className="map2d-pane-title scene3d-layers-title"><div><Layers3 size={15} /><strong>Layers</strong>{sceneLayout.count > 1 ? <small>{viewportLabel(activePane)}</small> : null}</div><button aria-label={`${leftCollapsed ? 'Expand' : 'Collapse'} Layers`} onClick={() => setLeftCollapsed((value) => !value)} title={`${leftCollapsed ? 'Expand' : 'Collapse'} Layers`} type="button"><PanelLeftClose className={leftCollapsed ? 'is-flipped' : ''} size={15} /></button></div>
        <div className="map2d-layer-list scene3d-layer-tree">{groupOrder.map((group) => {
          const groupLayers = layers.filter((layer) => layer.group === group)
          const collapsed = collapsedGroups.has(group)
          return <section className={`scene3d-layer-group ${collapsed ? 'is-collapsed' : ''}`} key={group}>
            <header><button aria-expanded={!collapsed} onClick={() => toggleGroup(group)} type="button"><ChevronDown className={collapsed ? 'is-collapsed' : ''} size={11} /><strong>{group}</strong><span>{groupLayers.reduce((sum, layer) => sum + layer.count, 0).toLocaleString()}</span></button></header>
            {collapsed ? null : groupLayers.map((layer) => <Fragment key={layer.id}><div className={`map2d-layer ${layer.id === 'candidate' || layer.result !== undefined ? 'is-handoff' : ''} ${layer.count === 0 ? 'is-empty' : ''}`}><button aria-label={`${visibleLayers.has(layer.id) ? 'Hide' : 'Show'} ${layer.label}`} disabled={layer.count === 0} onClick={() => { if (layer.result !== undefined && !visibleLayers.has(layer.id)) loadAnalysisResult(layer.result); else toggleLayer(layer.id); if (!visibleLayers.has(layer.id)) changeSymbolFromLayer(layer) }} type="button">{visibleLayers.has(layer.id) ? <Eye size={13} /> : <EyeOff size={13} />}</button><button className="scene3d-layer-label" onClick={() => layer.result === undefined ? changeSymbolFromLayer(layer) : loadAnalysisResult(layer.result)} type="button"><strong>{layer.label}</strong><small>{layer.result === undefined ? `${layer.count.toLocaleString()} objects` : `${layer.count.toLocaleString()} objects · ${layer.result.graphs.length} saved graphs`}</small></button><button aria-label={`${layer.label} options`} className="map2d-layer-menu" title={layer.source} type="button">•••</button></div>
              {layer.result?.graphs.map((graph) => {
                const result = layer.result!
                const open = viewportGraphs.some((item) => item?.result.resultId === result.resultId && item.graph.objectKey === graph.objectKey)
                return <button aria-pressed={open} className={`scene3d-layer-graph${open ? ' is-open' : ''}`} draggable key={graph.objectKey} onClick={() => openGraphInViewport(result.resultId, graph.objectKey)} onDragEnd={() => setGraphDropPane(null)} onDragStart={(event) => { event.dataTransfer.setData(SCENE_GRAPH_DRAG_TYPE, serializeGraphDrag(result.resultId, graph.objectKey)); event.dataTransfer.effectAllowed = 'copy' }} title={`Click to open ${graph.fileName} in ${viewportLabel(activePane)}, or drag it onto any viewport`} type="button"><ImageIcon size={12} /><span>{graph.chartName}</span><small>{graph.boreholeId ?? 'PNG'}</small></button>
              })}
            </Fragment>)}
          </section>
        })}</div>
      </aside>

      <main className={`scene3d-canvas is-${camera} view-${sceneLayout.count} tool-${tool}`}>
        {appliedQuery === '' ? null : <button className="scene3d-filter-chip" onClick={() => { setAppliedQuery(''); setQueryDraft(''); setQueryError(null) }} type="button"><Filter size={11} /> {appliedQuery}<X size={10} /></button>}
        {panel === null ? null : <section className={`scene3d-control-panel is-${panel}`}><header><span>{panel === 'section' ? <Ruler size={14} /> : panel === 'query' ? <Filter size={14} /> : panel === 'legend' ? <Tag size={14} /> : <SlidersHorizontal size={14} />}<strong>{panel === 'section' ? 'Section Manager' : panel === 'query' ? 'Filter / Query' : panel === 'legend' ? 'Legend Editor' : 'Display Properties'}</strong></span><button onClick={() => setPanel(null)} type="button"><X size={13} /></button></header>
          {panel === 'display' ? <div className="scene3d-display-controls">
            <label><span>Opacity</span><input max="100" min="10" onChange={(event) => setOpacity(Number(event.target.value))} type="range" value={opacity} /><b>{opacity}%</b></label>
            <label><span>Tube scale</span><input max="12" min="2" onChange={(event) => setThickness(Number(event.target.value))} type="range" value={thickness} /><b>{(thickness / 5).toFixed(1)}×</b></label>
            <label><span>Vertical exaggeration</span><input max="2.5" min="0.5" onChange={(event) => setVerticalExaggeration(Number(event.target.value))} step="0.25" type="range" value={verticalExaggeration} /><b>{verticalExaggeration.toFixed(2)}×</b></label>
            <label className="scene3d-background-setting"><span>Background</span><input aria-label="Scene background colour" onChange={(event) => onBackgroundColorChange(event.target.value)} type="color" value={backgroundColor} /><b>{backgroundColor.toUpperCase()}</b></label>
            <div className="scene3d-switches"><label><input checked={labels} onChange={(event) => setLabels(event.target.checked)} type="checkbox" /> Labels</label><label><input checked={ghostNonSelected} onChange={(event) => setGhostNonSelected(event.target.checked)} type="checkbox" /> Ghost non-selected</label><label><input checked={fadeBackground} disabled={handoff === null} onChange={(event) => setFadeBackground(event.target.checked)} type="checkbox" /> Ghost linked background</label><label><input checked={sizeByPersistence} onChange={(event) => setSizeByPersistence(event.target.checked)} type="checkbox" /> Structure size by persistence</label></div>
          </div> : null}
          {panel === 'legend' ? <div className="scene3d-legend-editor"><label><span>Classification</span><select disabled={effectiveClassification === 'categorical'} onChange={(event) => setClassification(event.target.value as Classification)} value={effectiveClassification}><option value="continuous">Continuous gradient</option><option value="equal">Equal interval</option><option value="quantile">Quantile</option><option value="custom">Custom classes</option><option value="categorical">Categorical legend</option></select></label>{effectiveClassification === 'custom' ? <label><span>Class breaks</span><input onChange={(event) => setCustomBreaks(event.target.value)} value={customBreaks} /></label> : null}<div className="scene3d-legend-preview"><strong>{symbolDefinition?.label}</strong><small>{symbolDefinition?.unit}</small>{effectiveClassification === 'categorical' ? categories.map((category, index) => <div key={category}><i style={{ background: categoryPalette[index % categoryPalette.length] }} /><span>{category}</span><b>{symbolValues.filter((value) => value === category).length}</b></div>) : <><i className="is-gradient" /><div className="scene3d-legend-range"><span>{displayNumber(minimum, 2)}</span><span>{displayNumber(maximum, 2)}</span></div></>}</div></div> : null}
          {panel === 'query' ? <div className="scene3d-query-panel">
            <form onSubmit={(event) => { event.preventDefault(); applyQuery() }}><label><span>Expression</span><input onChange={(event) => setQueryDraft(event.target.value)} placeholder="Au > 1" value={queryDraft} /></label><button type="submit">Apply</button></form>
            <p className={queryError === null ? '' : 'is-error'}>{queryError ?? (appliedQuery === '' ? 'Query any Database variable or category.' : `${queryRows.length} of ${rows.length} intervals match · ${querySourceIds.size} source IDs.`)}</p>
            <div className="scene3d-query-examples">{['RMR76 < 40', 'Au > 1', 'Cluster_ID = C2', 'Lithology = Diorite'].map((example) => <button key={example} onClick={() => { setQueryDraft(example); applyQuery(example) }} type="button">{example}</button>)}</div>
            <div className="scene3d-query-actions"><button disabled={appliedQuery === '' || queryRows.length === 0} onClick={() => selectQueryMatches('highlight')} type="button"><Sparkles size={12} /> Highlight</button><button disabled={appliedQuery === '' || queryRows.length === 0} onClick={() => selectQueryMatches('isolate')} type="button"><Focus size={12} /> Isolate</button><label><span>Selection name</span><input onChange={(event) => setSelectionLabel(event.target.value)} value={selectionLabel} /></label><button disabled={appliedQuery === '' || queryRows.length === 0} onClick={saveQuerySelection} type="button"><Save size={12} /> Save selection</button></div>
            {savedSelectionMessage === null ? null : <p className="is-success">{savedSelectionMessage}</p>}
          </div> : null}
          {panel === 'section' ? <div className="scene3d-section-manager">
            <div className="scene3d-section-presets">{([['plan', 'Plan'], ['north-south', 'N–S'], ['east-west', 'E–W'], ['custom', 'Custom']] as const).map(([id, label]) => <button className={section.preset === id ? 'is-active' : ''} key={id} onClick={() => usePreset(id)} type="button">{label}</button>)}</div>
            <div className="scene3d-section-fields"><label><span>Centre X (m)</span><input onChange={(event) => setSection({ ...section, centreX: Number(event.target.value) })} type="number" value={resolvedSection.centreX} /></label><label><span>Centre Y (m)</span><input onChange={(event) => setSection({ ...section, centreY: Number(event.target.value) })} type="number" value={resolvedSection.centreY} /></label><label><span>Centre RL (m)</span><input onChange={(event) => setSection({ ...section, centreZ: Number(event.target.value) })} type="number" value={resolvedSection.centreZ} /></label><label><span>Azimuth (°)</span><input max="359" min="0" onChange={(event) => setSection({ ...section, azimuth: Number(event.target.value), preset: 'custom' })} type="number" value={section.azimuth} /></label><label><span>Dip (°)</span><input max="90" min="-90" onChange={(event) => setSection({ ...section, dip: Number(event.target.value), preset: 'custom' })} type="number" value={section.dip} /></label><label><span>Corridor (m)</span><input min="1" onChange={(event) => { const corridor = Number(event.target.value); setSection({ ...section, back: corridor / 2, corridor, front: corridor / 2 }) }} type="number" value={section.corridor} /></label><label><span>Front clip (m)</span><input min="0" onChange={(event) => setSection({ ...section, front: Number(event.target.value) })} type="number" value={section.front} /></label><label><span>Back clip (m)</span><input min="0" onChange={(event) => setSection({ ...section, back: Number(event.target.value) })} type="number" value={section.back} /></label></div>
            <div className="scene3d-section-actions"><button onClick={() => moveSection(-1)} type="button"><ChevronLeft size={12} /> Previous</button><button onClick={() => { updateSceneLayout({ ...sceneLayout, count: 1 }); setFocusedPane(null); setCamera('section'); setSection({ ...section, visible: true }) }} type="button">Align camera</button><button onClick={() => moveSection(1)} type="button">Next <ChevronRight size={12} /></button></div>
            <div className="scene3d-switches"><label><input checked={section.visible} onChange={(event) => setSection({ ...section, visible: event.target.checked })} type="checkbox" /> Show section</label><label><input checked={section.clip} onChange={(event) => { setSection({ ...section, clip: event.target.checked }); if (event.target.checked) setFadeOutsideCorridor(false) }} type="checkbox" /> Clip outside corridor</label><label><input checked={fadeOutsideCorridor} onChange={(event) => { setFadeOutsideCorridor(event.target.checked); if (event.target.checked) setSection({ ...section, clip: false }) }} type="checkbox" /> Fade outside corridor</label></div>
          </div> : null}
        </section>}

        <div
          className="scene3d-view-stage"
          data-count={sceneLayout.count}
          data-focused={focusedPane !== null}
          ref={splitStageRef}
          style={{
            '--scene-split-column': `${sceneLayout.column}%`,
            '--scene-split-row': `${sceneLayout.row}%`,
          } as React.CSSProperties}
        >
          <Suspense fallback={<div className="geoeye-scene3d-loading">Loading 3D engine…</div>}>
            {viewportCameras.map((viewportCamera, index) => {
              const viewportGraph = viewportGraphs[index] ?? null
              const paneScene = paneScenes[index]!
              return <section
              aria-label={`${viewportLabel(index)}${activePane === index ? ', active' : ', inactive; click to activate'}`}
              className={`scene3d-view-pane${sceneLayout.count > 1 || viewportGraph !== null ? ' is-split' : ''}`}
              data-active={activePane === index}
              data-camera={viewportCamera}
              data-content={viewportGraph === null ? 'scene' : 'graph'}
              data-graph-drop={graphDropPane === index}
              data-slot={index}
              hidden={focusedPane !== null && focusedPane !== index}
              key={viewportCamera}
              onDragLeave={(event) => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
                setGraphDropPane((current) => current === index ? null : current)
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(SCENE_GRAPH_DRAG_TYPE)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
                if (graphDropPane !== index) setGraphDropPane(index)
              }}
              onDrop={(event) => {
                const dropped = parseGraphDrag(event.dataTransfer.getData(SCENE_GRAPH_DRAG_TYPE))
                setGraphDropPane(null)
                if (dropped === null) return
                event.preventDefault()
                openGraphInViewport(dropped.resultId, dropped.objectKey, index)
              }}
              onClickCapture={(event) => {
                if (activePane === index) return
                setActivePane(index)
                // Pane header buttons still run on the click that activates their pane.
                if (event.target instanceof Element && event.target.closest('.scene3d-view-pane-header') !== null) return
                event.preventDefault()
                event.stopPropagation()
              }}
            >
              {sceneLayout.count > 1 || viewportGraph !== null ? <header className="scene3d-view-pane-header">
                <span>{viewportGraph === null ? <Cuboid size={13} /> : <ImageIcon size={13} />}<strong>{`${viewportLabel(index)} · ${viewportGraph === null ? paneScene.colorLabel : viewportGraph.graph.chartName}`}</strong></span>
                {viewportGraph === null ? null : <button
                  aria-label={`Show 3D scene in ${viewportLabel(index)}`}
                  data-tooltip="Back to 3D scene"
                  onClick={() => { setActivePane(index); showSceneInViewport(index) }}
                  title="Back to 3D scene"
                  type="button"
                ><Cuboid size={13} /></button>}
                {sceneLayout.count === 1 ? null : <button
                  aria-label={`${focusedPane === index ? 'Restore' : 'Maximize'} ${viewportLabel(index)}`}
                  data-tooltip={focusedPane === index ? 'Restore split layout' : 'Maximize pane'}
                  onClick={() => { setActivePane(index); setFocusedPane((current) => current === index ? null : index) }}
                  title={focusedPane === index ? 'Restore split layout' : 'Maximize pane'}
                  type="button"
                >{focusedPane === index ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>}
              </header> : null}
              {viewportGraph !== null ? <figure className="scene3d-view-pane-graph">
                <img alt={`${viewportGraph.graph.chartName} · saved ${viewportGraph.result.feature} graph`} src={viewportGraph.graph.imageDataUrl} />
                <figcaption><strong>{viewportGraph.result.feature} · v{viewportGraph.result.templateVersion}</strong><span>{viewportGraph.result.inputName}{viewportGraph.graph.boreholeId === null ? '' : ` · ${viewportGraph.graph.boreholeId}`}</span><small>{viewportGraph.graph.fileName}</small></figcaption>
              </figure> : <div className="scene3d-view-pane-canvas"><GeoEyeScene3D
                active={activePane === index}
                backgroundColor={backgroundColor}
                bounds={bounds}
                cameraMode={viewportCamera}
                fitRequest={fitRequest}
                gridDensity={gridDensity}
                holes={paneScene.holes}
                labels={labels && (sceneLayout.count === 1 || viewportCamera === 'isometric')}
                onSelectInterval={(id) => { const row = rows.find((candidate) => candidate.id === id); if (row !== undefined) selectRow(row) }}
                onSelectStructure={(rowId) => { const row = rows.find((candidate) => candidate.id === rowId); if (row !== undefined) selectRow(row) }}
                opacity={opacity / 100}
                poseStorageKey={`view3d.pose.${index}`}
                screenText={screenText}
                section={resolvedSection}
                showAxisNumbers={showAxisNumbers}
                showAxisTitles={showAxisTitles}
                showAxes={showAxes}
                showCollars={paneScene.layers.has('collars')}
                showGrid={paneScene.layers.has('grid')}
                showGridCoordinates={showGridCoordinates}
                showGizmo={paneGizmos[index] ?? true}
                showIntervals={paneScene.layers.has('intervals')}
                showTrajectories={paneScene.layers.has('trajectories')}
                structures={paneScene.structures}
                tool={tool}
                verticalExaggeration={verticalExaggeration}
                zoom={zoom}
              /><ScenePaneToolbox
                active={activePane === index}
                axesVisible={showAxes}
                axisNumbersVisible={showAxisNumbers}
                axisTitlesVisible={showAxisTitles}
                gizmoVisible={paneGizmos[index] ?? true}
                gridCoordinatesVisible={showGridCoordinates}
                gridDensity={gridDensity}
                gridVisible={paneScene.layers.has('grid')}
                index={index}
                isolate={isolate}
                layoutCount={sceneLayout.count}
                layoutFocused={focusedPane !== null}
                onAxesChange={setShowAxes}
                onAxisNumbersChange={setShowAxisNumbers}
                onAxisTitlesChange={setShowAxisTitles}
                onGizmoChange={(visible) => setPaneGizmo(index, visible)}
                onGridCoordinatesChange={setShowGridCoordinates}
                onGridChange={() => toggleLayer('grid')}
                onGridDensityChange={setGridDensity}
                onIsolateChange={setIsolate}
                onLayoutChange={(count) => {
                  updateSceneLayout({ ...sceneLayout, count })
                  setFocusedPane(null)
                  if (count === 1) setCamera('isometric')
                }}
                onSectionToggle={() => setPanel(panel === 'section' ? null : 'section')}
                onToolChange={setTool}
                panel={panel}
                selectedCount={selectedIds.length}
                tool={tool}
              /></div>}
            </section>
            })}
          </Suspense>
          {focusedPane === null && sceneLayout.count > 1 ? splitDivider('column') : null}
          {focusedPane === null && sceneLayout.count > 2 ? splitDivider('row') : null}
        </div>
        {panel === 'legend' ? <div className="scene3d-legend-overlay"><header><span>{symbolDefinition?.label}</span><small>{effectiveClassification}</small></header>{effectiveClassification === 'categorical' ? categories.slice(0, 7).map((category, index) => <div key={category}><i style={{ background: categoryPalette[index % categoryPalette.length] }} /><span>{category}</span></div>) : <><i className="is-gradient" /><div><span>{displayNumber(maximum, 2)}</span><span>{displayNumber(minimum, 2)}</span></div></>}</div> : null}
      </main>
    </div>
    <footer className={`map2d-statusbar scene3d-statusbar ${leftCollapsed ? 'is-left-collapsed' : ''}`}><span>Ready</span><span><Crosshair size={11} /> {camera === 'section' ? `AZ ${section.azimuth}° / DIP ${section.dip}°` : `${camera} camera`}</span><span>Vertical {verticalExaggeration.toFixed(2)}×</span><span>{renderRows.length} visible / {rows.length} · {selectedIds.length} selected</span></footer>
  </div>
}
