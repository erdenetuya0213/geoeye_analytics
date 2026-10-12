export interface ObservationGuide {
  title: string
  headers: readonly string[]
  rows: readonly (readonly string[])[]
}

/**
 * Aperture classes (ISRM 1978). `representativeMm` is the value the rating
 * tables read for a class: chosen so a class that straddles a Bieniawski
 * boundary lands on the more adverse side, never the kinder one.
 */
export const APERTURE_BANDS = [
  { code: 'TG', label: 'Tight / closed (0 mm)', limit: 0, representativeMm: 0 },
  { code: 'VN', label: 'Very narrow (<0.1 mm)', limit: 0.1, representativeMm: 0.05 },
  { code: 'NA', label: 'Narrow (0.1–0.25 mm)', limit: 0.25, representativeMm: 0.2 },
  { code: 'PO', label: 'Partly open (0.25–0.5 mm)', limit: 0.5, representativeMm: 0.4 },
  { code: 'OP', label: 'Open (0.5–2.5 mm)', limit: 2.5, representativeMm: 2 },
  { code: 'ML', label: 'Moderately large (2.5–10 mm)', limit: 10, representativeMm: 6 },
  { code: 'LA', label: 'Large (10–100 mm)', limit: 100, representativeMm: 50 },
  { code: 'VL', label: 'Very large (100–1000 mm)', limit: 1000, representativeMm: 500 },
  { code: 'EL', label: 'Extremely large (≥1000 mm)', limit: Infinity, representativeMm: 5000 },
] as const
export function apertureBand(mm: number | null | undefined) {
  if (mm == null || !Number.isFinite(mm) || mm < 0) return null
  if (mm === 0) return 'TG'
  return APERTURE_BANDS.find((band) => band.limit > 0 && mm < band.limit)?.code ?? null
}
/** Millimetres a rating table reads for an aperture class; null for an unknown code. */
export function apertureBandRepresentativeMm(code: string | null | undefined) {
  const normalized = code?.trim().toUpperCase()
  return APERTURE_BANDS.find((band) => band.code === normalized)?.representativeMm ?? null
}

