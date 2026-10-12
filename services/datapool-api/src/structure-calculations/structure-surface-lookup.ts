/** User-supplied surface-condition table. This is a project lookup, not RMR76. */
export const STRUCTURE_SURFACE_LOOKUP = [
  { code: 'VR_ST', observation: 'Very Rough / Stepped', jcr: 30, qRoughness: 4, jrc: 20, jrcMin: 16, jrcMax: 20 },
  { code: 'R_UN', observation: 'Rough / Undulating', jcr: 25, qRoughness: 3, jrc: 16, jrcMin: 12, jrcMax: 16 },
  { code: 'S_UN', observation: 'Smooth / Undulating', jcr: 20, qRoughness: 2, jrc: 12, jrcMin: 6, jrcMax: 12 },
  { code: 'S_PL', observation: 'Smooth / Planar', jcr: 10, qRoughness: 1, jrc: 6, jrcMin: 2, jrcMax: 6 },
  { code: 'K_PL', observation: 'Slickensided / Planar', jcr: 0, qRoughness: 0.5, jrc: 2, jrcMin: 0, jrcMax: 2 },
] as const

/**
 * The lookup key is roughness × small-scale shape, both primary observations
 * of the Structure Log. Nothing is logged for it; combinations the project
 * table does not name have no project value.
 */
export function surfaceLookupCode(roughness?: string | null, jointShape?: string | null) {
  const r = roughness?.trim().toUpperCase()
  const shape = jointShape?.trim().toUpperCase()
  return r && shape ? `${r}_${shape}` : null
}

export function deriveStructureSurfaceParameters(observation?: string | null) {
  const normalized = observation?.trim().toUpperCase()
  return STRUCTURE_SURFACE_LOOKUP.find((row) => row.code === normalized || row.observation.toUpperCase() === normalized) ?? null
}
