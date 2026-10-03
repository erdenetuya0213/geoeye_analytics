export type PointLoadTestType = 'diametral' | 'axial' | 'block-irregular'

export interface PointLoadResult {
  correctionFactor: number
  is50Mpa: number
  isMpa: number
}

/**
 * Calculates the point-load strength index from peak load and equivalent core
 * diameter, then applies the standard 50 mm size correction.
 */
export function calculatePointLoadIndex(peakLoadKn: number, equivalentDiameterMm: number): PointLoadResult {
  if (!Number.isFinite(peakLoadKn) || peakLoadKn <= 0) {
    throw new RangeError('Peak load must be greater than zero.')
  }
  if (!Number.isFinite(equivalentDiameterMm) || equivalentDiameterMm <= 0) {
    throw new RangeError('Equivalent diameter must be greater than zero.')
  }

  const isMpa = (peakLoadKn * 1_000) / equivalentDiameterMm ** 2
  const correctionFactor = (equivalentDiameterMm / 50) ** 0.45

  return {
    correctionFactor,
    is50Mpa: correctionFactor * isMpa,
    isMpa,
  }
}
