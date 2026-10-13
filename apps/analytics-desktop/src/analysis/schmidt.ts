/** Defaults and conversions for Schmidt-hammer (L-type) and point-load strength estimates. */
export const DEFAULT_UNIT_WEIGHT_KN_M3 = 27
export const DEFAULT_POINT_LOAD_UCS_FACTOR = 24
/** The rebound-to-UCS relation is only meaningful for competent rock; very low readings are soft/weathered or not testable. */
export const SCHMIDT_VALID_RANGE = { max: 70, min: 10 } as const

/**
 * Indicative UCS (MPa) from an L-type rebound number R and dry unit weight
 * γ (kN/m³): UCS = 10^(0.00088·γ·R + 1.01), the Miller/Deere–Miller chart form.
 * Returns null outside the valid rebound range. Calibrate against lab UCS.
 */
export function schmidtToUcsMpa(rebound: number, unitWeightKnM3: number): number | null {
  if (!Number.isFinite(rebound) || !Number.isFinite(unitWeightKnM3) || unitWeightKnM3 <= 0) return null
  if (rebound < SCHMIDT_VALID_RANGE.min || rebound > SCHMIDT_VALID_RANGE.max) return null
  return 10 ** (0.00088 * unitWeightKnM3 * rebound + 1.01)
}

export function pointLoadToUcsMpa(is50Mpa: number, factor = DEFAULT_POINT_LOAD_UCS_FACTOR): number | null {
  return Number.isFinite(is50Mpa) && is50Mpa > 0 && Number.isFinite(factor) && factor > 0 ? is50Mpa * factor : null
}
