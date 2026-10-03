import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { SceneBounds } from '../visualization/scene3dProjection.js'
import { createOrientationGizmoGeometry, orientationViewLetter, type OrientationPreset, type OrientationQuaternion } from '../visualization/sceneOrientationGizmo.js'
import { createSceneRenderScheduler, type SceneRenderScheduler } from '../visualization/scene3dRenderScheduler.js'
import {
  cameraFrameForBounds,
  cameraFrameTriggerKey,
  dataPointToThree,
  formatGridCoordinate,
  gridCoordinateValues,
  gridStepForDensity,
  sceneAxisExtents,
  sceneAxisTicks,
  type SceneGridDensity,
  type ScenePoint3D,
  type ThreeCameraMode,
} from '../visualization/scene3dThreeMath.js'
import { sceneTextFontFamily, type SceneTextPreferences } from '../visualization/sceneTextPreferences.js'
import { loadWorkspaceState, saveWorkspaceState } from '../state/persistentState.js'

// Viewport architecture adapted from teamastrogeo/drillhole-planner
// (main @ 3a712c1): Y-up coordinates, aspect-aware framing, OrbitControls,
// CSS2D labels and a demand renderer with an occlusion-safe final frame.

export type SceneInteractionTool = 'pick' | 'rectangle' | 'lasso' | 'identify'

export interface Scene3DInterval {
  color: string
  faded: boolean
  from: ScenePoint3D
  id: string
  label: string
  linked: boolean
  queryMatched: boolean
  selected: boolean
  thickness: number
  title: string
  to: ScenePoint3D
}

export interface Scene3DHole {
  collar: ScenePoint3D
  id: string
  intervals: Scene3DInterval[]
  trajectory: ScenePoint3D[]
}

export interface Scene3DStructure {
  color: string
  dipDirection: number
  id: string
  kind: 'discontinuity' | 'fault'
  label: string
  persistence: number
  point: ScenePoint3D
  rowId: string
  trueDip: number
}

export interface Scene3DSection {
  azimuth: number
  back: number
  centreX: number
  centreY: number
  centreZ: number
  corridor: number
  dip: number
  front: number
  visible: boolean
}

interface GeoEyeScene3DProps {
  active: boolean
  backgroundColor: string
  bounds: SceneBounds
  cameraMode: ThreeCameraMode
  fitRequest: number
  gridDensity: SceneGridDensity
  holes: Scene3DHole[]
  labels: boolean
  onSelectInterval: (id: string) => void
  onSelectStructure: (rowId: string) => void
  opacity: number
  /** When set, the free-orbit camera pose is saved under this key and restored on the next visit. */
  poseStorageKey?: string
  screenText: SceneTextPreferences
  section: Scene3DSection
  showAxisNumbers: boolean
  showAxisTitles: boolean
  showCollars: boolean
  showAxes: boolean
  showGrid: boolean
  showGridCoordinates: boolean
  showGizmo: boolean
  showIntervals: boolean
  showTrajectories: boolean
  structures: Scene3DStructure[]
  tool: SceneInteractionTool
  verticalExaggeration: number
  zoom: number
}

interface SavedScenePose {
  position: [number, number, number]
  preset: OrientationPreset | null
  target: [number, number, number]
  /** Frame the pose was captured in; a different dataset, mode or zoom invalidates it. */
  trigger: string
  up: [number, number, number]
}

function isVector(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

function loadScenePose(key: string | undefined, trigger: string): SavedScenePose | null {
  if (key === undefined) return null
  const saved = loadWorkspaceState<Partial<SavedScenePose> | null>(key, null)
  if (saved === undefined || saved === null || saved.trigger !== trigger) return null
  if (!isVector(saved.position) || !isVector(saved.target) || !isVector(saved.up)) return null
  return { position: saved.position, preset: saved.preset ?? null, target: saved.target, trigger, up: saved.up }
}

interface SceneRuntime {
  camera: THREE.PerspectiveCamera
  content: THREE.Group
  controls: OrbitControls
  infiniteGrid: THREE.Mesh | null
  labels: CSS2DRenderer
  labelElements: HTMLElement[]
  pickables: THREE.Object3D[]
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  scheduler: SceneRenderScheduler
}

const SELECT_TOOLS = new Set<SceneInteractionTool>(['pick', 'rectangle', 'lasso', 'identify'])

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh
    renderable.geometry?.dispose()
    const materials = Array.isArray(renderable.material) ? renderable.material : renderable.material === undefined ? [] : [renderable.material]
    materials.forEach((material) => material.dispose())
  })
}

function clearContent(runtime: SceneRuntime) {
  runtime.labelElements.forEach((element) => element.remove())
  runtime.labelElements = []
  runtime.pickables = []
  runtime.infiniteGrid = null
  for (const child of [...runtime.content.children]) {
    runtime.content.remove(child)
    disposeObject(child)
  }
}

function labelObject(runtime: SceneRuntime, text: string, className: string, position: THREE.Vector3, accentColor?: string) {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  if (accentColor !== undefined) element.style.setProperty('--scene-axis-color', accentColor)
  runtime.labelElements.push(element)
  const label = new CSS2DObject(element)
  label.position.copy(position)
  return label
}

function formatAxisNumber(value: number) {
  const rounded = Math.round(value * 10) / 10
  const absolute = Math.abs(rounded)
  if (absolute >= 1_000_000) return `${(rounded / 1_000_000).toFixed(3).replace(/\.?0+$/, '')}M`
  if (absolute >= 10_000) return `${(rounded / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return rounded.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(rounded) ? 0 : 1 })
}

interface GridCoordinateTick {
  key: string
  label: string
  offset: number
}

interface PlanGridCoordinates {
  eastings: GridCoordinateTick[]
  northings: GridCoordinateTick[]
}

const EMPTY_GRID_COORDINATES: PlanGridCoordinates = { eastings: [], northings: [] }

function planGridCoordinates(camera: THREE.PerspectiveCamera, baseY: number, bounds: SceneBounds, spacing: number): PlanGridCoordinates {
  camera.updateMatrixWorld()
  const raycaster = new THREE.Raycaster()
  const intersections: THREE.Vector3[] = []
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
    if (Math.abs(raycaster.ray.direction.y) < 1e-6) return EMPTY_GRID_COORDINATES
    const distance = (baseY - raycaster.ray.origin.y) / raycaster.ray.direction.y
    if (distance <= 0) return EMPTY_GRID_COORDINATES
    intersections.push(raycaster.ray.at(distance, new THREE.Vector3()))
  }
  const centreX = (bounds.minX + bounds.maxX) / 2
  const centreY = (bounds.minY + bounds.maxY) / 2
  const eastings = intersections.map((point) => point.x + centreX)
  const northings = intersections.map((point) => centreY - point.z)
  const minimumEasting = Math.min(...eastings)
  const maximumEasting = Math.max(...eastings)
  const minimumNorthing = Math.min(...northings)
  const maximumNorthing = Math.max(...northings)
  const eastingTicks = gridCoordinateValues(minimumEasting, maximumEasting, spacing, Math.max(5, Math.min(12, Math.round(camera.aspect * 8))))
  const northingTicks = gridCoordinateValues(minimumNorthing, maximumNorthing, spacing, 8)
  return {
    eastings: eastingTicks.map(({ offset, value }) => ({ key: `e-${value}`, label: `E ${formatGridCoordinate(value)}`, offset })),
    northings: northingTicks.map(({ offset, value }) => ({ key: `n-${value}`, label: `N ${formatGridCoordinate(value)}`, offset: 1 - offset })),
  }
}

function isLightSceneColor(color: THREE.Color) {
  return color.r * .2126 + color.g * .7152 + color.b * .0722 > .48
}

function vectorFromPoint(point: ScenePoint3D, bounds: SceneBounds, verticalExaggeration: number) {
  const converted = dataPointToThree(point, bounds, verticalExaggeration)
  return new THREE.Vector3(converted.x, converted.y, converted.z)
}

function cylinderBetween(from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material) {
  const direction = new THREE.Vector3().subVectors(to, from)
  const geometry = new THREE.CylinderGeometry(radius, radius, Math.max(.01, direction.length()), 8, 1, false)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.copy(from).add(to).multiplyScalar(.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  return mesh
}

function sectionCorners(section: Scene3DSection, bounds: SceneBounds, verticalExaggeration: number, offset: number) {
  const azimuth = section.azimuth * Math.PI / 180
  const sectionLength = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * .8
  const along = { x: Math.sin(azimuth), y: Math.cos(azimuth) }
  const normal = { x: Math.cos(azimuth), y: -Math.sin(azimuth) }
  const dip = Math.abs(section.dip) * Math.PI / 180
  const dipSign = section.dip < 0 ? -1 : 1
  const down = { x: normal.x * Math.cos(dip), y: normal.y * Math.cos(dip), z: -Math.sin(dip) * dipSign }
  const extent = Math.max((bounds.maxZ - bounds.minZ) * .62, section.corridor, 110)
  const centreX = section.centreX + normal.x * offset
  const centreY = section.centreY + normal.y * offset
  return [
    { x: centreX - along.x * sectionLength - down.x * extent, y: centreY - along.y * sectionLength - down.y * extent, z: section.centreZ - down.z * extent },
    { x: centreX + along.x * sectionLength - down.x * extent, y: centreY + along.y * sectionLength - down.y * extent, z: section.centreZ - down.z * extent },
    { x: centreX + along.x * sectionLength + down.x * extent, y: centreY + along.y * sectionLength + down.y * extent, z: section.centreZ + down.z * extent },
    { x: centreX - along.x * sectionLength + down.x * extent, y: centreY - along.y * sectionLength + down.y * extent, z: section.centreZ + down.z * extent },
  ].map((point) => vectorFromPoint(point, bounds, verticalExaggeration))
}

function addSectionPlane(runtime: SceneRuntime, points: THREE.Vector3[], opacity: number, wireframe = false) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  const material = new THREE.MeshBasicMaterial({
    color: wireframe ? 0x75bdaa : 0x5db59d,
    depthWrite: false,
    opacity,
    side: THREE.DoubleSide,
    transparent: true,
    wireframe,
  })
  runtime.content.add(new THREE.Mesh(geometry, material))
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x87cbb8, opacity: wireframe ? .45 : .9, transparent: true }),
  )
  runtime.content.add(outline)
}

function addInfiniteReferenceGrid(runtime: SceneRuntime, spacing: number, baseY: number, bounds: SceneBounds, lightBackground: boolean) {
  const centreX = (bounds.minX + bounds.maxX) / 2
  const centreY = (bounds.minY + bounds.maxY) / 2
  const size = Math.max(250_000, spacing * 4_000)
  const geometry = new THREE.PlaneGeometry(size, size)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.ShaderMaterial({
    depthWrite: false,
    fragmentShader: `
      precision highp float;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uSpacing;
      varying vec2 vAbsoluteCoordinate;

      float gridLine(float coordinate) {
        float width = max(fwidth(coordinate), 0.0001);
        float distanceToLine = abs(fract(coordinate - 0.5) - 0.5) / width;
        return 1.0 - smoothstep(0.14, 0.50, distanceToLine);
      }

      float dashMask(float coordinate) {
        float phase = fract(coordinate);
        float edge = min(0.08, max(fwidth(coordinate) * 1.4, 0.008));
        return 1.0 - smoothstep(0.44 - edge, 0.44 + edge, phase);
      }

      void main() {
        vec2 grid = vAbsoluteCoordinate / uSpacing;
        float eastingLine = gridLine(grid.x) * dashMask(grid.y / 0.09);
        float northingLine = gridLine(grid.y) * dashMask(grid.x / 0.09);
        float alpha = max(eastingLine, northingLine) * uOpacity;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: true,
    uniforms: {
      uColor: { value: new THREE.Color(lightBackground ? 0xb8c0c4 : 0xd4dadd) },
      uCoordinateCentre: { value: new THREE.Vector2(centreX, centreY) },
      uOpacity: { value: lightBackground ? .78 : .68 },
      uSpacing: { value: spacing },
    },
    vertexShader: `
      precision highp float;
      uniform vec2 uCoordinateCentre;
      varying vec2 vAbsoluteCoordinate;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vAbsoluteCoordinate = vec2(worldPosition.x + uCoordinateCentre.x, uCoordinateCentre.y - worldPosition.z);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
  })
  const grid = new THREE.Mesh(geometry, material)
  grid.position.y = baseY
  grid.renderOrder = -10
  runtime.infiniteGrid = grid
  runtime.content.add(grid)
}

function buildSceneContent(runtime: SceneRuntime, props: GeoEyeScene3DProps) {
  clearContent(runtime)
  const {
    backgroundColor, bounds, gridDensity, holes, labels, opacity, section, showAxes, showAxisNumbers, showAxisTitles, showCollars, showGrid, showIntervals,
    showTrajectories, structures, verticalExaggeration,
  } = props
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, (bounds.maxZ - bounds.minZ) * verticalExaggeration, 1)
  const sceneColor = new THREE.Color(backgroundColor)
  runtime.scene.background = sceneColor
  runtime.scene.fog = new THREE.FogExp2(sceneColor, Math.min(.0011, .48 / Math.max(span, 250)))
  const baseY = dataPointToThree({ x: bounds.minX, y: bounds.minY, z: bounds.minZ }, bounds, verticalExaggeration).y

  const horizontalSpan = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
  const step = gridStepForDensity(horizontalSpan, gridDensity)

  if (showGrid) addInfiniteReferenceGrid(runtime, step, baseY, bounds, isLightSceneColor(sceneColor))

  if (showAxes) {
    const origin = vectorFromPoint({ x: bounds.minX, y: bounds.minY, z: bounds.minZ }, bounds, verticalExaggeration)
    const extents = sceneAxisExtents(bounds, verticalExaggeration)
    const axisSpan = Math.max(extents.x.sceneLength, extents.y.sceneLength, extents.z.sceneLength)
    const tickSize = Math.max(.6, axisSpan * .012)
    const axisRadius = Math.max(.12, axisSpan * .0012)
    const lightBackground = isLightSceneColor(sceneColor)
    origin.y += Math.max(.08, axisSpan * .0005)
    const axes = [
      { color: lightBackground ? 0xb5142f : 0xff756f, colorCss: lightBackground ? '#a80f2a' : '#ff918c', extent: extents.x, label: 'X', title: 'X · Easting', offset: new THREE.Vector3(extents.x.sceneLength, 0, 0), tick: new THREE.Vector3(0, 0, tickSize) },
      { color: lightBackground ? 0x005a9c : 0x60b7ff, colorCss: lightBackground ? '#00558f' : '#7bc4ff', extent: extents.y, label: 'Y', title: 'Y · Northing', offset: new THREE.Vector3(0, 0, -extents.y.sceneLength), tick: new THREE.Vector3(-tickSize, 0, 0) },
      { color: lightBackground ? 0x08743c : 0x62dda0, colorCss: lightBackground ? '#086b38' : '#76e8ad', extent: extents.z, label: 'Z', title: 'Z · RL', offset: new THREE.Vector3(0, extents.z.sceneLength, 0), tick: new THREE.Vector3(-tickSize, 0, 0) },
    ]
    axes.forEach((axis) => {
      const endpoint = origin.clone().add(axis.offset)
      const material = new THREE.MeshBasicMaterial({ color: axis.color, depthTest: false, fog: false, toneMapped: false })
      const axisLine = cylinderBetween(origin, endpoint, axisRadius, material)
      axisLine.renderOrder = 100
      runtime.content.add(axisLine)
      if (showAxisNumbers) {
        sceneAxisTicks(axis.extent.minimum, axis.extent.maximum).forEach(({ ratio, value }) => {
          const point = origin.clone().addScaledVector(axis.offset, ratio)
          const tick = cylinderBetween(
            point.clone().addScaledVector(axis.tick, -.5),
            point.clone().addScaledVector(axis.tick, .5),
            axisRadius * .72,
            material,
          )
          tick.renderOrder = 100
          runtime.content.add(tick)
          runtime.content.add(labelObject(
            runtime,
            formatAxisNumber(value),
            `geoeye-scene3d-label is-axis-number is-axis-${axis.label.toLowerCase()}`,
            point.clone().addScaledVector(axis.tick, 1.05),
            axis.colorCss,
          ))
        })
      }
      if (showAxisTitles) runtime.content.add(labelObject(
        runtime,
        axis.title,
        `geoeye-scene3d-label is-axis-title is-axis-${axis.label.toLowerCase()}`,
        endpoint.clone().addScaledVector(axis.offset.clone().normalize(), tickSize * 2.1),
        axis.colorCss,
      ))
    })
  }

  if (section.visible) {
    addSectionPlane(runtime, sectionCorners(section, bounds, verticalExaggeration, 0), .13)
    addSectionPlane(runtime, sectionCorners(section, bounds, verticalExaggeration, section.front), .045, true)
    addSectionPlane(runtime, sectionCorners(section, bounds, verticalExaggeration, -section.back), .045, true)
  }

  const collarRadius = Math.max(.8, span * .006)
  holes.forEach((hole) => {
    const collar = vectorFromPoint(hole.collar, bounds, verticalExaggeration)
    if (showTrajectories && hole.trajectory.length > 1) {
      const trajectory = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(hole.trajectory.map((point) => vectorFromPoint(point, bounds, verticalExaggeration))),
        new THREE.LineBasicMaterial({ color: 0xb3c7c0, opacity: .5, transparent: true }),
      )
      runtime.content.add(trajectory)
    }
    if (showCollars) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(collarRadius, 14, 10),
        new THREE.MeshStandardMaterial({ color: 0xe5eee9, emissive: 0x243d35, emissiveIntensity: .45, roughness: .48 }),
      )
      marker.position.copy(collar)
      runtime.content.add(marker)
      if (labels) runtime.content.add(labelObject(runtime, hole.id, 'geoeye-scene3d-label is-collar', collar.clone().add(new THREE.Vector3(collarRadius * 1.4, collarRadius * 1.5, 0))))
    }

    if (!showIntervals) return
    hole.intervals.forEach((interval) => {
      const from = vectorFromPoint(interval.from, bounds, verticalExaggeration)
      const to = vectorFromPoint(interval.to, bounds, verticalExaggeration)
      const radius = Math.max(.45, Math.min(span * .018, span * interval.thickness / 2_000))
      const emissive = interval.selected ? 0xffd998 : interval.queryMatched ? 0x76d8c1 : interval.linked ? 0xf18744 : 0x000000
      const intervalOpacity = interval.faded ? .12 : opacity
      const material = new THREE.MeshStandardMaterial({
        color: interval.color,
        depthWrite: intervalOpacity > .5,
        emissive,
        emissiveIntensity: interval.selected ? .72 : interval.queryMatched || interval.linked ? .48 : 0,
        metalness: .05,
        opacity: intervalOpacity,
        roughness: .42,
        transparent: intervalOpacity < 1,
      })
      const mesh = cylinderBetween(from, to, interval.selected ? radius * 1.42 : interval.queryMatched || interval.linked ? radius * 1.2 : radius, material)
      mesh.userData = { id: interval.id, kind: 'interval', title: interval.title }
      runtime.pickables.push(mesh)
      runtime.content.add(mesh)
      if (labels && (interval.selected || interval.linked || interval.queryMatched)) {
        runtime.content.add(labelObject(runtime, interval.label, 'geoeye-scene3d-label is-interval', to.clone()))
      }
    })
  })

  structures.forEach((structure) => {
    const radius = Math.max(span * .012, Math.min(span * .045, span * (.014 + structure.persistence * .002)))
    const geometry = new THREE.CircleGeometry(radius, 24)
    const material = new THREE.MeshStandardMaterial({
      color: structure.color,
      depthWrite: false,
      opacity: structure.kind === 'fault' ? .58 : .38,
      side: THREE.DoubleSide,
      transparent: true,
    })
    const disc = new THREE.Mesh(geometry, material)
    const dip = Math.min(89.5, Math.abs(structure.trueDip)) * Math.PI / 180
    const azimuth = structure.dipDirection * Math.PI / 180
    const normal = new THREE.Vector3(Math.sin(dip) * Math.sin(azimuth), Math.cos(dip), -Math.sin(dip) * Math.cos(azimuth)).normalize()
    disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
    disc.position.copy(vectorFromPoint(structure.point, bounds, verticalExaggeration))
    disc.userData = { id: structure.rowId, kind: 'structure', title: structure.label }
    runtime.pickables.push(disc)
    runtime.content.add(disc)
  })

  runtime.scheduler.flush()
}

interface SceneOrientationGizmoHandle {
  setQuaternion: (quaternion: OrientationQuaternion) => void
}

interface SceneOrientationGizmoProps {
  active: boolean
  activePreset: OrientationPreset | null
  initialQuaternion: OrientationQuaternion
  onOrbit: (deltaX: number, deltaY: number) => void
  onPreset: (preset: OrientationPreset) => void
  visible: boolean
}

const GIZMO_SHORTCUTS: Readonly<Record<string, OrientationPreset>> = {
  0: 'isometric',
  d: 'top',
  e: 'east',
  n: 'north',
  s: 'south',
  u: 'bottom',
  w: 'west',
}

const GIZMO_PRESET_LABELS: Readonly<Record<Exclude<OrientationPreset, 'isometric'>, string>> = {
  bottom: 'Look up (U)',
  east: 'Look east (E)',
  north: 'Look north (N)',
  south: 'Look south (S)',
  top: 'Look down, planar view (D)',
  west: 'Look west (W)',
}

function presetForCameraMode(cameraMode: ThreeCameraMode): OrientationPreset | null {
  if (cameraMode === 'plan') return 'top'
  if (cameraMode === 'north' || cameraMode === 'east' || cameraMode === 'isometric') return cameraMode
  return null
}

const SceneOrientationGizmo = forwardRef<SceneOrientationGizmoHandle, SceneOrientationGizmoProps>(function SceneOrientationGizmo(
  { active, activePreset, initialQuaternion, onOrbit, onPreset, visible },
  ref,
) {
  const [cameraQuaternion, setCameraQuaternion] = useState<OrientationQuaternion>(initialQuaternion)
  const [hoveredDirection, setHoveredDirection] = useState<OrientationPreset | null>(null)
  const [dragging, setDragging] = useState(false)
  const [orientationMoving, setOrientationMoving] = useState(false)
  const cameraQuaternionRef = useRef<OrientationQuaternion>(cameraQuaternion)
  const rootRef = useRef<HTMLDivElement>(null)
  const orientationSettleRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const shortcutClearRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const dragRef = useRef<{
    id: number
    lastX: number
    lastY: number
    moved: boolean
    preset: OrientationPreset | null
    startX: number
    startY: number
  } | null>(null)
  const suppressClickRef = useRef(false)
  const geometry = useMemo(
    () => createOrientationGizmoGeometry(cameraQuaternion, { x: 0, y: 0 }),
    [cameraQuaternion],
  )
  const viewLetter = useMemo(() => orientationViewLetter(cameraQuaternion), [cameraQuaternion])

  useImperativeHandle(ref, () => ({
    setQuaternion(next) {
      const current = cameraQuaternionRef.current
      const unchanged = Math.abs(current[0] - next[0]) < .00001
        && Math.abs(current[1] - next[1]) < .00001
        && Math.abs(current[2] - next[2]) < .00001
        && Math.abs(current[3] - next[3]) < .00001
      if (unchanged) return
      const updated: OrientationQuaternion = [next[0], next[1], next[2], next[3]]
      cameraQuaternionRef.current = updated
      setCameraQuaternion(updated)
      setOrientationMoving(true)
      if (orientationSettleRef.current !== null) globalThis.clearTimeout(orientationSettleRef.current)
      orientationSettleRef.current = globalThis.setTimeout(() => {
        orientationSettleRef.current = null
        setOrientationMoving(false)
      }, 140)
    },
  }), [])

  useEffect(() => {
    if (!active) return
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target as Element | null
      if (target !== null && target.closest('input, textarea, select, [contenteditable="true"]') !== null) return
      if (rootRef.current === null || rootRef.current.getClientRects().length === 0) return
      const preset = GIZMO_SHORTCUTS[event.key.toLowerCase()]
      if (preset === undefined) return
      event.preventDefault()
      onPreset(preset)
      setHoveredDirection(preset)
      if (shortcutClearRef.current !== null) globalThis.clearTimeout(shortcutClearRef.current)
      shortcutClearRef.current = globalThis.setTimeout(() => {
        shortcutClearRef.current = null
        setHoveredDirection(null)
      }, 420)
    }
    globalThis.addEventListener('keydown', handleShortcut)
    return () => globalThis.removeEventListener('keydown', handleShortcut)
  }, [active, onPreset])

  useEffect(() => () => {
    if (shortcutClearRef.current !== null) globalThis.clearTimeout(shortcutClearRef.current)
    if (orientationSettleRef.current !== null) globalThis.clearTimeout(orientationSettleRef.current)
  }, [])

  const activatePreset = (preset: OrientationPreset) => {
    if (!active) return
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    onPreset(preset)
  }
  const activateFromKeyboard = (event: ReactKeyboardEvent<SVGElement>, preset: OrientationPreset) => {
    if (!active || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onPreset(preset)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!active) return
    if (event.button !== 0) return
    suppressClickRef.current = false
    const presetValue = (event.target as Element).closest<SVGElement>('[data-orientation-preset]')?.dataset.orientationPreset
    const preset = presetValue === undefined ? null : presetValue as OrientationPreset
    dragRef.current = {
      id: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      preset,
      startX: event.clientX,
      startY: event.clientY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.id !== event.pointerId) return
    const deltaX = event.clientX - drag.lastX
    const deltaY = event.clientY - drag.lastY
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3
    if (deltaX !== 0 || deltaY !== 0) onOrbit(deltaX, deltaY)
  }
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.id !== event.pointerId) return
    suppressClickRef.current = drag.moved || drag.preset !== null
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
    if (!drag.moved && drag.preset !== null) onPreset(drag.preset)
    globalThis.setTimeout(() => { suppressClickRef.current = false }, 0)
  }

  return <div
    aria-disabled={!active}
    aria-label="3D orientation controls. Drag to orbit, use 0 for isometric, or use D, U, W, E, N and S shortcuts."
    className={`geoeye-scene3d-compass${dragging ? ' is-dragging' : ''}${orientationMoving ? ' is-orbiting' : ''}`}
    hidden={!visible}
    onPointerCancel={handlePointerUp}
    onPointerDown={handlePointerDown}
    onPointerLeave={() => setHoveredDirection(null)}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerUp}
    ref={rootRef}
    role="group"
  >
    <svg aria-label={`Current geological view ${viewLetter}`} role="group" viewBox="0 0 120 120">
      <title>Current view: {viewLetter}. Drag to orbit or select a face to align the camera.</title>
      <circle aria-hidden="true" className="compass-orbit-ring" cx="60" cy="54" r="45" />
      <path aria-hidden="true" className="compass-orbit-tick is-top" d="M60 6v4" />
      <path aria-hidden="true" className="compass-orbit-tick is-right" d="M104 54h4" />
      <path aria-hidden="true" className="compass-orbit-tick is-bottom" d="M60 98v4" />
      <path aria-hidden="true" className="compass-orbit-tick is-left" d="M12 54h4" />
      <g aria-hidden="true" className="compass-wireframe">
        {geometry.faces.filter((face) => !face.visible).map((face) => <polygon key={face.key} points={face.points} />)}
      </g>
      <g className="compass-cube">
        {geometry.faces.map((face) => <g
          aria-hidden={!face.visible}
          aria-label={GIZMO_PRESET_LABELS[face.key]}
          className={`compass-face ${face.className}${face.visible ? ' is-visible' : ''}${activePreset === face.key ? ' is-active' : ''}${hoveredDirection === face.key ? ' is-hovered' : ''}`}
          data-orientation-preset={face.key}
          key={face.key}
          onClick={() => activatePreset(face.key)}
          onFocus={() => setHoveredDirection(face.key)}
          onBlur={() => setHoveredDirection(null)}
          onKeyDown={(event) => activateFromKeyboard(event, face.key)}
          onMouseEnter={() => setHoveredDirection(face.key)}
          onMouseLeave={() => setHoveredDirection(null)}
          pointerEvents={face.visible ? 'auto' : 'none'}
          role="button"
          tabIndex={active && face.visible ? 0 : -1}
        >
          <polygon points={face.points} />
          {face.visible ? <text dominantBaseline="central" x={Math.round(face.labelX)} y={Math.round(face.labelY - 2.5)}>{face.label}</text> : null}
        </g>)}
      </g>
    </svg>
  </div>
})

export default function GeoEyeScene3D(props: GeoEyeScene3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const orientationGizmoRef = useRef<SceneOrientationGizmoHandle>(null)
  const orientationQuaternionRef = useRef<OrientationQuaternion>([0, 0, 0, 1])
  const runtimeRef = useRef<SceneRuntime | null>(null)
  const activeRef = useRef(props.active)
  const toolRef = useRef(props.tool)
  const selectIntervalRef = useRef(props.onSelectInterval)
  const selectStructureRef = useRef(props.onSelectStructure)
  const [activePreset, setActivePreset] = useState<OrientationPreset | null>(() => presetForCameraMode(props.cameraMode))
  const [error, setError] = useState<string | null>(null)
  const [gridCoordinates, setGridCoordinates] = useState<PlanGridCoordinates>(EMPTY_GRID_COORDINATES)
  const [isPlanView, setIsPlanView] = useState(props.cameraMode === 'plan')
  const [viewportAspect, setViewportAspect] = useState(1)
  const gridCoordinateKeyRef = useRef('')
  const gridCoordinateSettingsRef = useRef({ baseY: 0, bounds: props.bounds, spacing: 1, visible: false })
  const isPlanViewRef = useRef(isPlanView)

  const activePresetRef = useRef(activePreset)
  const poseStorageKeyRef = useRef(props.poseStorageKey)
  const frameTriggerRef = useRef('')
  const lastFrameRef = useRef<{ fitRequest: number; trigger: string } | null>(null)
  const wasActiveRef = useRef(false)

  toolRef.current = props.tool
  activeRef.current = props.active
  activePresetRef.current = activePreset
  isPlanViewRef.current = isPlanView
  poseStorageKeyRef.current = props.poseStorageKey
  selectIntervalRef.current = props.onSelectInterval
  selectStructureRef.current = props.onSelectStructure
  const gridHorizontalSpan = Math.max(props.bounds.maxX - props.bounds.minX, props.bounds.maxY - props.bounds.minY)
  gridCoordinateSettingsRef.current = {
    baseY: dataPointToThree({ x: props.bounds.minX, y: props.bounds.minY, z: props.bounds.minZ }, props.bounds, props.verticalExaggeration).y,
    bounds: props.bounds,
    spacing: gridStepForDensity(gridHorizontalSpan, props.gridDensity),
    visible: props.showGrid && props.showGridCoordinates && isPlanView,
  }
  const cameraFrameTrigger = cameraFrameTriggerKey(
    props.bounds,
    props.cameraMode,
    props.zoom,
    props.verticalExaggeration,
    props.section,
  )
  frameTriggerRef.current = cameraFrameTrigger

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    // Development StrictMode recreates the Three.js runtime while retaining refs. Treat every
    // new runtime as an unframed camera so its first active frame is always initialized.
    lastFrameRef.current = null
    wasActiveRef.current = false
    let runtime: SceneRuntime | null = null
    let resizeObserver: ResizeObserver | null = null
    let pointerStart: { x: number; y: number } | null = null

    try {
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x123b36)
      scene.fog = new THREE.FogExp2(0x123b36, .0011)
      const camera = new THREE.PerspectiveCamera(50, 1, .1, 100_000)
      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.12
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.domElement.className = 'geoeye-scene3d-webgl'
      container.append(renderer.domElement)

      const labels = new CSS2DRenderer()
      labels.domElement.className = 'geoeye-scene3d-label-layer'
      container.append(labels.domElement)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = .08
      controls.keyPanSpeed = 14
      controls.minDistance = 4
      controls.maxDistance = 30_000
      controls.panSpeed = .75
      // Keep OrbitControls' object-drag convention so the rendered geology follows
      // the pointer instead of moving in the opposite direction.
      controls.rotateSpeed = .55
      controls.screenSpacePanning = true
      controls.zoomSpeed = .85

      const content = new THREE.Group()
      scene.add(content)
      scene.add(new THREE.HemisphereLight(0x9bc8e6, 0x33281e, 1.45))
      scene.add(new THREE.AmbientLight(0xffffff, .42))
      const keyLight = new THREE.DirectionalLight(0xfff0dd, 2.1)
      keyLight.position.set(1, 1.8, 1.2).normalize()
      scene.add(keyLight)

      let scheduler: SceneRenderScheduler
      let lastGizmoQuaternion: THREE.Quaternion | null = null
      scheduler = createSceneRenderScheduler(() => {
        const controlsChanged = controls.update()
        if (runtime?.infiniteGrid !== null && runtime?.infiniteGrid !== undefined) {
          runtime.infiniteGrid.position.x = controls.target.x
          runtime.infiniteGrid.position.z = controls.target.z
        }
        const viewDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
        const nextIsPlanView = viewDirection.y < -.9995
        if (nextIsPlanView !== isPlanViewRef.current) {
          isPlanViewRef.current = nextIsPlanView
          setIsPlanView(nextIsPlanView)
        }
        if (lastGizmoQuaternion === null || lastGizmoQuaternion.angleTo(camera.quaternion) > .00001) {
          const nextGizmoQuaternion: OrientationQuaternion = [
            camera.quaternion.x,
            camera.quaternion.y,
            camera.quaternion.z,
            camera.quaternion.w,
          ]
          orientationQuaternionRef.current = nextGizmoQuaternion
          orientationGizmoRef.current?.setQuaternion(nextGizmoQuaternion)
          lastGizmoQuaternion = camera.quaternion.clone()
        }
        const gridSettings = gridCoordinateSettingsRef.current
        const nextGridCoordinates = gridSettings.visible
          ? planGridCoordinates(camera, gridSettings.baseY, gridSettings.bounds, gridSettings.spacing)
          : EMPTY_GRID_COORDINATES
        const coordinateKey = [
          ...nextGridCoordinates.eastings.map((tick) => `${tick.label}:${tick.offset.toFixed(3)}`),
          '|',
          ...nextGridCoordinates.northings.map((tick) => `${tick.label}:${tick.offset.toFixed(3)}`),
        ].join(',')
        if (coordinateKey !== gridCoordinateKeyRef.current) {
          gridCoordinateKeyRef.current = coordinateKey
          setGridCoordinates(nextGridCoordinates)
        }
        renderer.render(scene, camera)
        labels.render(scene, camera)
        if (controlsChanged) scheduler.request()
      })
      runtime = { camera, content, controls, infiniteGrid: null, labels, labelElements: [], pickables: [], renderer, scene, scheduler }
      runtimeRef.current = runtime

      const resize = () => {
        const width = Math.max(1, container.clientWidth)
        const height = Math.max(1, container.clientHeight)
        renderer.setSize(width, height, false)
        labels.setSize(width, height)
        const aspect = width / height
        camera.aspect = aspect
        camera.updateProjectionMatrix()
        setViewportAspect((current) => Math.abs(current - aspect) < .001 ? current : aspect)
        scheduler.request()
      }
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(container)
      resize()

      let poseTimer: number | undefined
      const savePose = () => {
        poseTimer = undefined
        if (poseStorageKeyRef.current === undefined) return
        const pose: SavedScenePose = {
          position: camera.position.toArray(),
          preset: activePresetRef.current,
          target: controls.target.toArray(),
          trigger: frameTriggerRef.current,
          up: camera.up.toArray(),
        }
        saveWorkspaceState(poseStorageKeyRef.current, pose)
      }
      const requestRender = () => {
        scheduler.request()
        window.clearTimeout(poseTimer)
        poseTimer = window.setTimeout(savePose, 250)
      }
      const clearPreset = () => setActivePreset(null)
      controls.addEventListener('change', requestRender)
      controls.addEventListener('start', clearPreset)
      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      const hitAt = (event: PointerEvent) => {
        const bounds = renderer.domElement.getBoundingClientRect()
        pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1)
        raycaster.setFromCamera(pointer, camera)
        return raycaster.intersectObjects(runtime?.pickables ?? [], false)[0]?.object
      }
      const pointerDown = (event: PointerEvent) => {
        if (!activeRef.current) return
        if (event.button !== 0) return
        pointerStart = { x: event.clientX, y: event.clientY }
      }
      const pointerMove = (event: PointerEvent) => {
        if (!activeRef.current) {
          renderer.domElement.classList.remove('is-over-object')
          return
        }
        renderer.domElement.classList.toggle('is-over-object', SELECT_TOOLS.has(toolRef.current) && hitAt(event) !== undefined)
      }
      const pointerUp = (event: PointerEvent) => {
        if (!activeRef.current) {
          pointerStart = null
          return
        }
        const start = pointerStart
        pointerStart = null
        if (!SELECT_TOOLS.has(toolRef.current) || start === null) return
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return
        const object = hitAt(event)
        if (object?.userData.kind === 'interval') selectIntervalRef.current(String(object.userData.id))
        else if (object?.userData.kind === 'structure') selectStructureRef.current(String(object.userData.id))
      }
      const contextLost = (event: Event) => {
        event.preventDefault()
        setError('The 3D graphics context was interrupted. Reload the view to restore it.')
      }
      renderer.domElement.addEventListener('pointerdown', pointerDown)
      renderer.domElement.addEventListener('pointermove', pointerMove)
      renderer.domElement.addEventListener('pointerup', pointerUp)
      renderer.domElement.addEventListener('webglcontextlost', contextLost)

      return () => {
        if (poseTimer !== undefined) {
          window.clearTimeout(poseTimer)
          savePose()
        }
        resizeObserver?.disconnect()
        controls.removeEventListener('change', requestRender)
        controls.removeEventListener('start', clearPreset)
        renderer.domElement.removeEventListener('pointerdown', pointerDown)
        renderer.domElement.removeEventListener('pointermove', pointerMove)
        renderer.domElement.removeEventListener('pointerup', pointerUp)
        renderer.domElement.removeEventListener('webglcontextlost', contextLost)
        scheduler.dispose()
        controls.dispose()
        clearContent(runtime as SceneRuntime)
        renderer.dispose()
        renderer.domElement.remove()
        labels.domElement.remove()
        runtimeRef.current = null
      }
    } catch (reason) {
      runtimeRef.current = null
      setError(reason instanceof Error ? reason.message : 'WebGL is unavailable on this device.')
      runtime?.renderer.dispose()
    }
  }, [])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (runtime !== null) buildSceneContent(runtime, {
      ...props,
      showAxes: props.showAxes && activePreset !== 'top',
      showGrid: props.showGrid && isPlanView,
    })
  }, [
    props.backgroundColor, props.bounds, props.holes, props.labels, props.opacity, props.section,
    props.gridDensity, props.showAxes, props.showAxisNumbers, props.showAxisTitles, props.showCollars, props.showGrid, props.showGridCoordinates, props.showIntervals, props.showTrajectories, props.structures, props.verticalExaggeration,
    activePreset, isPlanView,
  ])

  useEffect(() => setActivePreset(presetForCameraMode(props.cameraMode)), [props.cameraMode])

  useEffect(() => {
    if (props.showGizmo) orientationGizmoRef.current?.setQuaternion(orientationQuaternionRef.current)
  }, [props.showGizmo])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (runtime === null) return
    runtime.controls.enabled = props.active
    runtime.controls.enablePan = true
    runtime.controls.enableRotate = true
    runtime.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
    runtime.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
    runtime.renderer.domElement.setAttribute('aria-label', props.active
      ? `${props.cameraMode} geological scene; drag to orbit, right-drag to pan, scroll or pinch to zoom, and click or tap to select`
      : `${props.cameraMode} geological scene; inactive, click the viewport to activate`)
    runtime.scheduler.request()
  }, [props.active, props.cameraMode, props.tool])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (runtime === null) return
    const frame = cameraFrameForBounds(
      props.bounds,
      props.cameraMode,
      viewportAspect,
      props.zoom,
      props.verticalExaggeration,
      props.section,
    )
    // Re-frame on a deliberate change (mode, zoom, fit, section, data) and whenever a pane
    // becomes active. Inactive panes may restore their last pose, but the active workspace must
    // always open fitted to the dataset instead of inheriting an old pan or zoom offset.
    const last = lastFrameRef.current
    const firstFrame = last === null
    const reframed = !firstFrame && (last.fitRequest !== props.fitRequest || last.trigger !== cameraFrameTrigger)
    const becameActive = props.active && !wasActiveRef.current
    lastFrameRef.current = { fitRequest: props.fitRequest, trigger: cameraFrameTrigger }
    wasActiveRef.current = props.active
    const pose = firstFrame ? loadScenePose(props.poseStorageKey, cameraFrameTrigger) : null
    runtime.camera.near = frame.near
    runtime.camera.far = frame.far
    if (reframed || becameActive || (firstFrame && pose === null)) {
      runtime.camera.position.set(frame.position.x, frame.position.y, frame.position.z)
      runtime.camera.up.set(frame.up.x, frame.up.y, frame.up.z)
      runtime.controls.target.set(frame.target.x, frame.target.y, frame.target.z)
      const preset = presetForCameraMode(props.cameraMode)
      activePresetRef.current = preset
      setActivePreset(preset)
    } else if (pose !== null) {
      const offset = new THREE.Vector3().fromArray(pose.position).sub(new THREE.Vector3().fromArray(pose.target))
      runtime.controls.target.set(frame.target.x, frame.target.y, frame.target.z)
      runtime.camera.position.copy(runtime.controls.target).add(offset)
      runtime.camera.up.fromArray(pose.up)
      // Update the ref too: a pose save can run before the next render picks the preset up.
      activePresetRef.current = pose.preset
      setActivePreset(pose.preset)
    }
    runtime.camera.updateProjectionMatrix()
    runtime.controls.update()
    runtime.scheduler.flush()
  }, [cameraFrameTrigger, props.active, props.fitRequest, viewportAspect])

  const orbitFromGizmo = (deltaX: number, deltaY: number) => {
    if (!props.active) return
    const runtime = runtimeRef.current
    if (runtime === null) return
    setActivePreset(null)
    const offset = runtime.camera.position.clone().sub(runtime.controls.target)
    const spherical = new THREE.Spherical().setFromVector3(offset)
    const radiansPerPixel = .012
    spherical.theta += deltaX * radiansPerPixel
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi + deltaY * radiansPerPixel,
      Math.max(.015, runtime.controls.minPolarAngle),
      Math.min(Math.PI - .015, runtime.controls.maxPolarAngle),
    )
    runtime.camera.up.set(0, 1, 0)
    runtime.camera.position.copy(runtime.controls.target).add(offset.setFromSpherical(spherical))
    runtime.camera.lookAt(runtime.controls.target)
    runtime.controls.update()
    runtime.scheduler.flush()
  }

  const alignFromGizmo = (preset: OrientationPreset) => {
    if (!props.active) return
    const runtime = runtimeRef.current
    if (runtime === null) return
    setActivePreset(preset)
    const distance = Math.max(runtime.controls.minDistance, runtime.camera.position.distanceTo(runtime.controls.target))
    const direction = {
      bottom: new THREE.Vector3(0, -1, 0),
      east: new THREE.Vector3(1, 0, 0),
      isometric: new THREE.Vector3(1, .72, 1.08),
      north: new THREE.Vector3(0, 0, -1),
      south: new THREE.Vector3(0, 0, 1),
      top: new THREE.Vector3(0, 1, 0),
      west: new THREE.Vector3(-1, 0, 0),
    }[preset].normalize()
    runtime.camera.up.set(0, preset === 'bottom' ? 0 : preset === 'top' ? 0 : 1, preset === 'bottom' ? 1 : preset === 'top' ? -1 : 0)
    runtime.camera.position.copy(runtime.controls.target).addScaledVector(direction, distance)
    runtime.camera.lookAt(runtime.controls.target)
    runtime.controls.update()
    runtime.scheduler.flush()
  }

  return <div
    aria-label={`${props.cameraMode} geological analysis scene`}
    className="geoeye-scene3d"
    data-active={props.active}
    data-axis-visible={props.showAxes && activePreset !== 'top'}
    data-grid-visible={props.showGrid && isPlanView}
    data-text-box="false"
    data-view-preset={activePreset ?? 'free'}
    ref={containerRef}
    role="region"
    style={{
      '--scene-text-background': 'transparent',
      '--scene-text-color': props.screenText.color,
      '--scene-text-font': sceneTextFontFamily(props.screenText.font),
      '--scene-text-size': `${props.screenText.size}px`,
    } as CSSProperties}
  >
    {error === null ? null : <div className="geoeye-scene3d-error"><strong>3D view unavailable</strong><span>{error}</span></div>}
    {props.showGrid && props.showGridCoordinates && isPlanView ? <div aria-hidden="true" className="geoeye-scene3d-grid-coordinates">
      {gridCoordinates.eastings.map((tick) => <span className="is-easting" key={tick.key} style={{ left: `${tick.offset * 100}%` }}>{tick.label}</span>)}
      {gridCoordinates.northings.map((tick) => <span className="is-northing" key={tick.key} style={{ top: `${tick.offset * 100}%` }}>{tick.label}</span>)}
    </div> : null}
    <SceneOrientationGizmo
      active={props.active && props.showGizmo}
      activePreset={activePreset}
      initialQuaternion={orientationQuaternionRef.current}
      onOrbit={orbitFromGizmo}
      onPreset={alignFromGizmo}
      ref={orientationGizmoRef}
      visible={props.showGizmo}
    />
  </div>
}
