import { deriveLaubscher90Interval } from './laubscher90.js'
import type { StructureRatingSystem } from './structure-rating-systems.js'
import { deriveRmr76Interval } from './rmr76.js'
import { deriveRmr89Interval } from './rmr89.js'
import {
  STRUCTURE_ALPHA_SETS,
  type StructureConditionSummary,
  type StructurePopulationMode,
  type StructureSetSummary,
  type StructureSummaryObservation,
  deriveStructureIntervalSummary,
  withOpening,
} from './structure-log-summary.js'

export interface StructureExportComposite {
  depthFromM: number
  depthToM: number
  observations: StructureSummaryObservation[]
  /** Declared non-RMR ground: rates and rating components are withheld, counts remain. */
  nonRmr?: boolean
  nonRmrReason?: string | null
}

/** One composite interval's derivations, keyed by completed-CSV column label. */
export interface StructureCompositeExportRecord {
  depthFromM: number
  depthToM: number
  /** Every column of the schema; '' where nothing was observed. */
  values: Record<string, string>
}

type ColumnGate = 'condition' | 'laubscher90'

interface ConditionColumn {
  suffix: string
  value: (summary: StructureConditionSummary) => string
  /** Present only when a rating system that reads the observation is selected. */
  gate?: ColumnGate
  /** Set columns only; the interval already reports the value elsewhere. */
  setsOnly?: boolean
  text?: boolean
}

function formatOptional(value: number | null, decimals: number) {
  return value == null ? '' : value.toFixed(decimals)
}

function formatText(value: string | null) {
  return value ?? ''
}

/**
 * Every representative value a Bieniawski (1976, 1989) or Laubscher (1990)
 * table is read with, in one order for the interval and for each alpha band.
 * Values the template does not collect stay absent from the schema rather
 * than exporting as permanently blank columns.
 */
const CONDITION_COLUMNS: ConditionColumn[] = [
  { suffix: 'count', setsOnly: true, value: (summary) => String(summary.count) },
  { suffix: 'fracture frequency', setsOnly: true, value: (summary) => formatOptional(summary.fractureFrequencyPerM, 2) },
  { suffix: 'joint spacing', setsOnly: true, value: (summary) => formatOptional(summary.spacingMeanM, 3) },
  { suffix: 'shape', text: true, value: (summary) => formatText(summary.shapeMode) },
  { suffix: 'roughness', text: true, value: (summary) => formatText(summary.roughnessMode) },
  { suffix: 'JRC median', value: (summary) => formatOptional(summary.jrcMedian, 1) },
  { suffix: 'Project JCR median', value: (summary) => formatOptional(summary.projectJcrMedian, 1) },
  { suffix: 'wall alteration', text: true, value: (summary) => formatText(summary.wallAlterationMode) },
  { suffix: 'wall hardness', text: true, gate: 'condition', value: (summary) => formatText(summary.wallHardnessMode) },
  { suffix: 'infill', text: true, value: (summary) => formatText(summary.infillTypeMode) },
  { suffix: 'infill hardness', text: true, gate: 'condition', value: (summary) => formatText(summary.infillHardnessMode) },
  { suffix: 'thickness median', value: (summary) => formatOptional(summary.infillThicknessMedianMm, 2) },
  { suffix: 'continuity', text: true, gate: 'condition', value: (summary) => formatText(summary.continuityMode) },
  { suffix: 'aperture description', text: true, value: (summary) => formatText(summary.apertureBandMode) },
  { suffix: 'aperture median', value: (summary) => formatOptional(summary.apertureMedianMm, 2) },
  { suffix: 'persistence', text: true, value: (summary) => formatText(summary.persistenceMode) },
  { suffix: 'RMR90 macro', text: true, gate: 'laubscher90', value: (summary) => formatText(summary.l90MacroMode) },
  { suffix: 'RMR90 micro', text: true, gate: 'laubscher90', value: (summary) => formatText(summary.l90MicroMode) },
  { suffix: 'RMR90 wall', text: true, gate: 'laubscher90', value: (summary) => formatText(summary.l90WallMode) },
  { suffix: 'RMR90 filling', text: true, gate: 'laubscher90', value: (summary) => formatText(summary.l90FillingMode) },
  { suffix: 'RMR90 water', text: true, gate: 'laubscher90', value: (summary) => formatText(summary.l90WaterMode) },
  { suffix: 'RMR90 weight sum', gate: 'laubscher90', value: (summary) => formatOptional(summary.l90WeightSum, 2) },
]

const INTERVAL_PREFIX = 'Interval'

function setColumnPrefix(set: Pick<StructureSetSummary, 'label' | 'angleLabel'>) {
  return `${set.label} (${set.angleLabel})`
}

export const NON_RMR_EXPORT_COLUMN = 'Non-RMR zone'
export const NON_RMR_DEFAULT_NOTE = 'Declared non-RMR zone — joint spacing reported as 0; excluded from rating calculations'
export const REVIEWED_SET_COUNT_COLUMN = 'Reviewed set count'
export const REVIEWED_SET_SPACING_COLUMN = 'Reviewed set spacing min (m)'

export const RMR76_EXPORT_COLUMNS = ['RMR76 JCR', 'RMR76 apparent spacing (m)', 'RMR76 spacing score'] as const
export const RMR89_EXPORT_COLUMNS = ['RMR89 condition (R4)', 'RMR89 apparent spacing (m)', 'RMR89 spacing score (R3)'] as const
export const RMR90_EXPORT_COLUMNS = ['RMR90 joint condition'] as const

function activeGates(systems: readonly StructureRatingSystem[]): Set<ColumnGate> {
  const gates = new Set<ColumnGate>()
  if (systems.some((system) => system === 'rmr76' || system === 'rmr89' || system === 'q')) gates.add('condition')
  if (systems.includes('laubscher90')) gates.add('laubscher90')
  return gates
}

function conditionColumns(systems: readonly StructureRatingSystem[]) {
  const gates = activeGates(systems)
  const omitProjectLookup = systems.length > 0 && !systems.includes('q')
  return CONDITION_COLUMNS.filter((column) =>
    (!column.gate || gates.has(column.gate)) && !(omitProjectLookup && /JRC median|Project JCR median/.test(column.suffix))
  )
}

/**
 * The composite columns of a completed Structure Log, in export order: the
 * interval rates and reviewed-set summary, the representative interval
 * condition, every alpha-band summary from Set 1 to Set 3, then the non-RMR
 * declaration and any selected rating components. Fixed per template so each
 * borehole's CSV has one schema.
 */
export function structureCompositeExportColumns(systems: readonly StructureRatingSystem[] = []) {
  const columns = conditionColumns(systems)
  return [
    'Fracture frequency',
    'Joint spacing',
    REVIEWED_SET_COUNT_COLUMN,
    REVIEWED_SET_SPACING_COLUMN,
    ...columns.filter((column) => !column.setsOnly).map((column) => `${INTERVAL_PREFIX} ${column.suffix}`),
    ...STRUCTURE_ALPHA_SETS.flatMap((set) => columns.map((column) => `${setColumnPrefix(set)} ${column.suffix}`)),
    NON_RMR_EXPORT_COLUMN,
    ...(systems.includes('rmr76') ? RMR76_EXPORT_COLUMNS : []),
    ...(systems.includes('rmr89') ? RMR89_EXPORT_COLUMNS : []),
    ...(systems.includes('laubscher90') ? RMR90_EXPORT_COLUMNS : []),
  ]
}

/** The schema of a template with no rating system selected. */
export const STRUCTURE_COMPOSITE_EXPORT_COLUMNS: readonly string[] = structureCompositeExportColumns()

const TEXT_SUFFIXES = CONDITION_COLUMNS.filter((column) => column.text).map((column) => column.suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

/** Columns whose values are categorical text rather than numbers. */
export const STRUCTURE_TEXT_EXPORT_COLUMN_PATTERN = new RegExp(`(?:${TEXT_SUFFIXES.join('|')})$|Non-RMR`)

/**
 * Derive the composite values of each Structure Log interval for the
 * completed CSV. Raw observations keep their own rows; these records hold the
 * interval and joint-set results that are repeated on every structure row of
 * the interval so the derivation is explicit and reproducible downstream.
 */
export function deriveStructureCompositeExportRecords({
  composites,
  populationMode = 'mode',
  ratingSystems = [],
}: {
  composites: StructureExportComposite[]
  populationMode?: StructurePopulationMode
  ratingSystems?: readonly StructureRatingSystem[]
}): StructureCompositeExportRecord[] {
  const columns = structureCompositeExportColumns(ratingSystems)
  const conditions = conditionColumns(ratingSystems)
  return composites.map((composite) => {
    const summary = deriveStructureIntervalSummary({
      depthFromM: composite.depthFromM,
      depthToM: composite.depthToM,
      observations: composite.observations,
      populationMode,
      nonRmr: composite.nonRmr ?? false,
    })
    const values: Record<string, string> = Object.fromEntries(columns.map((column) => [column, '']))
    values['Fracture frequency'] = formatOptional(summary.fractureFrequencyPerM, 2)
    values['Joint spacing'] = formatOptional(summary.spacingMeanM, 3)
    values[REVIEWED_SET_COUNT_COLUMN] = summary.reviewedSetCount == null ? '' : String(summary.reviewedSetCount)
    values[REVIEWED_SET_SPACING_COLUMN] = formatOptional(summary.reviewedSetSpacingMinM, 3)

    // An interval or set with no natural structure has nothing to summarize:
    // every one of its columns stays blank rather than reporting a count of
    // zero with empty modes.
    if (summary.interval.count > 0) {
      for (const column of conditions.filter((candidate) => !candidate.setsOnly)) {
        values[`${INTERVAL_PREFIX} ${column.suffix}`] = column.value(summary.interval)
      }
    }
    for (const set of summary.sets.filter((candidate) => candidate.count > 0)) {
      const prefix = setColumnPrefix(set)
      for (const column of conditions) values[`${prefix} ${column.suffix}`] = column.value(set)
    }

    if (summary.excluded) {
      // Keep the exclusion even though interval spacing is reported as zero.
      // Rating components stay blank; the reporting convention is not a rating.
      values[NON_RMR_EXPORT_COLUMN] = composite.nonRmrReason?.trim() || NON_RMR_DEFAULT_NOTE
    } else {
      const rated = composite.observations.map(withOpening)
      if (ratingSystems.includes('laubscher90')) values['RMR90 joint condition'] = formatOptional(deriveLaubscher90Interval(rated), 2)
      if (ratingSystems.includes('rmr76')) {
        const rating = deriveRmr76Interval(rated)
        values['RMR76 JCR'] = formatOptional(rating.jcr, 0)
        values['RMR76 apparent spacing (m)'] = formatOptional(rating.spacingM, 3)
        values['RMR76 spacing score'] = formatOptional(rating.spacingScore, 0)
      }
      if (ratingSystems.includes('rmr89')) {
        const rating = deriveRmr89Interval(rated)
        values['RMR89 condition (R4)'] = formatOptional(rating.condition, 0)
        values['RMR89 apparent spacing (m)'] = formatOptional(rating.spacingM, 3)
        values['RMR89 spacing score (R3)'] = formatOptional(rating.spacingScore, 0)
      }
    }
    return { depthFromM: composite.depthFromM, depthToM: composite.depthToM, values }
  })
}
