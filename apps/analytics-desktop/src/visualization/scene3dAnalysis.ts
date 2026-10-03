import type { EdaObservation } from '../analysis/eda.js'

export type NumericClassification = 'continuous' | 'equal' | 'quantile' | 'custom'
export type SelectionShape = 'pick' | 'rectangle' | 'lasso'

export interface SectionCorridor {
  azimuth: number
  back: number
  centreX: number
  centreY: number
  centreZ?: number
  corridor: number
  dip?: number
  front: number
}

export interface SavedSceneSelection {
  createdAt: string
  expression: string | null
  id: string
  label: string
  sourceObservationIds: string[]
  version: 1
}

export interface SceneStructureObservation {
  dipDirection: number
  id: string
  jointSet: string
  kind: 'discontinuity' | 'fault'
  persistence: number
  sourceObservationIds: string[]
  trueDip: number
  x: number
  y: number
  z: number
}

export function sourceObservationIds(observation: EdaObservation) {
  return observation.sourceObservationIds ?? [observation.sourceObservationId]
}

export function uniqueSourceObservationIds(observations: readonly EdaObservation[]) {
  return [...new Set(observations.flatMap(sourceObservationIds))]
}

export function sectionNormalDistance(
  observation: Pick<EdaObservation, 'easting' | 'northing'>,
  section: Pick<SectionCorridor, 'azimuth' | 'centreX' | 'centreY'> & Partial<Pick<SectionCorridor, 'centreZ' | 'dip'>>,
  elevation?: number,
) {
  const radians = section.azimuth * Math.PI / 180
  const deltaX = observation.easting - section.centreX
  const deltaY = observation.northing - section.centreY
  const horizontalDistance = deltaX * Math.cos(radians) - deltaY * Math.sin(radians)
  if (elevation === undefined || section.centreZ === undefined || section.dip === undefined) return horizontalDistance
  const dipRadians = Math.abs(section.dip) * Math.PI / 180
  const dipSign = section.dip < 0 ? -1 : 1
  const verticalDistance = elevation - section.centreZ
  return horizontalDistance * Math.sin(dipRadians) + verticalDistance * Math.cos(dipRadians) * dipSign
}

export function sectionCorridorState(
  observation: Pick<EdaObservation, 'easting' | 'northing'>,
  section: SectionCorridor,
  elevation?: number,
) {
  const distance = sectionNormalDistance(observation, section, elevation)
  const halfCorridor = Math.max(0.5, section.corridor / 2)
  const front = Math.max(0, section.front || halfCorridor)
  const back = Math.max(0, section.back || halfCorridor)
  return {
    distance,
    inside: distance >= -back && distance <= front,
    side: distance > front ? 'front' as const : distance < -back ? 'back' as const : 'inside' as const,
  }
}

export function numericClassBreaks(
  values: readonly number[],
  classification: NumericClassification,
  classCount = 5,
  customBreaks: readonly number[] = [],
) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
  if (classification === 'custom') return [...new Set(customBreaks.filter(Number.isFinite))].sort((left, right) => left - right)
  if (sorted.length === 0) return [0, 1]
  const minimum = sorted[0] ?? 0
  const maximum = sorted.at(-1) ?? minimum
  return Array.from({ length: classCount + 1 }, (_, index) => {
    if (classification === 'quantile') {
      return sorted[Math.round((sorted.length - 1) * index / classCount)] ?? minimum
    }
    return minimum + (maximum - minimum) * index / classCount
  })
}

export function anchoredSelection(
  observations: readonly EdaObservation[],
  anchor: EdaObservation,
  shape: SelectionShape,
) {
  if (shape === 'pick') return sourceObservationIds(anchor)
  const matches = shape === 'rectangle'
    ? observations.filter((candidate) => candidate.holeId === anchor.holeId && Math.abs(candidate.depthFrom - anchor.depthFrom) <= 16)
    : observations.filter((candidate) => candidate.lithology === anchor.lithology && Math.abs(candidate.depthFrom - anchor.depthFrom) <= 12)
  return uniqueSourceObservationIds(matches)
}

export function createSavedSceneSelection(
  label: string,
  observations: readonly EdaObservation[],
  expression: string,
  createdAt = new Date().toISOString(),
): SavedSceneSelection {
  return {
    createdAt,
    expression: expression.trim() === '' ? null : expression.trim(),
    id: `scene-selection.${createdAt}`,
    label: label.trim() || '3D Analysis selection',
    sourceObservationIds: uniqueSourceObservationIds(observations),
    version: 1,
  }
}

export function extractStructureObservations(
  observations: readonly EdaObservation[],
  elevationFor: (observation: EdaObservation) => number,
): SceneStructureObservation[] {
  return observations.flatMap((observation) => {
    const trueDip = observation.values['structure.true_dip'] ?? observation.values['structure.dip'] ?? observation.values.true_dip
    const dipDirection = observation.values['structure.dip_direction'] ?? observation.values.dip_direction
    if (typeof trueDip !== 'number' || typeof dipDirection !== 'number') return []
    const persistence = observation.values['structure.persistence'] ?? observation.values.persistence
    return [{
      dipDirection,
      id: `structure.${observation.id}`,
      jointSet: observation.dimensions.joint_set ?? observation.dimensions.jointSet ?? observation.dimensions['structure.joint_set'] ?? 'Unclassified',
      kind: (observation.dimensions.structure_type ?? observation.dimensions['structure.type']) === 'fault' ? 'fault' as const : 'discontinuity' as const,
      persistence: typeof persistence === 'number' ? Math.max(0.1, persistence) : 1,
      sourceObservationIds: sourceObservationIds(observation),
      trueDip,
      x: observation.easting,
      y: observation.northing,
      z: elevationFor(observation),
    }]
  })
}

export function structureDiscGeometry(structure: Pick<SceneStructureObservation, 'dipDirection' | 'persistence' | 'trueDip'>) {
  const radius = Math.max(8, Math.min(28, 8 + structure.persistence * 2))
  return {
    rotation: structure.dipDirection,
    rx: radius,
    ry: Math.max(2, radius * Math.cos(Math.min(89.5, Math.abs(structure.trueDip)) * Math.PI / 180)),
  }
}
