import { Check, ChevronDown, CopyPlus, Download, Eye, EyeOff, MousePointer2, Pencil, Pentagon, Plus, Save, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { analyzeStructure } from '../analysis/structureAnalysis.js'
import type { StructurePoint, StructureTypeId } from '../analysis/structureAnalysis.js'
import { isBoundaryComplete, pointInPolygon, projectStructurePoint, Stereonet } from '../components/Stereonet.js'
import type { BoundaryDrawingMode, DensityDistribution, DensityPalettePreset, DensitySurfaceMode, PlotCoordinate, StereonetPlotMode, StereonetProjection } from '../components/Stereonet.js'
import { readDrillholeImport } from '../data/drillholeImportStore.js'
import { recordAnalysisTemplateSave } from '../data/analysisSaveStore.js'
import { barGraphImage, svgElementPngGraphImage } from '../data/analysisGraphImages.js'
import { saveAnalysisResultPackage } from '../data/analysisResultStore.js'
import { saveStructureDerivedValues } from '../data/structureDerivedStore.js'
import { nextStructureLogVersionNumber, readLatestStructureLogVersion, readStructureLogVersions, writeStructureLogVersion } from '../data/structureLogStore.js'
import { useStereonetTheme } from '../state/StereonetThemeContext.js'
import { usePersistentState } from '../state/persistentState.js'
import {
  fallbackStructureCollars,
  fallbackStructureSurveys,
  fieldStructureObservations,
  structureTemplates,
} from '../data/structureDemo.js'

interface JointCategory {
  boundary?: PlotCoordinate[]
  color: string
  id: string
  label: string
}

const initialCategories: JointCategory[] = [
  { id: 'J1', label: 'J1', color: '#e1843f' },
  { id: 'J2', label: 'J2', color: '#31968b' },
  { id: 'J3', label: 'J3', color: '#7a68a6' },
  { id: 'U', label: 'Unassigned', color: '#9ba39f' },
]

const initialStructureTypeCategories: JointCategory[] = [
  { id: 'unclassified', label: 'Unclassified', color: '#9aa4ad' },
  { id: 'joint', label: 'Joint · JN', color: '#315ee8' },
  { id: 'fz-top', label: 'Fracture zone top', color: '#e34545' },
  { id: 'fz-bottom', label: 'Fracture zone bottom', color: '#f08a32' },
  { id: 'fault', label: 'Fault · FT', color: '#8656c7' },
]

const extraColors = ['#d75074', '#4e86c5', '#a68a37', '#5f8d55']

function TrapezoidIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <path d="M7 5h10l4 14H3L7 5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}

function versionFromTemplate(templateId: string) {
  return Number(templateId.match(/v(\d+)$/)?.[1] ?? 1)
}

function labelWithVersion(label: string, version: number) {
  return label.replace(/v\d+$/, `v${version}`)
}

function circularMean(values: readonly number[]) {
  if (values.length === 0) return 0
  const vector = values.reduce((sum, value) => ({
    x: sum.x + Math.sin(value * Math.PI / 180),
    y: sum.y + Math.cos(value * Math.PI / 180),
  }), { x: 0, y: 0 })
  return (Math.atan2(vector.x, vector.y) * 180 / Math.PI + 360) % 360
}

function summarize(points: readonly StructurePoint[]) {
  if (points.length === 0) return { direction: 0, dip: 0, rValue: 0 }
  const direction = circularMean(points.map((point) => point.dipDirection))
  const dip = points.reduce((sum, point) => sum + point.trueDip, 0) / points.length
  const directionRadians = points.map((point) => point.dipDirection * Math.PI / 180)
  const x = directionRadians.reduce((sum, value) => sum + Math.sin(value), 0)
  const y = directionRadians.reduce((sum, value) => sum + Math.cos(value), 0)
  return { direction, dip, rValue: Math.sqrt(x * x + y * y) / points.length }
}

function mergeImportedDrillholes() {
  const imported = readDrillholeImport()
  if (imported === undefined) return {
    collars: fallbackStructureCollars,
    importedHoleIds: new Set<string>(),
    surveys: fallbackStructureSurveys,
  }
  const importedHoleIds = new Set([...imported.collar, ...imported.survey].map((record) => record.holeId))
  return {
    collars: [...fallbackStructureCollars.filter((record) => !importedHoleIds.has(record.holeId)), ...imported.collar],
    importedHoleIds,
    surveys: [...fallbackStructureSurveys.filter((record) => !importedHoleIds.has(record.holeId)), ...imported.survey],
  }
}

export function StructurePage() {
  const stereonetTheme = useStereonetTheme()
  const drillholeData = useMemo(mergeImportedDrillholes, [])
  const [templateId, setTemplateId] = usePersistentState('structure.templateId', structureTemplates[0].id)
  const [holeFilter, setHoleFilter] = usePersistentState('structure.holeFilter', 'all')
  const [structureTypeFilter, setStructureTypeFilter] = usePersistentState<'all' | StructureTypeId>('structure.structureTypeFilter', 'all')
  const [colorBy, setColorBy] = usePersistentState<'jointSet' | 'structureType'>('structure.colorBy', 'jointSet')
  const [activeSet, setActiveSet] = usePersistentState('structure.activeSet', 'all')
  const [hiddenSets, setHiddenSets] = usePersistentState<Set<string>>('structure.hiddenSets', new Set())
  const [hiddenStructureTypes, setHiddenStructureTypes] = usePersistentState<Set<string>>('structure.hiddenStructureTypes', new Set())
  const [visibleBoundaryIds, setVisibleBoundaryIds] = usePersistentState<Set<string>>('structure.visibleBoundaryIds', new Set())
  const [selectedPointIds, setSelectedPointIds] = usePersistentState<Set<string>>('structure.selectedPointIds', new Set())
  const [selectionMode, setSelectionMode] = usePersistentState<'point' | BoundaryDrawingMode | null>('structure.selectionMode', null)
  const [polygonVertices, setPolygonVertices] = usePersistentState<PlotCoordinate[]>('structure.polygonVertices', [])
  const [plotMode, setPlotMode] = usePersistentState<StereonetPlotMode>('structure.plotMode', 'density')
  const [projection, setProjection] = usePersistentState<StereonetProjection>('structure.projection', 'equalArea')
  const [densityPalette, setDensityPalette] = usePersistentState<DensityPalettePreset>('structure.densityPalette', 'spectrum')
  const [densitySurface, setDensitySurface] = usePersistentState<DensitySurfaceMode>('structure.densitySurface', 'filled')
  const [densityDistribution, setDensityDistribution] = usePersistentState<DensityDistribution>('structure.densityDistribution', 'schmidt')
  const [countCirclePercent, setCountCirclePercent] = usePersistentState('structure.countCirclePercent', 1)
  const [pointSize, setPointSize] = usePersistentState('structure.pointSize', 1)
  const [planeWidth, setPlaneWidth] = usePersistentState('structure.planeWidth', .75)
  const [categories, setCategories] = usePersistentState<JointCategory[]>('structure.categories', initialCategories)
  const [structureTypeCategories, setStructureTypeCategories] = usePersistentState<JointCategory[]>('structure.structureTypeCategories', initialStructureTypeCategories)
  const [customCategoryColors, setCustomCategoryColors] = usePersistentState<Record<string, string>>('structure.customCategoryColors', {})
  const [manualAssignments, setManualAssignments] = usePersistentState<Record<string, string>>('structure.manualAssignments', {})
  const [assignTarget, setAssignTarget] = usePersistentState('structure.assignTarget', 'J1')
  const [documentVersion, setDocumentVersion] = usePersistentState('structure.documentVersion', versionFromTemplate(structureTemplates[0].id))
  const [savedStatus, setSavedStatus] = usePersistentState<string | null>('structure.savedStatus', null)
  const [editingCategoryId, setEditingCategoryId] = usePersistentState<string | null>('structure.editingCategoryId', null)
  const [categoryNameDraft, setCategoryNameDraft] = usePersistentState('structure.categoryNameDraft', '')
  const [saveAsOpen, setSaveAsOpen] = useState(false)

  // The saved log is only reloaded when another template or hole is opened, so restored edits survive a remount.
  const documentKey = `${templateId}|${holeFilter}`
  const [loadedDocumentKey, setLoadedDocumentKey] = usePersistentState('structure.loadedDocumentKey', '')

  useEffect(() => {
    if (loadedDocumentKey === documentKey) return
    setLoadedDocumentKey(documentKey)
    const persisted = readLatestStructureLogVersion(templateId, holeFilter)
    if (persisted === undefined) {
      setDocumentVersion(versionFromTemplate(templateId))
      setCategories(initialCategories)
      setCustomCategoryColors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('jointSet:'))))
      setManualAssignments({})
      setAssignTarget('J1')
      setSavedStatus(null)
      setSelectedPointIds(new Set())
      setActiveSet('all')
      setSelectionMode(null)
      setPolygonVertices([])
      setVisibleBoundaryIds(new Set())
      return
    }
    const persistedCategories = persisted.sets.map((category) => ({
      ...(category.boundary === undefined ? {} : { boundary: category.boundary }),
      color: category.color,
      id: category.id,
      label: category.label,
    }))
    setDocumentVersion(persisted.version)
    setCategories(persistedCategories)
    setAssignTarget((current) => persistedCategories.some((category) => category.id === current)
      ? current
      : persistedCategories.find((category) => category.id !== 'U')?.id ?? 'U')
    setCustomCategoryColors((current) => ({
      ...Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('jointSet:'))),
      ...Object.fromEntries(persisted.sets.flatMap((category) => {
        const defaultColor = initialCategories.find((candidate) => candidate.id === category.id)?.color
        return defaultColor === category.color ? [] : [[`jointSet:${category.id}`, category.color]]
      })),
    }))
    setManualAssignments(Object.fromEntries(persisted.rows.map((row) => [row.observationId, row.jointSet])))
    setSavedStatus(`Saved v${persisted.version}`)
    setSelectedPointIds(new Set())
    setActiveSet('all')
    setSelectionMode(null)
    setPolygonVertices([])
    setVisibleBoundaryIds(new Set())
  }, [holeFilter, templateId])

  const selectedTemplate = structureTemplates.find((template) => template.id === templateId) ?? structureTemplates[0]
  const templateObservations = fieldStructureObservations.slice(0, selectedTemplate.observationCount)
  const availableHoles = Array.from(new Set(templateObservations.map((observation) => observation.holeId)))
  const filteredObservations = holeFilter === 'all'
    ? templateObservations
    : templateObservations.filter((observation) => observation.holeId === holeFilter)
  const analysis = useMemo(
    () => analyzeStructure(filteredObservations, drillholeData.collars, drillholeData.surveys),
    [drillholeData.collars, drillholeData.surveys, filteredObservations],
  )
  const allPoints = analysis.points.map((point) => ({ ...point, setId: manualAssignments[point.id] ?? point.setId }))
  const points = structureTypeFilter === 'all'
    ? allPoints
    : allPoints.filter((point) => point.structureType === structureTypeFilter)
  const themedCategories = (source: readonly JointCategory[], namespace: 'jointSet' | 'structureType') => source.map((category, index) => ({
    ...category,
    color: customCategoryColors[`${namespace}:${category.id}`] ?? stereonetTheme.pointPalette[index % stereonetTheme.pointPalette.length] ?? category.color,
  }))
  const jointSetPlotCategories = themedCategories(categories, 'jointSet')
  const structureTypePlotCategories = themedCategories(structureTypeCategories, 'structureType')
  const plotCategories = colorBy === 'jointSet' ? jointSetPlotCategories : structureTypePlotCategories
  const hiddenGroups = colorBy === 'jointSet' ? hiddenSets : hiddenStructureTypes
  const groupForPoint = (point: StructurePoint) => colorBy === 'jointSet' ? point.setId : point.structureType
  const visiblePoints = points.filter((point) => !hiddenGroups.has(groupForPoint(point)))
  const focusedPoints = selectedPointIds.size > 0
    ? visiblePoints.filter((point) => selectedPointIds.has(point.id))
    : activeSet === 'all' ? visiblePoints : visiblePoints.filter((point) => groupForPoint(point) === activeSet)
  const focusedSummary = summarize(focusedPoints)
  const typeCounts = new Map(initialStructureTypeCategories.map((category) => [
    category.id,
    allPoints.filter((point) => point.structureType === category.id).length,
  ]))
  const allCategoryGradient = `linear-gradient(${plotCategories.map((category) => category.color).join(', ')})`
  const allGroupsHidden = plotCategories.length > 0 && plotCategories.every((category) => hiddenGroups.has(category.id))
  const allPointsSelected = points.length > 0 && points.every((point) => selectedPointIds.has(point.id))
  const activeCategoryLabel = categories.find((category) => category.id === activeSet)?.label ?? activeSet
  const drawingMode = selectionMode === 'polygon' || selectionMode === 'trapezoid' ? selectionMode : null
  const canFinishBoundary = drawingMode === 'polygon' && isBoundaryComplete('polygon', polygonVertices)
  const setBoundaries = jointSetPlotCategories.flatMap((category) => category.boundary === undefined || !visibleBoundaryIds.has(category.id) ? [] : [{
    color: category.color,
    id: category.id,
    points: category.boundary,
  }])

  const toggleSetVisibility = (setId: string) => {
    const update = colorBy === 'jointSet' ? setHiddenSets : setHiddenStructureTypes
    update((current) => {
      const next = new Set(current)
      if (next.has(setId)) next.delete(setId)
      else next.add(setId)
      return next
    })
  }

  const toggleBoundaryVisibility = (setId: string) => {
    setVisibleBoundaryIds((current) => {
      const next = new Set(current)
      if (next.has(setId)) next.delete(setId)
      else next.add(setId)
      return next
    })
  }

  const updateCategoryColor = (categoryId: string, color: string) => {
    const update = colorBy === 'jointSet' ? setCategories : setStructureTypeCategories
    update((current) => current.map((category) => category.id === categoryId ? { ...category, color } : category))
    setCustomCategoryColors((current) => ({ ...current, [`${colorBy}:${categoryId}`]: color }))
    setSavedStatus(null)
  }

  const toggleAllVisibility = () => {
    const next = allGroupsHidden ? new Set<string>() : new Set(plotCategories.map((category) => category.id))
    if (colorBy === 'jointSet') setHiddenSets(next)
    else setHiddenStructureTypes(next)
    setActiveSet('all')
  }

  const changeColoring = (nextColorBy: 'jointSet' | 'structureType') => {
    setColorBy(nextColorBy)
    setActiveSet('all')
    setSelectedPointIds(new Set())
    setSelectionMode(null)
    setPolygonVertices([])
    setVisibleBoundaryIds(new Set())
  }

  const togglePoint = (pointId: string) => {
    setSelectedPointIds((current) => {
      const next = new Set(current)
      if (next.has(pointId)) next.delete(pointId)
      else next.add(pointId)
      return next
    })
  }

  const toggleCategorySelection = (categoryId: string) => {
    setPolygonVertices([])
    const targetPoints = categoryId === 'all' ? points : points.filter((point) => groupForPoint(point) === categoryId)
    const allSelected = targetPoints.length > 0 && targetPoints.every((point) => selectedPointIds.has(point.id))
    setSelectedPointIds((current) => {
      const next = new Set(current)
      targetPoints.forEach((point) => allSelected ? next.delete(point.id) : next.add(point.id))
      return next
    })
    setActiveSet(categoryId)
    setSelectionMode('point')
  }

  const addCategory = (boundaryMode: BoundaryDrawingMode = 'polygon') => {
    const numbers = categories.map((category) => Number(category.id.replace('J', ''))).filter(Number.isFinite)
    const nextNumber = Math.max(3, ...numbers) + 1
    const id = `J${nextNumber}`
    const label = `New set ${nextNumber}`
    const unassigned = categories.find((category) => category.id === 'U') ?? { id: 'U', label: 'Unassigned', color: '#9ba39f' }
    setCategories((current) => [...current.filter((category) => category.id !== 'U'), {
      id,
      label,
      color: extraColors[(nextNumber - 4) % extraColors.length] ?? '#d75074',
    }, unassigned])
    setActiveSet(id)
    setAssignTarget(id)
    setEditingCategoryId(id)
    setCategoryNameDraft(label)
    setSelectionMode(boundaryMode)
    setPolygonVertices([])
    setSelectedPointIds(new Set())
    setSavedStatus(null)
  }

  const beginBoundary = (categoryId: string, boundaryMode: BoundaryDrawingMode = 'polygon') => {
    if (categoryId === 'all' || categoryId === 'U') return
    setActiveSet(categoryId)
    setAssignTarget(categoryId)
    setSelectionMode(boundaryMode)
    setPolygonVertices([])
    setSelectedPointIds(new Set())
    setVisibleBoundaryIds((current) => new Set([...current].filter((id) => id !== categoryId)))
  }

  const completePolygon = (drawnPolygon?: PlotCoordinate[]) => {
    const boundary = drawnPolygon ?? polygonVertices
    if (drawingMode === null || !isBoundaryComplete(drawingMode, boundary)) return
    const selected = visiblePoints.filter((point) => pointInPolygon(projectStructurePoint(point, projection), boundary))
    setCategories((current) => current.map((category) => category.id === assignTarget
      ? { ...category, boundary: [...boundary] }
      : category))
    setPolygonVertices([])
    setSelectedPointIds(new Set(selected.map((point) => point.id)))
    setActiveSet(assignTarget)
    setSelectionMode(null)
    setVisibleBoundaryIds((current) => new Set(current).add(assignTarget))
    setSavedStatus(null)
  }

  const cancelBoundary = () => {
    setSelectionMode(null)
    setPolygonVertices([])
    setSelectedPointIds(new Set())
    setActiveSet('all')
  }

  const redrawBoundary = () => {
    if (activeSet === 'all' || activeSet === 'U') return
    setAssignTarget(activeSet)
    setSelectionMode(drawingMode ?? 'polygon')
    setPolygonVertices([])
    setSelectedPointIds(new Set())
  }

  const deleteCategory = (categoryId: string) => {
    if (categoryId === 'U' || categories.length <= 2) return
    const affectedIds = allPoints.filter((point) => point.setId === categoryId).map((point) => point.id)
    setManualAssignments((current) => ({
      ...current,
      ...Object.fromEntries(affectedIds.map((id) => [id, 'U'])),
    }))
    setCategories((current) => current.filter((category) => category.id !== categoryId))
    setHiddenSets((current) => new Set([...current].filter((id) => id !== categoryId)))
    setVisibleBoundaryIds((current) => new Set([...current].filter((id) => id !== categoryId)))
    setSelectedPointIds(new Set())
    setPolygonVertices([])
    setActiveSet('all')
    setAssignTarget((current) => current === categoryId
      ? categories.find((category) => category.id !== categoryId && category.id !== 'U')?.id ?? 'U'
      : current)
    setEditingCategoryId(null)
    setSavedStatus(null)
  }

  const beginRenameCategory = (category: JointCategory) => {
    if (category.id === 'U') return
    setEditingCategoryId(category.id)
    setCategoryNameDraft(category.label)
  }

  const commitCategoryRename = () => {
    const nextName = categoryNameDraft.trim()
    if (editingCategoryId === null || nextName.length === 0) return
    setCategories((current) => current.map((category) => category.id === editingCategoryId ? { ...category, label: nextName } : category))
    setEditingCategoryId(null)
    setSavedStatus(null)
  }

  const assignSelected = () => {
    if (!categories.some((category) => category.id === assignTarget)) return
    const selected = points.filter((point) => selectedPointIds.has(point.id))
    if (selected.length === 0) {
      setSelectedPointIds(new Set())
      return
    }
    setManualAssignments((current) => ({
      ...current,
      ...Object.fromEntries(selected.map((point) => [point.id, assignTarget])),
    }))
    setSelectedPointIds(new Set())
    setPolygonVertices([])
    setSelectionMode(null)
    setActiveSet(assignTarget)
    setSavedStatus(null)
  }

  const saveSession = async (createVersion: boolean) => {
    const nextVersion = createVersion
      ? nextStructureLogVersionNumber(readStructureLogVersions(), templateId, holeFilter, documentVersion)
      : documentVersion
    const savedAt = new Date().toISOString()
    const runId = `structure-${templateId}-v${nextVersion}-${Date.parse(savedAt)}`
    const analysisFileId = `structure/${templateId}/v${nextVersion}.json`
    writeStructureLogVersion({
      holeFilter,
      rows: allPoints.map((point) => ({ observationId: point.id, jointSet: point.setId })),
      sets: categories.map((category) => ({
        ...(category.boundary === undefined ? {} : { boundary: category.boundary }),
        color: category.color,
        id: category.id,
        label: category.label,
      })),
      templateId,
      updatedAt: savedAt,
      version: nextVersion,
    })
    if (typeof window !== 'undefined') {
      saveStructureDerivedValues(window.localStorage, {
        datasetId: 'dataset.structural-logging',
        holeFilter,
        rows: allPoints.map((point) => ({ observationId: point.id, jointSet: point.setId })),
        templateId,
        templateVersion: nextVersion,
      }, savedAt)
      recordAnalysisTemplateSave(window.localStorage, {
        analysisFileId,
        derivedFieldKeys: ['structure.joint_set'],
        feature: 'structure',
        runId,
        savedAt,
        templateId,
        templateVersion: nextVersion,
      })
      const stereonetGraph = await svgElementPngGraphImage(
        `${plotMode}-${projection}-stereonet`,
        window.document.querySelector<SVGSVGElement>('.structure-page .stereonet svg'),
      )
      const graphs = stereonetGraph === null
        ? [barGraphImage('joint-set-counts', 'Structure joint-set counts', categories.map((category) => ({
          label: category.label,
          value: allPoints.filter((point) => point.setId === category.id).length,
        })))]
        : [stereonetGraph]
      saveAnalysisResultPackage(window.localStorage, {
        analysisFileId,
        analysisPayload: {
          assignments: allPoints.map((point) => ({ observationId: point.id, jointSet: point.setId })),
          configuration: { holeFilter, plotMode, projection, structureTypeFilter },
          sets: categories.map((category) => ({
            ...(category.boundary === undefined ? {} : { boundary: category.boundary }),
            color: category.color,
            id: category.id,
            label: category.label,
          })),
        },
        boreholeIds: [...new Set(allPoints.map((point) => point.holeId))],
        createdAt: savedAt,
        derivedFieldKeys: ['structure.joint_set'],
        feature: 'structure',
        graphs,
        inputName: `${holeFilter}-${structureTypeFilter}-${plotMode}-${projection}`,
        projectId: 'Oyu Ridge',
        runId,
        sourceFileName: `${selectedTemplate.label}.json`,
        sourceObservationIds: allPoints.map((point) => point.id),
        templateId,
        templateVersion: nextVersion,
        tenantId: 'GeoEye Demo',
      })
    }
    if (createVersion) setDocumentVersion(nextVersion)
    setSavedStatus(`${createVersion ? 'Created' : 'Saved'} v${nextVersion} · derived values + analysis file + graph image`)
    setSaveAsOpen(false)
  }

  return (
    <div className="page structure-page">
      <h1 className="sr-only">Structure</h1>

      <div className="analysis-toolbar structure-analysis-toolbar">
        <label className="tool-select tool-select-field">
          <span>Template</span>
          <select aria-label="Structure template" onChange={(event) => {
            const nextId = event.target.value as typeof templateId
            setTemplateId(nextId)
            setDocumentVersion(versionFromTemplate(nextId))
            setSavedStatus(null)
          }} value={templateId}>
            {structureTemplates.map((template) => <option key={template.id} value={template.id}>{template.id === templateId ? labelWithVersion(template.label, documentVersion) : template.label}</option>)}
          </select>
          <ChevronDown size={14} />
        </label>
        <label className="tool-select tool-select-field">
          <span>Drillholes</span>
          <select aria-label="Structure drillholes" onChange={(event) => { setHoleFilter(event.target.value); setSavedStatus(null) }} value={holeFilter}>
            <option value="all">All validated · {availableHoles.length}</option>
            {availableHoles.map((holeId) => <option key={holeId} value={holeId}>{holeId}</option>)}
          </select>
          <ChevronDown size={14} />
        </label>
        <label className="tool-select tool-select-field structure-type-filter">
          <span>Structure type</span>
          <select aria-label="Filter structure type" onChange={(event) => { setStructureTypeFilter(event.target.value as 'all' | StructureTypeId); setActiveSet('all'); setSelectedPointIds(new Set()); setSavedStatus(null) }} value={structureTypeFilter}>
            <option value="all">All types · {allPoints.length}</option>
            {initialStructureTypeCategories.map((category) => (
              <option key={category.id} value={category.id}>{category.label} · {typeCounts.get(category.id) ?? 0}</option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
        <label className="tool-select tool-select-field">
          <span>Group by</span>
          <select aria-label="Group stereonet by" onChange={(event) => changeColoring(event.target.value as 'jointSet' | 'structureType')} value={colorBy}>
            <option value="jointSet">Joint sets</option>
            <option value="structureType">Structure types</option>
          </select>
          <ChevronDown size={14} />
        </label>
        <label className="tool-select tool-select-field">
          <span>Projection</span>
          <select aria-label="Stereonet projection" onChange={(event) => setProjection(event.target.value as StereonetProjection)} value={projection}>
            <option value="equalArea">Equal area</option>
            <option value="equalAngle">Equal angle</option>
          </select>
          <ChevronDown size={14} />
        </label>
        <div className="toolbar-spacer" />
        {savedStatus ? <span className="structure-save-status"><Check size={13} /> {savedStatus}</span> : null}
        <button className="button button-small button-secondary" onClick={() => setSaveAsOpen(true)} title="Create a new template version" type="button"><CopyPlus size={14} /> Save As…</button>
        <button className="button button-small button-accent" onClick={() => { void saveSession(false) }} title={`Overwrite template v${documentVersion}`} type="button"><Save size={14} /> Save</button>
      </div>

      <div className="structure-workspace">
        <section className="panel stereonet-workspace">
          <div className="canvas-toolbar">
            <div className="canvas-toolbar-left">
              <div className="segmented-control" aria-label="Plot type" role="group">
                {(['density', 'poles', 'planes'] as const).map((mode) => <button className={plotMode === mode ? 'is-active' : ''} key={mode} onClick={() => setPlotMode(mode)} type="button">{mode[0]?.toUpperCase()}{mode.slice(1)}</button>)}
              </div>
            </div>
            <div className="canvas-tools">
              {drawingMode !== null ? (
                <div className="boundary-tool-controls" role="status">
                  <span>{drawingMode === 'trapezoid' ? <TrapezoidIcon size={13} /> : <Pentagon size={13} />}<strong>{activeCategoryLabel}</strong><small>{drawingMode === 'trapezoid' ? 'Press and drag · release to finish' : `${polygonVertices.length} vertices · double-click to finish`}</small></span>
                  {drawingMode === 'polygon' ? <>
                    <button disabled={!canFinishBoundary} onClick={() => completePolygon()} type="button">Finish</button>
                    <button disabled={polygonVertices.length === 0} onClick={redrawBoundary} type="button">Redraw</button>
                  </> : null}
                  <button aria-label="Cancel set boundary" onClick={cancelBoundary} type="button"><X size={13} /></button>
                </div>
              ) : null}
              <button aria-label="Select observations" className={`icon-button ${selectionMode === 'point' ? 'is-active' : ''}`} disabled={drawingMode !== null} onClick={() => setSelectionMode((current) => current === 'point' ? null : 'point')} type="button"><MousePointer2 size={16} /></button>
              <button aria-label="Draw set polygon" aria-pressed={selectionMode === 'polygon'} className={`icon-button ${selectionMode === 'polygon' ? 'is-active' : ''}`} disabled={colorBy !== 'jointSet'} onClick={() => activeSet === 'all' || activeSet === 'U' ? addCategory('polygon') : beginBoundary(activeSet, 'polygon')} title="Draw a freeform set boundary; double-click to finish" type="button"><Pentagon size={16} /></button>
              <button aria-label="Draw set trapezoid" aria-pressed={selectionMode === 'trapezoid'} className={`icon-button ${selectionMode === 'trapezoid' ? 'is-active' : ''}`} disabled={colorBy !== 'jointSet'} onClick={() => activeSet === 'all' || activeSet === 'U' ? addCategory('trapezoid') : beginBoundary(activeSet, 'trapezoid')} title="Press and drag to create a stereonet-aligned radial trapezoid" type="button"><TrapezoidIcon size={16} /></button>
              <button aria-label="Export plot" className="icon-button" type="button"><Download size={16} /></button>
            </div>
          </div>
          <div className="large-stereonet-wrap">
            <Stereonet
              activeGroup={activeSet}
              categories={plotCategories}
              colorBy={colorBy}
              countCirclePercent={countCirclePercent}
              densityDistribution={densityDistribution}
              densityPalette={densityPalette}
              densitySurface={densitySurface}
              hiddenGroupIds={hiddenGroups}
              onPointSelect={togglePoint}
              onPolygonChange={setPolygonVertices}
              onPolygonComplete={completePolygon}
              planeWidth={planeWidth}
              plotMode={plotMode}
              pointSize={pointSize}
              points={points}
              polygonVertices={polygonVertices}
              projection={projection}
              selectedIds={selectedPointIds}
              selectionMode={selectionMode}
              setBoundaries={colorBy === 'jointSet' ? setBoundaries : []}
            />
          </div>
        </section>

        <aside className="analysis-inspector joint-session-panel">
          <section className="panel joint-session">
            <div className="panel-heading compact-heading joint-session-heading">
              <div><h2>{colorBy === 'jointSet' ? 'Joint sets' : 'Structure types'}</h2><span>{labelWithVersion(selectedTemplate.label, documentVersion)}</span></div>
              {colorBy === 'jointSet'
                ? <button className="button button-small button-ghost" onClick={() => addCategory()} type="button"><Plus size={14} /> New set</button>
                : null}
            </div>

            <div className="joint-session-statistics">
              <div><span>Points</span><strong>{focusedPoints.length}</strong></div>
              <div><span>Mean direction</span><strong>{focusedSummary.direction.toFixed(1)}°</strong></div>
              <div><span>Mean dip</span><strong>{focusedSummary.dip.toFixed(1)}°</strong></div>
              <div><span>R-value</span><strong>{focusedSummary.rValue.toFixed(2)}</strong></div>
            </div>

            <div className="joint-category-list">
              <div className="joint-category-header"><span /><span /><span>Name</span><span>Orientation</span><span>Count</span><span className="joint-actions-heading">Actions</span></div>
              <div className={`joint-category-row ${activeSet === 'all' ? 'is-active' : ''} ${allPointsSelected ? 'is-selected-group' : ''}`}>
                <button aria-label={allGroupsHidden ? 'Show all observations' : 'Hide all observations'} className={`joint-visibility ${allGroupsHidden ? 'is-hidden' : ''}`} onClick={toggleAllVisibility} type="button">{allGroupsHidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                <span className="joint-color-summary"><i style={{ background: allCategoryGradient }} /></span>
                <button aria-label={`${allPointsSelected ? 'Unselect' : 'Select'} all observations`} className="joint-category-name" onClick={() => toggleCategorySelection('all')} type="button"><strong>All observations</strong></button>
                <span>—</span><b>{points.length}</b>
                <span />
              </div>
              {plotCategories.map((category) => {
                const categoryPoints = points.filter((point) => groupForPoint(point) === category.id)
                const summary = summarize(categoryPoints)
                const hidden = hiddenGroups.has(category.id)
                const categorySelected = categoryPoints.length > 0 && categoryPoints.every((point) => selectedPointIds.has(point.id))
                return (
                  <div className={`joint-category-row ${activeSet === category.id ? 'is-active' : ''} ${categorySelected ? 'is-selected-group' : ''}`} key={category.id}>
                    <button aria-label={`${hidden ? 'Show' : 'Hide'} ${category.label}`} className={`joint-visibility ${hidden ? 'is-hidden' : ''}`} onClick={() => toggleSetVisibility(category.id)} type="button">{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                    <label className="joint-color-picker" title={`Change ${category.label} colour`}>
                      <span className="sr-only">Colour for {category.label}</span>
                      <input aria-label={`Colour for ${category.label}`} onChange={(event) => updateCategoryColor(category.id, event.target.value)} type="color" value={category.color} />
                      <i style={{ background: category.color }} />
                    </label>
                    {editingCategoryId === category.id ? (
                      <input
                        aria-label={`Rename ${category.label}`}
                        autoFocus
                        className="joint-category-name-input"
                        onBlur={(event) => {
                          const nextFocus = event.relatedTarget
                          if (!(nextFocus instanceof HTMLElement && event.currentTarget.closest('.joint-category-row')?.contains(nextFocus))) commitCategoryRename()
                        }}
                        onChange={(event) => setCategoryNameDraft(event.target.value)}
                        onFocus={(event) => event.currentTarget.select()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitCategoryRename()
                          if (event.key === 'Escape') setEditingCategoryId(null)
                        }}
                        value={categoryNameDraft}
                      />
                    ) : <button aria-label={`${categorySelected ? 'Unselect' : 'Select'} ${category.label} observations`} className="joint-category-name" onClick={() => toggleCategorySelection(category.id)} type="button"><strong>{category.label}</strong></button>}
                    <span>{categoryPoints.length === 0 ? '—' : `${summary.direction.toFixed(0)}° / ${summary.dip.toFixed(0)}°`}</span>
                    <b>{categoryPoints.length}</b>
                    {colorBy !== 'jointSet' || category.id === 'U' ? <span /> : editingCategoryId === category.id ? (
                      <span className="joint-row-actions">
                        <button aria-label={`Save ${category.label} name`} disabled={categoryNameDraft.trim().length === 0} onClick={commitCategoryRename} title="Save name" type="button"><Check size={13} /></button>
                        <button aria-label={`Cancel renaming ${category.label}`} onClick={() => setEditingCategoryId(null)} title="Cancel" type="button"><X size={13} /></button>
                      </span>
                    ) : (
                      <span className="joint-row-actions">
                        <button
                          aria-label={`${visibleBoundaryIds.has(category.id) ? 'Hide' : 'Show'} ${category.label} boundary`}
                          aria-pressed={visibleBoundaryIds.has(category.id)}
                          className={visibleBoundaryIds.has(category.id) ? 'is-active' : ''}
                          disabled={category.boundary === undefined}
                          onClick={() => toggleBoundaryVisibility(category.id)}
                          title={category.boundary === undefined ? `Draw ${category.label} boundary first` : `${visibleBoundaryIds.has(category.id) ? 'Hide' : 'Show'} ${category.label} boundary`}
                          type="button"
                        ><Pentagon size={13} /></button>
                        <button aria-label={`Rename ${category.label}`} onClick={() => beginRenameCategory(category)} title={`Rename ${category.label}`} type="button"><Pencil size={13} /></button>
                        <button aria-label={`Delete ${category.label}`} disabled={categories.length <= 2} onClick={() => deleteCategory(category.id)} title={`Delete ${category.label}`} type="button"><Trash2 size={13} /></button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {colorBy === 'jointSet' ? (
              <div className="joint-session-actions">
                <label><span className="sr-only">Assign selected observations to</span><select aria-label="Assign selected observations to" onChange={(event) => setAssignTarget(event.target.value)} value={assignTarget}>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select><ChevronDown size={13} /></label>
                <button className="button button-small button-accent" disabled={selectedPointIds.size === 0} onClick={assignSelected} title={selectedPointIds.size === 0 ? 'Select observations with the pointer or closed lasso first' : `Assign ${selectedPointIds.size} selected observations`} type="button">Assign {selectedPointIds.size > 0 ? selectedPointIds.size : ''}</button>
              </div>
            ) : null}

            <div className="plot-appearance-panel">
              <div className="plot-appearance-heading"><span>Plot appearance</span><strong>All plots</strong></div>
              <div className="plot-appearance-grid">
                <label className="plot-appearance-control plot-appearance-range">
                  <span>Point size</span>
                  <span><input aria-label="Point size" max="1.8" min="0.5" onChange={(event) => setPointSize(Number(event.target.value))} step="0.1" type="range" value={pointSize} /><output>{pointSize.toFixed(1)}×</output></span>
                </label>
                <label className="plot-appearance-control plot-appearance-range">
                  <span>Plane width</span>
                  <span><input aria-label="Plane line width" max="1.8" min="0.35" onChange={(event) => setPlaneWidth(Number(event.target.value))} step="0.05" type="range" value={planeWidth} /><output>{planeWidth.toFixed(2)}</output></span>
                </label>
                <label className="plot-appearance-control">
                  <span>Distribution</span>
                  <span className="appearance-select"><select aria-label="Density distribution" onChange={(event) => setDensityDistribution(event.target.value as DensityDistribution)} value={densityDistribution}><option value="schmidt">Schmidt · count</option><option value="fisher">Fisher · smooth</option></select><ChevronDown size={13} /></span>
                </label>
                <label className="plot-appearance-control plot-appearance-range">
                  <span>Count circle</span>
                  <span><input aria-label="Count circle percent" max="5" min="0.5" onChange={(event) => setCountCirclePercent(Number(event.target.value))} step="0.5" type="range" value={countCirclePercent} /><output>{countCirclePercent.toFixed(1)}%</output></span>
                </label>
                <label className="plot-appearance-control">
                  <span>Colour ramp</span>
                  <span className="appearance-select"><select aria-label="Density colour preset" onChange={(event) => setDensityPalette(event.target.value as DensityPalettePreset)} value={densityPalette}><option value="spectrum">GeoEye spectrum</option><option value="geoeye">GeoEye · white</option></select><ChevronDown size={13} /></span>
                </label>
                <label className="plot-appearance-control">
                  <span>Contours</span>
                  <span className="appearance-select"><select aria-label="Density contour style" onChange={(event) => setDensitySurface(event.target.value as DensitySurfaceMode)} value={densitySurface}><option value="filled">Filled</option><option value="lines">Lines</option></select><ChevronDown size={13} /></span>
                </label>
              </div>
              <p>Density is calculated on the reference hemisphere · Equal area is recommended for contour comparison.</p>
            </div>
          </section>
        </aside>
      </div>

      {saveAsOpen ? (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSaveAsOpen(false) }} role="presentation">
          <section aria-labelledby="structure-save-as-title" aria-modal="true" className="geotech-save-as-dialog structure-save-as-dialog" role="dialog">
            <header>
              <div><p className="eyebrow">New template revision</p><h2 id="structure-save-as-title">Save As v{documentVersion + 1}</h2></div>
              <button aria-label="Close Save As" className="icon-button" onClick={() => setSaveAsOpen(false)} type="button"><X size={17} /></button>
            </header>
            <div>
              <p className="structure-save-as-summary"><strong>{labelWithVersion(selectedTemplate.label, documentVersion)}</strong> remains unchanged. A new version will keep the current set names, boundaries, colours, and assignments.</p>
              <p>The new version saves <code>structure.joint_set</code> as GeoEye-owned derived data and writes its structure-analysis file and graph image in the same action. Source observations remain unchanged.</p>
            </div>
            <footer>
              <button className="button button-secondary" onClick={() => setSaveAsOpen(false)} type="button">Cancel</button>
              <button className="button button-accent" onClick={() => { void saveSession(true) }} type="button"><CopyPlus size={14} /> Create new version</button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}
