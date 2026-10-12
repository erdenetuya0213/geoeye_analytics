/**
 * Apparent downhole spacing of reviewed joint sets.
 *
 * Shared by every RMR edition: Bieniawski 1976 and 1989 both rate the spacing
 * of the most closely spaced set, and the observation behind it is the same
 * primary data — feature depths and the reviewed set each structure belongs
 * to. Alpha bands are not sets; only an explicit `joint_set_id` groups here.
 */
export interface SetSpacingObservation {
  depthM: number
  structureType?: string | null
  jointSetId?: string | null
}

/** Structure codes that count as spacing members in every edition. */
export const SPACING_STRUCTURE_TYPES = ['JN', 'FT'] as const

const code = (value?: string | null) => value?.trim().toUpperCase()

export function isSpacingStructure(structureType?: string | null) {
  return (SPACING_STRUCTURE_TYPES as readonly string[]).includes(code(structureType) ?? '')
}

/**
 * Mean spacing of each reviewed set, then the minimum across sets. Blank when
 * any eligible structure has no set, any set has fewer than two distinct depths,
 * or depths are not strictly increasing — the rating must not guess.
 */
export function deriveApparentSetSpacingM(observations: readonly SetSpacingObservation[]): number | null {
  const eligible = observations.filter((item) => isSpacingStructure(item.structureType))
  const groups = new Map<string, SetSpacingObservation[]>()
  for (const item of eligible) {
    const setId = item.jointSetId?.trim()
    if (setId) groups.set(setId, [...(groups.get(setId) ?? []), item])
  }
  const spacings = [...groups.values()].map((members) => {
    const depths = members.map((item) => item.depthM).sort((a, b) => a - b)
    if (depths.length < 2 || depths.some((depth, index) => !Number.isFinite(depth) || (index > 0 && depth <= depths[index - 1]!))) return null
    // Remove subtraction noise at score boundaries; one nanometre is below logging precision.
    const spacing = (depths[depths.length - 1]! - depths[0]!) / (depths.length - 1)
    return Math.round(spacing * 1e9) / 1e9
  })
  const complete = eligible.length > 0 && eligible.every((item) => item.jointSetId?.trim()) && spacings.length > 0 && spacings.every((spacing) => spacing !== null)
  return complete ? Math.min(...(spacings as number[])) : null
}
