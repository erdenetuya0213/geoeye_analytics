import type { ExperimentalVariogram, VariogramModel } from './engineClient.js'
import { practicalRange } from './variogramModel.js'

export type Severity = 'good' | 'note' | 'warn'
export interface Advice { severity: Severity; title: string; detail: string }

/** Median nearest-collar spacing → lag; enough lags to reach half the extent. */
export function lagAdvice(collars: Array<[number, number]>, extent: number): { lag: number; lagCount: number; spacing: number } {
  if (collars.length < 2) return { lag: Math.max(1, Math.round(extent / 10)), lagCount: 10, spacing: extent }
  const nearest = collars.map((a, i) => Math.min(...collars.filter((_, j) => j !== i).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))))
  const spacing = [...nearest].sort((l, r) => l - r)[Math.floor(nearest.length / 2)] ?? extent
  const lag = Number(spacing.toPrecision(2))
  return { lag, lagCount: Math.max(6, Math.min(25, Math.ceil(extent / 2 / lag))), spacing }
}

export function experimentalAdvice(label: string, exp: ExperimentalVariogram | null, sill: number, spacing: number): Advice[] {
  if (exp === null || exp.lags.length === 0) return [{ severity: 'warn', title: `${label}: no pairs`, detail: 'No sample pairs fall in this direction. Widen the tolerance or bandwidth, or accept that the data cannot inform it.' }]
  const out: Advice[] = []
  const weak = exp.lags.filter((l) => l.pairs < 30).length
  if (weak > 0) out.push({ severity: weak > exp.lags.length / 2 ? 'warn' : 'note', title: `${label}: ${weak} of ${exp.lags.length} lags have < 30 pairs`, detail: 'Points with few pairs swing a lot — give them little weight when fitting. Larger lag, wider tolerance or more holes help.' })
  const first = exp.lags[0]
  if (first && first.distance > spacing * 1.5) out.push({ severity: 'note', title: `${label}: first lag at ${Math.round(first.distance)} m`, detail: `Nothing closer than ~1.5× drill spacing (${Math.round(spacing)} m); the nugget in this direction is set by the downhole variogram, not by this one.` })
  const reach = exp.lags.filter((l) => l.pairs >= 30).map((l) => l.gamma)
  if (reach.length >= 3 && Math.max(...reach) < 0.8 * sill) out.push({ severity: 'note', title: `${label}: does not reach the sill`, detail: 'Continuity may extend beyond the lags computed, or a trend is present. Try more lags; if γ keeps rising, consider detrending or a zonal structure.' })
  return out
}

export function modelAdvice(model: VariogramModel, spacing: number, hMax: number, holes: number): Advice[] {
  const out: Advice[] = []
  const nuggetRatio = model.totalSill > 0 ? model.nugget / model.totalSill : 0
  out.push(nuggetRatio < 0.25
    ? { severity: 'good', title: `Nugget ${Math.round(nuggetRatio * 100)} % — low`, detail: 'Small-scale variability is modest; estimates will honour nearby samples closely. Typical of coal quality, iron, geotech indices.' }
    : nuggetRatio < 0.5
      ? { severity: 'note', title: `Nugget ${Math.round(nuggetRatio * 100)} % — moderate`, detail: 'Expect smoothing in estimates and some conditional bias at small blocks. Keep min samples ≥ 8–12 in KNA.' }
      : { severity: 'warn', title: `Nugget ${Math.round(nuggetRatio * 100)} % — high`, detail: 'Over half the variance is at zero distance (sampling error, erratic mineralisation, or wrong support). Check QA/QC and composite length before estimating; kriging will smooth heavily.' })
  const r = [0, 1, 2].map((k) => practicalRange(model, k, hMax * 3))
  const major = Math.max(...r), minor = Math.min(...r)
  const ratio = major / Math.max(minor, 1e-9)
  out.push(ratio < 1.5
    ? { severity: 'good', title: `Near-isotropic (${ratio.toFixed(1)}:1)`, detail: 'Little directional preference. A spherical search is adequate.' }
    : ratio < 4
      ? { severity: 'note', title: `Anisotropy ${ratio.toFixed(1)}:1`, detail: 'Moderate anisotropy — use an ellipsoidal search aligned with D1/D2/D3; check the fan agrees with the chosen strike.' }
      : { severity: 'warn', title: `Strong anisotropy ${ratio.toFixed(1)}:1`, detail: 'Very elongated ellipsoid. Confirm it is geology (vein/seam) and not an artefact of drill orientation or few holes.' })
  const r1 = r[0] ?? 0
  out.push(r1 < spacing
    ? { severity: 'warn', title: `Major range ${Math.round(r1)} m < drill spacing ${Math.round(spacing)} m`, detail: 'Holes are further apart than the correlation length: most blocks will be estimated from poorly correlated samples. Infill drilling or classification as Inferred is likely.' }
    : r1 < 2 * spacing
      ? { severity: 'note', title: `Major range ${Math.round(r1)} m ≈ 1–2× drill spacing`, detail: 'Workable for Indicated with a careful search; variogram parameters carry real uncertainty.' }
      : { severity: 'good', title: `Major range ${Math.round(r1)} m ≥ 2× drill spacing`, detail: 'Drilling resolves the continuity well; parameters are well supported.' })
  if (holes < 15) out.push({ severity: 'warn', title: `${holes} holes only`, detail: 'Directional variograms need ~30+ holes to be stable. Treat D1–D3 as indicative; rely on the downhole variogram for nugget and short-range structure.' })
  if (model.rmse !== undefined && model.totalSill > 0 && model.rmse / model.totalSill > 0.15) out.push({ severity: 'note', title: 'Fit residual is large', detail: 'The model misses the experimental points by > 15 % of the sill. Drag handles to fix the structure you trust most, or change a structure type.' })
  return out
}
