/**
 * Bieniawski 1989 discontinuity components, derived from the primary Structure
 * Log observations. Nothing here is logged: persistence, aperture, roughness,
 * infill and joint-wall weathering are observed once per structure and rated
 * here, so RMR76 and RMR89 read the same rows through different tables.
 *
 * Reference: Bieniawski (1989), Engineering Rock Mass Classifications, Table 4.1
 * (guidelines for classification of discontinuity conditions) and RMR spacing.
 */
import { deriveApparentSetSpacingM, isSpacingStructure } from './structure-set-spacing.js'
import { apertureBandRepresentativeMm } from './structure-observation-guides.js'

export const RMR89_REFERENCE = 'https://www.rocscience.com/assets/resources/learning/hoek/Support-of-Underground-Excavations-in-Hard-Rock.pdf'

export const RMR89_CONDITION_TABLE = {
  sourceUrl: RMR89_REFERENCE, sourceLabel: 'Bieniawski 1989 — discontinuity condition guidelines',
  title: 'RMR89 discontinuity condition (R4)', inputLabel: 'Observation', scoreHeaders: ['Rating'],
  rows: [
    { description: 'Persistence <1 m / 1–3 m / 3–10 m / 10–20 m / >20 m', score: '6 / 4 / 2 / 1 / 0' },
    { description: 'Aperture none / <0.1 mm / 0.1–1 mm / 1–5 mm / >5 mm', score: '6 / 5 / 4 / 1 / 0' },
    { description: 'Roughness very rough / rough / slightly rough / smooth / slickensided', score: '6 / 5 / 3 / 1 / 0' },
    { description: 'Infilling none / hard <5 mm / hard >5 mm / soft <5 mm / soft >5 mm', score: '6 / 4 / 2 / 2 / 0' },
    { description: 'Joint-wall weathering unweathered / slightly / moderately / highly / decomposed', score: '6 / 5 / 3 / 1 / 0' },
  ],
  note: 'R4 = Σ five sub-ratings (0–30) per structure. A missing, conflicting or unmatched observation leaves the structure unrated; exactly 5 mm infill needs review.',
} as const

export const RMR89_SPACING_TABLE = {
  sourceUrl: RMR89_REFERENCE, sourceLabel: 'Bieniawski 1989 — spacing of discontinuities',
  title: 'RMR89 discontinuity spacing rating (R3)', inputLabel: 'Spacing (m)',
  rows: [
    { description: '>2', score: 20 }, { description: '0.6 to 2', score: 15 },
    { description: '0.2 to <0.6', score: 10 }, { description: '0.06 to <0.2', score: 8 },
    { description: '>0 to <0.06', score: 5 },
  ],
  note: 'Apparent downhole spacing of the most closely spaced reviewed set. Zero, negative, missing or invalid spacing stays blank.',
} as const

export interface Rmr89Observation {
  depthM: number
  structureType?: string | null
  jointSetId?: string | null
  persistenceM?: number | null
  /** `persistence_band` code when the trace length was logged as a class. */
  persistenceBand?: string | null
  /** Measured aperture; preferred over the descriptive band. */
  apertureMm?: number | null
  /** `aperture_band` code when only a description was observed. */
  apertureBand?: string | null
  roughness?: string | null
  infillType?: string | null
  infillThicknessMm?: number | null
  infillHardness?: string | null
  /** `jwa` joint-wall alteration code. */
  wallAlteration?: string | null
}

export interface Rmr89ConditionScore {
  persistence: number | null
  aperture: number | null
  roughness: number | null
  infill: number | null
  weathering: number | null
  /** Sum of the five sub-ratings, or null when any is unrated. */
  total: number | null
}

const code = (value?: string | null) => value?.trim().toUpperCase()
const finite = (value?: number | null): value is number => value != null && Number.isFinite(value)

const PERSISTENCE_BAND_SCORES: Record<string, number> = { VL: 6, L: 4, M: 2, H: 1, VH: 0 }

export function rmr89PersistenceScore(persistenceM?: number | null, persistenceBand?: string | null): number | null {
  if (!finite(persistenceM)) {
    const band = code(persistenceBand)
    return band ? PERSISTENCE_BAND_SCORES[band] ?? null : null
  }
  if (persistenceM < 0) return null
  if (persistenceM < 1) return 6
  if (persistenceM < 3) return 4
  if (persistenceM < 10) return 2
  if (persistenceM <= 20) return 1
  return 0
}

/** An aperture class reads as its representative millimetres, on the adverse side of any straddled boundary. */
export function rmr89ApertureScore(apertureMm?: number | null, apertureBand?: string | null): number | null {
  if (!finite(apertureMm)) apertureMm = apertureBandRepresentativeMm(apertureBand)
  if (finite(apertureMm)) {
    if (apertureMm < 0) return null
    if (apertureMm === 0) return 6
    if (apertureMm < 0.1) return 5
    if (apertureMm < 1) return 4
    if (apertureMm <= 5) return 1
    return 0
  }
  return null
}

const ROUGHNESS_SCORES: Record<string, number> = { VR: 6, R: 5, SR: 3, S: 1, K: 0 }

export function rmr89RoughnessScore(roughness?: string | null): number | null {
  const value = code(roughness)
  return value ? ROUGHNESS_SCORES[value] ?? null : null
}

/**
 * Infill from the same three observations RMR76 reads: material, hardness and
 * measured thickness. "None" must agree with a zero thickness; anything else
 * needs a hardness call, because a mineral name alone does not say hard or soft.
 */
export function rmr89InfillScore(infillType?: string | null, infillHardness?: string | null, infillThicknessMm?: number | null): number | null {
  const infill = code(infillType)
  const hardness = code(infillHardness)
  if (!infill || !finite(infillThicknessMm) || infillThicknessMm < 0) return null
  const none = infill === 'N'
  if (none !== (infillThicknessMm === 0)) return null // Conflicting observations.
  if (none) return 6
  if (infillThicknessMm === 5) return null // Boundary case: review, do not guess.
  if (hardness === 'H') return infillThicknessMm < 5 ? 4 : 2
  if (hardness === 'S' || hardness === 'G') return infillThicknessMm < 5 ? 2 : 0
  return null
}

const WEATHERING_SCORES: Record<string, number> = { FR: 6, SW: 5, MW: 3, HW: 1, CW: 0 }

/** Residual soil (RS) is outside the rock-mass table and stays unrated. */
export function rmr89WeatheringScore(wallAlteration?: string | null): number | null {
  const value = code(wallAlteration)
  return value ? WEATHERING_SCORES[value] ?? null : null
}

export function rmr89SpacingScore(spacingM?: number | null): number | null {
  if (!finite(spacingM) || spacingM <= 0) return null
  if (spacingM > 2) return 20
  if (spacingM >= 0.6) return 15
  if (spacingM >= 0.2) return 10
  if (spacingM >= 0.06) return 8
  return 5
}

export function rmr89ConditionScore(observation: Rmr89Observation): Rmr89ConditionScore {
  const parts = {
    persistence: rmr89PersistenceScore(observation.persistenceM, observation.persistenceBand),
    aperture: rmr89ApertureScore(observation.apertureMm, observation.apertureBand),
    roughness: rmr89RoughnessScore(observation.roughness),
    infill: rmr89InfillScore(observation.infillType, observation.infillHardness, observation.infillThicknessMm),
    weathering: rmr89WeatheringScore(observation.wallAlteration),
  }
  const values = Object.values(parts)
  return { ...parts, total: values.every((value) => value !== null) ? values.reduce((sum, value) => sum + (value as number), 0) : null }
}

/**
 * Interval components over the JN/FT population: the most adverse complete R4
 * (matching the RMR76 aggregation) and the spacing of the closest reviewed set.
 * One unrated eligible structure leaves R4 blank rather than rating a subset.
 */
export function deriveRmr89Interval(observations: readonly Rmr89Observation[]) {
  const eligible = observations.filter((item) => isSpacingStructure(item.structureType))
  const totals = eligible.map((item) => rmr89ConditionScore(item).total)
  const condition = totals.length && totals.every((total) => total !== null) ? Math.min(...(totals as number[])) : null
  const spacingM = deriveApparentSetSpacingM(eligible)
  return { condition, spacingM, spacingScore: rmr89SpacingScore(spacingM) }
}
