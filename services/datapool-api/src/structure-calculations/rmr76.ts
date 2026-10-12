/** Bieniawski 1976; table 8.5 in Hoek, Kaiser & Bawden (1995). */
import { deriveApparentSetSpacingM, isSpacingStructure } from './structure-set-spacing.js'

export const RMR76_REFERENCE = 'https://www.rocscience.com/assets/resources/learning/hoek/Support-of-Underground-Excavations-in-Hard-Rock.pdf'
export const RMR76_JCR_TABLE = {
  sourceUrl: RMR76_REFERENCE, title: 'RMR76 joint condition rating (JCR)', inputLabel: 'Observed joint condition',
  rows: [
    { description: 'Very rough; discontinuous; closed; hard wall rock', score: 25 },
    { description: 'At least slightly rough; opening <1 mm; hard wall rock', score: 20 },
    { description: 'At least slightly rough; opening <1 mm; soft wall rock', score: 12 },
    { description: 'Slickensided, or gouge <5 mm, or continuous opening 1–5 mm', score: 6 },
    { description: 'Soft gouge >5 mm, or continuous opening >5 mm', score: 0 },
  ],
  note: '0–25 scale. Missing or unmatched conditions stay blank. Exactly 5 mm gouge needs review unless another row applies.',
} as const
export const RMR76_SPACING_TABLE = {
  sourceUrl: RMR76_REFERENCE, title: 'RMR76 joint spacing rating', inputLabel: 'Spacing (m)',
  rows: [
    { description: '>3', score: 30 }, { description: '1 to 3', score: 25 },
    { description: '0.3 to <1', score: 20 }, { description: '0.05 to <0.3', score: 10 },
    { description: '>0 to <0.05', score: 5 },
  ],
  note: 'Exact boundaries are explicit. Zero, negative, missing or invalid spacing stays blank.',
} as const

export interface Rmr76Observation {
  depthM: number
  structureType?: string | null
  jointSetId?: string | null
  roughness?: string | null
  apertureMm?: number | null
  infillType?: string | null
  infillThicknessMm?: number | null
  infillHardness?: string | null
  wallAlteration?: string | null
  wallRockHardness?: string | null
  jointContinuity?: string | null
}

const code = (value?: string | null) => value?.trim().toUpperCase()
export function rmr76SpacingScore(spacing?: number | null): number | null {
  if (spacing == null || !Number.isFinite(spacing) || spacing <= 0) return null
  if (spacing > 3) return 30
  if (spacing >= 1) return 25
  if (spacing >= 0.3) return 20
  if (spacing >= 0.05) return 10
  return 5
}

/** Match observations, not JRC or weathering grades, against the condition rows. */
export function rmr76JointConditionScore(observation: Rmr76Observation): number | null {
  if (code(observation.wallAlteration) === 'RS') return null
  const { apertureMm: aperture, infillThicknessMm: thickness } = observation
  const roughness = code(observation.roughness)
  const infill = code(observation.infillType)
  const hardness = code(observation.infillHardness)
  const wall = code(observation.wallRockHardness)
  const continuity = code(observation.jointContinuity)
  if (aperture == null || !Number.isFinite(aperture) || aperture < 0 || thickness == null || !Number.isFinite(thickness) || thickness < 0) return null
  if (!['VR', 'R', 'SR', 'S', 'K'].includes(roughness ?? '') || !['C', 'D'].includes(continuity ?? '') || !infill) return null
  const noInfill = infill === 'N' && thickness === 0
  if ((infill === 'N') !== (thickness === 0)) return null // Conflicting observations.
  if (!noInfill && !['S', 'H', 'G'].includes(hardness ?? '')) return null
  // Bieniawski's "gouge" is any soft filling, whatever mineral it is logged as.
  // A hard, cemented filling is not gouge: its thickness is the separation the
  // walls sit at, and the separation rows apply.
  const gouge = !noInfill && hardness !== 'H'
  const separation = !noInfill && hardness === 'H' ? Math.max(aperture, thickness) : aperture
  if ((gouge && thickness > 5) || (continuity === 'C' && separation > 5)) return 0
  if (roughness === 'K' || (gouge && thickness > 0 && thickness < 5) || (continuity === 'C' && separation >= 1 && separation <= 5)) return 6
  // Exactly 5 mm of gouge, or a separation of 1 mm or more on a discontinuous joint, is left for review.
  if (gouge || separation >= 1) return null
  if (roughness === 'VR' && continuity === 'D' && separation === 0 && wall === 'H') return 25
  if (['VR', 'R', 'SR'].includes(roughness ?? '')) return wall === 'H' ? 20 : wall === 'S' ? 12 : null
  return null
}

/** Explicit project aggregation; do not mistake alpha bands for joint sets. */
export function deriveRmr76Interval(observations: readonly Rmr76Observation[]) {
  const eligible = observations.filter((item) => isSpacingStructure(item.structureType))
  const scores = eligible.map(rmr76JointConditionScore)
  const jcr = scores.length && scores.every((score) => score !== null) ? Math.min(...scores as number[]) : null
  const spacingM = deriveApparentSetSpacingM(eligible)
  return { jcr, spacingM, spacingScore: rmr76SpacingScore(spacingM) }
}
