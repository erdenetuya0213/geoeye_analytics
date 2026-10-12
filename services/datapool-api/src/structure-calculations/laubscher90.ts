/** Laubscher (1990), Table I, pp. 260–261. Values are percentages. */
export const LAUBSCHER90_REFERENCE = 'https://www.saimm.co.za/Journal/v090n10p257.pdf'
const waterHeaders = ['Dry (%)', 'Moist (%)', 'Moderate inflow (%)', 'High inflow (%)']
export const L90_MACRO = [
  { code: 'MW', label: 'Multidirectional waves', values: [100, 100, 95, 90] },
  { code: 'UW', label: 'Unidirectional waves', values: [95, 90, 85, 80] },
  { code: 'CU', label: 'Curved', values: [85, 80, 75, 70] },
  { code: 'SU', label: 'Slight undulation', values: [80, 75, 70, 65] },
  { code: 'ST', label: 'Straight', values: [75, 70, 65, 60] },
] as const
export const L90_MICRO = [
  { code: 'R_ST', label: 'Rough, stepped / irregular', values: [95, 90, 85, 80] },
  { code: 'S_ST', label: 'Smooth, stepped', values: [90, 85, 80, 75] },
  { code: 'K_ST', label: 'Slickensided, stepped', values: [85, 80, 75, 70] },
  { code: 'R_UN', label: 'Rough, undulating', values: [80, 75, 70, 65] },
  { code: 'S_UN', label: 'Smooth, undulating', values: [75, 70, 65, 60] },
  { code: 'K_UN', label: 'Slickensided, undulating', values: [70, 65, 60, 55] },
  { code: 'R_PL', label: 'Rough, planar', values: [65, 60, 55, 50] },
  { code: 'S_PL', label: 'Smooth, planar', values: [60, 55, 50, 45] },
  { code: 'P', label: 'Polished', values: [55, 50, 45, 40] },
] as const
export const L90_WALL = [
  { code: 'W', label: 'Altered wall weaker than host rock and, if filled, weaker than filling', values: [75, 70, 65, 60] },
  { code: 'N', label: 'Reviewed: wall weakening adjustment does not apply', values: [100, 100, 100, 100] },
] as const
export const L90_FILLING = [
  { code: 'N', label: 'No filling (neutral factor)', values: [100, 100, 100, 100] },
  { code: 'NC', label: 'Non-softening sheared filling, coarse', values: [90, 85, 80, 75] },
  { code: 'NM', label: 'Non-softening sheared filling, medium', values: [85, 80, 75, 70] },
  { code: 'NF', label: 'Non-softening sheared filling, fine', values: [80, 75, 70, 65] },
  { code: 'SC', label: 'Soft sheared filling, coarse', values: [70, 65, 60, 55] },
  { code: 'SM', label: 'Soft sheared filling, medium', values: [60, 55, 50, 45] },
  { code: 'SF', label: 'Soft sheared filling, fine', values: [50, 45, 40, 35] },
  { code: 'GL', label: 'Gouge thinner than surface irregularity amplitude', values: [45, 40, 35, 30] },
  { code: 'GT', label: 'Gouge thicker than surface irregularity amplitude', values: [30, 20, 15, 10] },
] as const
export const L90_WATER = [
  { code: 'D', label: 'Dry in situ' }, { code: 'M', label: 'Moist in situ' },
  { code: 'P', label: 'Moderate pressure / inflow, 25–125 l/min' },
  { code: 'H', label: 'High pressure / inflow, >125 l/min' },
] as const
const table = (title: string, entries: ReadonlyArray<{label: string; values: readonly number[]}>) => ({
  title, inputLabel: 'Observation', scoreHeaders: waterHeaders,
  sourceUrl: LAUBSCHER90_REFERENCE, sourceLabel: 'Laubscher 1990 — Table I, p. 261',
  rows: entries.map((entry) => ({ description: entry.label, score: entry.values })),
  note: 'Select the same in-situ water column for A, B, C and D. Wet core photographs do not establish groundwater conditions. Neutral 100% requires an explicit not-applicable observation.',
})
export const L90_MACRO_TABLE = table('RMR90 A — large-scale expression', L90_MACRO)
export const L90_MICRO_TABLE = table('RMR90 B — small-scale expression (200 × 200 mm)', L90_MICRO)
export const L90_WALL_TABLE = table('RMR90 C — joint-wall weakening', L90_WALL)
export const L90_FILLING_TABLE = table('RMR90 D — filling', L90_FILLING)
export const L90_CONDITION_FORMULA = 'JCᵢ = 40 × (Aᵢ/100) × (Bᵢ/100) × (Cᵢ/100) × (Dᵢ/100); JCinterval = Σ(wᵢ × JCᵢ) / Σwᵢ'
export const L90_FF_POINTS = [
  [0.1,40,40,40], [0.15,40,40,40], [0.2,40,40,38], [0.25,40,38,36],
  [0.3,38,36,34], [0.5,36,34,31], [0.8,34,31,28], [1,31,28,26],
  [1.5,29,26,24], [2,26,24,21], [3,24,21,18], [5,21,18,15],
  [7,18,15,12], [10,15,12,10], [15,12,10,7], [20,10,7,5], [30,7,5,2], [40,5,2,0],
] as const
export const L90_FF_TABLE = {
  title: 'RMR90 fracture frequency rating (0–40)', inputLabel: 'Adjusted average FF (per metre)',
  scoreHeaders: ['1 set', '2 sets', '3 sets'], sourceUrl: LAUBSCHER90_REFERENCE,
  sourceLabel: 'Laubscher 1990 — Tables I–III, pp. 260–261',
  rows: L90_FF_POINTS.map(([ff, ...scores]) => ({ description: String(ff), score: scores })),
  note: 'Published lookup points, not interval limits. Requires reviewed geological sets, sampling/angle correction and core recovery. No automatic interpolation or rating from raw JN/FT counts.',
}
export const L90_SAMPLING_TABLE = {
  title: 'RMR90 sampling divisor', inputLabel: 'Reviewed sampling arrangement', sourceUrl: LAUBSCHER90_REFERENCE,
  sourceLabel: 'Laubscher 1990 — Table II',
  rows: [
    { description: 'One set sampled on one line', score: 1 },
    { description: 'Two sets sampled on one line', score: 1.5 },
    { description: 'All sets sampled on one line / borehole', score: 2 },
    { description: 'Two sets on one line, third on another', score: 2.4 },
    { description: 'Three sets on three perpendicular lines', score: 3 },
  ],
  note: 'One/two-set sampling requires comparable set spacing. Review missed sets and intersection-angle bias before applying.',
}
export interface Laubscher90Observation {
  structureType?: string | null
  l90Macro?: string | null
  l90Micro?: string | null
  l90Wall?: string | null
  l90Filling?: string | null
  l90Water?: string | null
  l90Weight?: number | null
}
const code = (value?: string | null) => value?.trim().toUpperCase()
/** Keep the lookup factors alongside the result; never infer missing values as neutral. */
export function deriveLaubscher90Condition(observation: Laubscher90Observation) {
  const water = L90_WATER.findIndex((item) => item.code === code(observation.l90Water))
  const lookup = (entries: ReadonlyArray<{code: string; values: readonly number[]}>, value?: string | null) =>
    water < 0 ? null : entries.find((entry) => entry.code === code(value))?.values[water] ?? null
  const a = lookup(L90_MACRO, observation.l90Macro), b = lookup(L90_MICRO, observation.l90Micro)
  const c = lookup(L90_WALL, observation.l90Wall), d = lookup(L90_FILLING, observation.l90Filling)
  const score = a === null || b === null || c === null || d === null ? null : 40 * a * b * c * d / 1e8
  return { a, b, c, d, score }
}
/** Project aggregation: explicit representative weights for the selected JN/FT population. */
export function deriveLaubscher90Interval(observations: readonly Laubscher90Observation[]) {
  const eligible = observations.filter((item) => ['JN', 'FT'].includes(code(item.structureType) ?? ''))
  const entries = eligible.map((item) => ({ ...deriveLaubscher90Condition(item), weight: item.l90Weight }))
  if (!entries.length || entries.some((item) => item.score === null || item.weight == null || !Number.isFinite(item.weight) || item.weight <= 0)) return null
  // Normalize before summing to avoid overflow with large valid weights.
  const max = Math.max(...entries.map((item) => item.weight!))
  const weight = entries.reduce((sum, item) => sum + item.weight! / max, 0)
  return entries.reduce((sum, item) => sum + item.score! * (item.weight! / max), 0) / weight
}
