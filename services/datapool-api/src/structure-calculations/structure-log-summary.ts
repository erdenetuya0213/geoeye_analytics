import type { Laubscher90Observation } from './laubscher90.js'
import type { Rmr76Observation } from './rmr76.js'
import type { Rmr89Observation } from './rmr89.js'
import { deriveApparentSetSpacingM, isSpacingStructure } from './structure-set-spacing.js'
import { deriveStructureSurfaceParameters, surfaceLookupCode } from './structure-surface-lookup.js'
import { apertureBandRepresentativeMm } from './structure-observation-guides.js'

export const STRUCTURE_ALPHA_SETS = [
  {
    id: 'set1',
    label: 'Set 1',
    angleLabel: '0–30°',
    minimumExclusive: Number.NEGATIVE_INFINITY,
    maximum: 30,
  },
  { id: 'set2', label: 'Set 2', angleLabel: '>30–60°', minimumExclusive: 30, maximum: 60 },
  { id: 'set3', label: 'Set 3', angleLabel: '>60–90°', minimumExclusive: 60, maximum: 90 },
] as const

/** Ordered vocabularies: index 0 is the best condition, the last the most adverse. */
const ROUGHNESS_ORDER = ['VR', 'R', 'SR', 'S', 'K'] as const
const WALL_ALTERATION_ORDER = ['FR', 'SW', 'MW', 'HW', 'CW', 'RS'] as const
const APERTURE_BAND_ORDER = ['TG', 'VN', 'NA', 'PO', 'OP', 'ML', 'LA', 'VL', 'EL'] as const
const PERSISTENCE_ORDER = ['VL', 'L', 'M', 'H', 'VH'] as const
const WALL_HARDNESS_ORDER = ['H', 'S'] as const
const INFILL_HARDNESS_ORDER = ['N', 'H', 'S', 'G'] as const
const CONTINUITY_ORDER = ['D', 'C'] as const
const L90_MACRO_ORDER = ['MW', 'UW', 'CU', 'SU', 'ST'] as const
const L90_MICRO_ORDER = ['R_ST', 'S_ST', 'K_ST', 'R_UN', 'S_UN', 'K_UN', 'R_PL', 'S_PL', 'P'] as const
const L90_WALL_ORDER = ['N', 'W'] as const
const L90_FILLING_ORDER = ['N', 'NC', 'NM', 'NF', 'SC', 'SM', 'SF', 'GL', 'GT'] as const
const L90_WATER_ORDER = ['D', 'M', 'P', 'H'] as const

/**
 * One structure's primary observations, reduced to what the derivations read.
 * Every rating edition (RMR76, RMR89, RMR90) is typed against this same row so
 * an observation is logged once and summarised for every table.
 */
export interface StructureSummaryObservation extends Rmr76Observation, Rmr89Observation, Laubscher90Observation {
  depthM: number
  alphaDeg?: number | null
  structureType?: string | null
  breakOrigin?: string | null
  jointShape?: string | null
  roughness?: string | null
  wallAlteration?: string | null
  jrc?: number | null
  infillType?: string | null
  infillThicknessMm?: number | null
  apertureMm?: number | null
  apertureBand?: string | null
  /** Measured wall separation; the open aperture with no infill, the filling thickness with one. */
  separationMm?: number | null
  persistenceM?: number | null
  /** `persistence_band` code; the logged trace-length class. */
  persistenceBand?: string | null
}

/**
 * Resolve the single measured separation into the two values the rating
 * tables read. With infill type None the walls are open, so the separation is
 * the aperture and the filling is 0 mm; with an infill the separation is the
 * filling thickness and the aperture is closed. Explicit aperture or thickness
 * values (legacy rows, tests) are kept as given.
 */
export function withOpening<T extends StructureSummaryObservation>(observation: T): T {
  const explicit = observation.apertureMm != null || observation.infillThicknessMm != null
  if (explicit) return observation
  // The logged aperture class reads as its representative millimetres, chosen
  // on the adverse side of any rating boundary the class straddles.
  const separation = observation.separationMm != null && Number.isFinite(observation.separationMm)
    ? observation.separationMm
    : apertureBandRepresentativeMm(observation.apertureBand)
  if (separation == null) return observation
  const infill = observation.infillType?.trim().toUpperCase()
  if (!infill) return { ...observation, apertureMm: separation, infillThicknessMm: null }
  return infill === 'N'
    ? { ...observation, apertureMm: separation, infillThicknessMm: 0 }
    : { ...observation, apertureMm: 0, infillThicknessMm: separation }
}

/**
 * Representative condition of a population of structures: the inputs a
 * Bieniawski (1976, 1989) or Laubscher (1990) rating table is read with.
 * Categorical values are the population mode or, when the template asks for
 * it, the adverse median; measured values are medians.
 */
export interface StructureConditionSummary {
  count: number
  fractureFrequencyPerM: number | null
  spacingMeanM: number | null
  shapeMode: string | null
  roughnessMode: string | null
  wallAlterationMode: string | null
  wallHardnessMode: string | null
  jrcMedian: number | null
  projectJcrMedian: number | null
  infillTypeMode: string | null
  infillHardnessMode: string | null
  infillThicknessMedianMm: number | null
  continuityMode: string | null
  apertureBandMode: string | null
  apertureMedianMm: number | null
  persistenceMedianM: number | null
  persistenceMode: string | null
  l90MacroMode: string | null
  l90MicroMode: string | null
  l90WallMode: string | null
  l90FillingMode: string | null
  l90WaterMode: string | null
  l90WeightSum: number | null
}

export interface StructureSetSummary extends StructureConditionSummary {
  id: (typeof STRUCTURE_ALPHA_SETS)[number]['id']
  label: string
  angleLabel: string
}

export interface StructureIntervalSummary {
  naturalCount: number
  fractureFrequencyPerM: number | null
  spacingMeanM: number | null
  /** Structures counted by type code, including types that do not count as natural breaks. */
  countByType: Record<string, number>
  /** Distinct reviewed `joint_set_id` values among natural structures. */
  reviewedSetCount: number | null
  /** Minimum mean apparent spacing across reviewed sets; blank when any natural structure has no set. */
  reviewedSetSpacingMinM: number | null
  /** Representative condition of every natural structure in the interval. */
  interval: StructureConditionSummary
  sets: StructureSetSummary[]
  /** Non-RMR keeps counts and reports zero interval spacing; rates, modes and ratings stay withheld. */
  excluded: boolean
}

export type StructurePopulationMode = 'mode' | 'adverse_median'

function observedPopulationValue(
  values: Array<string | null | undefined>,
  order: readonly string[],
  populationMode: StructurePopulationMode
) {
  const orderIndex = new Map(order.map((code, index) => [code, index]))
  const sorted = values
    .flatMap((value) => {
      const normalized = value?.trim().toUpperCase()
      const index = normalized ? orderIndex.get(normalized) : undefined
      return index === undefined ? [] : [{ code: normalized!, index }]
    })
    .sort((a, b) => a.index - b.index)
  if (sorted.length === 0) return null
  if (populationMode === 'mode') {
    const counts = new Map<string, { count: number; index: number }>()
    for (const item of sorted) {
      const current = counts.get(item.code)
      counts.set(item.code, { count: (current?.count ?? 0) + 1, index: item.index })
    }
    // Ties use the smoother/more altered observed category: deterministic and conservative.
    return [...counts.entries()].sort(
      (a, b) => b[1].count - a[1].count || b[1].index - a[1].index
    )[0]![0]
  }
  // For an even sample, use the more adverse of the two middle observed
  // categories instead of manufacturing a category between them.
  return sorted[Math.floor(sorted.length / 2)]!.code
}

function observedMode(values: Array<string | null | undefined>) {
  const counts = new Map<string, number>()
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return (
    [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    )[0]?.[0] ?? null
  )
}

function observedMedian(values: Array<number | null | undefined>) {
  const sorted = values
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function observedSum(values: Array<number | null | undefined>) {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value))
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) : null
}

function countsAsNatural(breakOrigin?: string | null) {
  return breakOrigin == null || breakOrigin === '' || breakOrigin.toUpperCase() === 'NAT'
}

/** JN and FT count as natural breaks; a legacy row without a type falls back to its break origin. */
export function isNaturalStructure(observation: Pick<StructureSummaryObservation, 'structureType' | 'breakOrigin'>) {
  return observation.structureType !== undefined
    ? isSpacingStructure(observation.structureType)
    : countsAsNatural(observation.breakOrigin)
}

const EMPTY_CONDITION: Omit<StructureConditionSummary, 'count'> = {
  fractureFrequencyPerM: null, spacingMeanM: null, shapeMode: null,
  roughnessMode: null, wallAlterationMode: null, wallHardnessMode: null, jrcMedian: null,
  projectJcrMedian: null, infillTypeMode: null, infillHardnessMode: null, infillThicknessMedianMm: null,
  continuityMode: null,
  apertureBandMode: null, apertureMedianMm: null, persistenceMedianM: null, persistenceMode: null, l90MacroMode: null,
  l90MicroMode: null, l90WallMode: null, l90FillingMode: null, l90WaterMode: null, l90WeightSum: null,
}

/**
 * Representative condition of one population, in depth order. The same
 * function serves the whole interval and each alpha band so a reader can
 * compare a set against the interval it sits in.
 */
export function summarizeStructureCondition(
  members: readonly StructureSummaryObservation[],
  intervalLengthM: number,
  populationMode: StructurePopulationMode,
  options: { withheld?: boolean } = {}
): StructureConditionSummary {
  if (options.withheld) return { ...EMPTY_CONDITION, count: members.length }
  const ordered = members.map(withOpening).sort((a, b) => a.depthM - b.depthM)
  const spacings = ordered.slice(1).map((observation, index) => observation.depthM - ordered[index]!.depthM)
  const categorical = (values: Array<string | null | undefined>, order: readonly string[]) =>
    observedPopulationValue(values, order, populationMode)
  const surfaceParameters = (member: StructureSummaryObservation) =>
    deriveStructureSurfaceParameters(surfaceLookupCode(member.roughness, member.jointShape))
  return {
    count: ordered.length,
    fractureFrequencyPerM: intervalLengthM > 0 ? ordered.length / intervalLengthM : null,
    spacingMeanM: spacings.length > 0 ? spacings.reduce((sum, spacing) => sum + spacing, 0) / spacings.length : null,
    shapeMode: observedMode(ordered.map((member) => member.jointShape)),
    roughnessMode: categorical(ordered.map((member) => member.roughness), ROUGHNESS_ORDER),
    wallAlterationMode: categorical(ordered.map((member) => member.wallAlteration), WALL_ALTERATION_ORDER),
    wallHardnessMode: categorical(ordered.map((member) => member.wallRockHardness), WALL_HARDNESS_ORDER),
    // Project JCR / JRC come from roughness × small-scale shape; a legacy JRC value only fills a gap.
    jrcMedian: observedMedian(ordered.map((member) => surfaceParameters(member)?.jrc ?? member.jrc)),
    projectJcrMedian: observedMedian(ordered.map((member) => surfaceParameters(member)?.jcr)),
    infillTypeMode: observedMode(ordered.map((member) => member.infillType)),
    infillHardnessMode: categorical(ordered.map((member) => member.infillHardness), INFILL_HARDNESS_ORDER),
    infillThicknessMedianMm: observedMedian(ordered.map((member) => member.infillThicknessMm)),
    continuityMode: categorical(ordered.map((member) => member.jointContinuity), CONTINUITY_ORDER),
    apertureBandMode: categorical(ordered.map((member) => member.apertureBand), APERTURE_BAND_ORDER),
    apertureMedianMm: observedMedian(ordered.map((member) => member.apertureMm)),
    persistenceMedianM: observedMedian(ordered.map((member) => member.persistenceM)),
    persistenceMode: categorical(ordered.map((member) => member.persistenceBand), PERSISTENCE_ORDER),
    l90MacroMode: categorical(ordered.map((member) => member.l90Macro), L90_MACRO_ORDER),
    l90MicroMode: categorical(ordered.map((member) => member.l90Micro), L90_MICRO_ORDER),
    l90WallMode: categorical(ordered.map((member) => member.l90Wall), L90_WALL_ORDER),
    l90FillingMode: categorical(ordered.map((member) => member.l90Filling), L90_FILLING_ORDER),
    l90WaterMode: categorical(ordered.map((member) => member.l90Water), L90_WATER_ORDER),
    l90WeightSum: observedSum(ordered.map((member) => member.l90Weight)),
  }
}

export function deriveStructureIntervalSummary({
  depthFromM,
  depthToM,
  observations,
  populationMode = 'mode',
  nonRmr = false,
}: {
  depthFromM: number
  depthToM: number
  observations: StructureSummaryObservation[]
  populationMode?: StructurePopulationMode
  /** Declared non-RMR ground (Geotechnical Log GSI Integrity): withhold rates, keep tallies. */
  nonRmr?: boolean
}): StructureIntervalSummary {
  const intervalLengthM = Math.max(0, depthToM - depthFromM)
  const natural = observations.filter(isNaturalStructure).sort((a, b) => a.depthM - b.depthM)
  const countByType = observations.reduce<Record<string, number>>((counts, observation) => {
    const key = observation.structureType?.trim().toUpperCase() || 'unclassified'
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
  const reviewedSetIds = new Set(natural.flatMap((observation) => {
    const setId = observation.jointSetId?.trim()
    return setId ? [setId] : []
  }))
  const interval = summarizeStructureCondition(natural, intervalLengthM, populationMode, { withheld: nonRmr })
  // Reporting convention for an existing composite, not a measured distance or
  // an RMR spacing input. Missing reviewed sets and single-break spacing remain
  // unknown; zero must not turn an excluded interval into a rated one.
  if (Number.isFinite(intervalLengthM) && intervalLengthM > 0 && (nonRmr || natural.length === 0)) {
    interval.spacingMeanM = 0
  }

  return {
    naturalCount: natural.length,
    fractureFrequencyPerM: interval.fractureFrequencyPerM,
    spacingMeanM: interval.spacingMeanM,
    countByType,
    reviewedSetCount: nonRmr || reviewedSetIds.size === 0 ? null : reviewedSetIds.size,
    reviewedSetSpacingMinM: nonRmr ? null : deriveApparentSetSpacingM(natural),
    interval,
    excluded: nonRmr,
    sets: STRUCTURE_ALPHA_SETS.map((set) => {
      const members = natural.filter(
        (observation) =>
          observation.alphaDeg != null &&
          Number.isFinite(observation.alphaDeg) &&
          observation.alphaDeg > set.minimumExclusive &&
          observation.alphaDeg <= set.maximum
      )
      // Over declared non-RMR ground the tally is the only statement made:
      // "n breaks were logged" stays true, but no rate or representative
      // condition is offered for ground the framework does not describe.
      return {
        id: set.id,
        label: set.label,
        angleLabel: set.angleLabel,
        ...summarizeStructureCondition(members, intervalLengthM, populationMode, { withheld: nonRmr }),
      }
    }),
  }
}
