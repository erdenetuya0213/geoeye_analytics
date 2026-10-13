import type { EdaDataset, EdaObservation } from '../data/edaTypes.js'

export interface CompletenessCell { holeId: string; variableKey: string; populated: number; total: number }
export interface IntervalIssue { holeId: string; kind: 'gap' | 'overlap' | 'inverted'; from: number; to: number; length: number }
export interface RecoveryIssue { observationId: string; holeId: string; depthFrom: number; depthTo: number; rqd: number | null; scr: number | null; tcr: number | null; rule: string }
export interface SupportRow { group: string; metres: number; intervals: number; tests: Record<string, number> }

/** % populated per hole × variable — whole-campaign blanks jump out. */
export function completeness(dataset: EdaDataset): { holes: string[]; variables: string[]; cells: CompletenessCell[] } {
  const variables = dataset.variables.map((v) => v.key)
  const byHole = new Map<string, EdaObservation[]>()
  for (const o of dataset.observations) (byHole.get(o.holeId) ?? byHole.set(o.holeId, []).get(o.holeId))?.push(o)
  const holes = [...byHole.keys()].sort()
  const cells = holes.flatMap((holeId) => { const rows = byHole.get(holeId) ?? []; return variables.map((variableKey) => ({ holeId, variableKey, total: rows.length, populated: rows.filter((o) => { const v = o.values[variableKey]; return v !== null && v !== undefined && Number.isFinite(v) }).length })) })
  return { holes, variables, cells }
}

/** Gaps, overlaps and from ≥ to, per hole, tolerance in metres. */
export function intervalIssues(dataset: EdaDataset, tolerance = 0.01): IntervalIssue[] {
  const byHole = new Map<string, EdaObservation[]>()
  for (const o of dataset.observations) (byHole.get(o.holeId) ?? byHole.set(o.holeId, []).get(o.holeId))?.push(o)
  const issues: IntervalIssue[] = []
  for (const [holeId, rows] of byHole) {
    rows.sort((a, b) => a.depthFrom - b.depthFrom || a.depthTo - b.depthTo)
    let previousTo: number | null = null
    for (const o of rows) {
      if (o.depthFrom >= o.depthTo) issues.push({ holeId, kind: 'inverted', from: o.depthFrom, to: o.depthTo, length: o.depthTo - o.depthFrom })
      if (previousTo !== null) {
        if (o.depthFrom - previousTo > tolerance) issues.push({ holeId, kind: 'gap', from: previousTo, to: o.depthFrom, length: o.depthFrom - previousTo })
        else if (previousTo - o.depthFrom > tolerance) issues.push({ holeId, kind: 'overlap', from: o.depthFrom, to: Math.min(previousTo, o.depthTo), length: previousTo - o.depthFrom })
      }
      previousTo = Math.max(previousTo ?? -Infinity, o.depthTo)
    }
  }
  return issues
}

/** RQD ≤ SCR ≤ TCR ≤ 100. Keys are resolved by the caller (names vary by template). */
export function recoveryLogic(dataset: EdaDataset, keys: { rqd?: string | undefined; scr?: string | undefined; tcr?: string | undefined }): RecoveryIssue[] {
  const get = (o: EdaObservation, key?: string) => { if (!key) return null; const v = o.values[key]; return v === null || v === undefined || !Number.isFinite(v) ? null : v }
  const out: RecoveryIssue[] = []
  for (const o of dataset.observations) {
    const rqd = get(o, keys.rqd), scr = get(o, keys.scr), tcr = get(o, keys.tcr)
    const rules: string[] = []
    for (const [label, v] of [['RQD', rqd], ['SCR', scr], ['TCR', tcr]] as const) if (v !== null && (v < 0 || v > 100)) rules.push(`${label} outside 0–100`)
    if (rqd !== null && scr !== null && rqd > scr + 0.5) rules.push('RQD > SCR')
    if (scr !== null && tcr !== null && scr > tcr + 0.5) rules.push('SCR > TCR')
    if (rqd !== null && tcr !== null && rqd > tcr + 0.5) rules.push('RQD > TCR')
    if (rules.length > 0) out.push({ observationId: o.id, holeId: o.holeId, depthFrom: o.depthFrom, depthTo: o.depthTo, rqd, scr, tcr, rule: rules.join(' · ') })
  }
  return out
}

/** Metres, interval count and non-null test counts per group (lithology or any dimension). */
export function dataSupport(dataset: EdaDataset, groupKey: string | null, testKeys: string[]): SupportRow[] {
  const rows = new Map<string, SupportRow>()
  for (const o of dataset.observations) {
    const group = groupKey === null ? 'All' : (groupKey === 'lithology' ? o.lithology : o.dimensions[groupKey]) || 'Unassigned'
    const row = rows.get(group) ?? rows.set(group, { group, metres: 0, intervals: 0, tests: Object.fromEntries(testKeys.map((k) => [k, 0])) }).get(group)!
    row.metres += Math.max(0, o.depthTo - o.depthFrom); row.intervals += 1
    for (const k of testKeys) { const v = o.values[k]; if (v !== null && v !== undefined && Number.isFinite(v)) row.tests[k] = (row.tests[k] ?? 0) + 1 }
  }
  return [...rows.values()].sort((a, b) => b.metres - a.metres)
}

/** Guess RQD/SCR/TCR keys from variable keys or labels. */
export function guessRecoveryKeys(dataset: EdaDataset): { rqd?: string; scr?: string; tcr?: string } {
  const find = (re: RegExp) => dataset.variables.find((v) => re.test(v.key) || re.test(v.label) || re.test(v.shortLabel))?.key
  const out: { rqd?: string; scr?: string; tcr?: string } = {}
  const rqd = find(/\brqd\b/i), scr = find(/\bscr\b|solid core/i), tcr = find(/\btcr\b|total core|recovery/i)
  if (rqd) out.rqd = rqd; if (scr) out.scr = scr; if (tcr) out.tcr = tcr
  return out
}
