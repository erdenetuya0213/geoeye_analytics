import type { VariogramModel } from '../analysis/engineClient.js'
import { practicalRange } from '../analysis/variogramModel.js'

export const csv = (header: string[], rows: Array<Array<string | number | null | undefined>>) =>
  [header, ...rows].map((r) => r.map((v) => v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n') + '\n'

export interface AxisDirection { label: string; azimuth: number; dip: number }

export interface VariogramExportInput {
  variable: string; transform: string; datasetName: string; runId: string
  strike: number; dip: number; plunge: number
  directions: AxisDirection[]
  model: VariogramModel
  hMax: number
}

/**
 * Package-neutral export. The axis table (bearing/plunge of D1–D3 with per-structure ranges) is what every
 * estimator accepts; GSLIB and Leapfrog angle sets are derived from strike/dip/plunge. Datamine/Vulcan users
 * enter the axis table directly (their ZXZ/ZXY angle sets are package-specific and verified in the package).
 */
export function variogramExports(i: VariogramExportInput) {
  const r = (v: number) => Math.round(v * 100) / 100
  const axes = i.directions.slice(0, 3)
  const practical = axes.map((_, k) => Math.round(practicalRange(i.model, k, i.hMax * 3)))
  const json = JSON.stringify({ ...i, practicalRanges: practical, exportedAt: new Date().toISOString() }, null, 2)

  const axisTable = csv(['axis', 'bearing_deg', 'plunge_deg', ...i.model.structures.map((_, s) => `range_s${s + 1}_m`), 'practical_range_95_m'],
    axes.map((d, k) => [d.label, r(d.azimuth), r(d.dip), ...i.model.structures.map((s) => r(s.ranges[k] ?? 0)), practical[k] ?? 0]))

  const structures = csv(['structure', 'type', 'sill', 'sill_fraction', 'range_D1_m', 'range_D2_m', 'range_D3_m'],
    [['nugget', 'nugget', r(i.model.nugget), r(i.model.nugget / i.model.totalSill), 0, 0, 0],
      ...i.model.structures.map((s, k) => [`s${k + 1}`, s.type, r(s.sill), r(s.sill / i.model.totalSill), r(s.ranges[0] ?? 0), r(s.ranges[1] ?? 0), r(s.ranges[2] ?? 0)])])

  // GSLIB: ang1 = azimuth of major axis (clockwise from Y), ang2 = -dip of major axis, ang3 = rotation about major axis.
  const gslib = [
    `# GSLIB variogram model · ${i.variable} (${i.transform}) · ${i.datasetName} · run ${i.runId}`,
    `${i.model.structures.length}  ${r(i.model.nugget)}        -nst, nugget effect`,
    ...i.model.structures.map((s) => `${s.type === 'spherical' ? 1 : s.type === 'exponential' ? 2 : 3}  ${r(s.sill)}  ${r(i.strike)}  ${r(-i.plunge)}  ${r(i.dip)}   -it, cc, ang1, ang2, ang3\n       ${r(s.ranges[0] ?? 0)}  ${r(s.ranges[1] ?? 0)}  ${r(s.ranges[2] ?? 0)}   -a_hmax, a_hmin, a_vert`),
    '',
  ].join('\n')

  // Leapfrog: dip, dip azimuth, pitch of the ellipsoid.
  const leapfrog = csv(['dip', 'dip_azimuth', 'pitch', 'nugget', ...i.model.structures.flatMap((_, s) => [`s${s + 1}_type`, `s${s + 1}_sill`, `s${s + 1}_major`, `s${s + 1}_semi`, `s${s + 1}_minor`])],
    [[r(i.dip), r((i.strike + 90) % 360), r(i.plunge), r(i.model.nugget), ...i.model.structures.flatMap((s) => [s.type, r(s.sill), r(s.ranges[0] ?? 0), r(s.ranges[1] ?? 0), r(s.ranges[2] ?? 0)])]])

  return { json, axisTable, structures, gslib, leapfrog }
}
