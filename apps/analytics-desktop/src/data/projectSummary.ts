import type { FieldLoggingOverview } from '@geoeye/datapool-client'
import type { ClassTable } from './classTables.js'
import { databaseRows } from './databaseRows.js'
import { effectiveDrillholes, type LocalDrillholeDraft, type LocalProjectSnapshot, type LocalTabularDraft } from './localProjectDb.js'

export interface SummaryRow { name: string; note?: string; value: string }
export interface SummaryGroup { label: string; rows: SummaryRow[] }

interface Interval { depthFrom: number | null; depthTo: number | null; holeId: string | null }

const count = (value: number) => value.toLocaleString('en-US')

/** Overlapping rows of one template in one hole are logged once. */
export function loggedMetres(intervals: readonly Interval[]): number {
  const byHole = new Map<string, [number, number][]>()
  for (const { depthFrom, depthTo, holeId } of intervals) {
    if (depthFrom === null || depthTo === null || depthTo <= depthFrom) continue
    const hole = byHole.get(holeId ?? '') ?? []
    hole.push([depthFrom, depthTo])
    byHole.set(holeId ?? '', hole)
  }
  let total = 0
  for (const spans of byHole.values()) {
    let [from, to] = spans.sort((left, right) => left[0] - right[0])[0]!
    for (const [start, end] of spans) {
      if (start > to) { total += to - from; from = start; to = end } else if (end > to) to = end
    }
    total += to - from
  }
  return total
}

export function loggingTemplates(overview: FieldLoggingOverview | null): { fields: number; metres: number; name: string }[] {
  const datasets = overview?.datasets ?? []
  const submissions = overview?.submissions ?? []
  const names = [...new Set([...(overview?.templates ?? []).map(template => template.name), ...datasets.map(dataset => dataset.name)])]
  return names.map(name => {
    const dataset = datasets.find(item => item.name === name)
    return {
      fields: dataset?.columns.length ?? 0,
      metres: loggedMetres(dataset?.records ?? submissions.filter(item => item.templateName === name)),
      name,
    }
  })
}

/** Numbers only: what this project holds, in the order the data is collected. */
export function projectSummaryGroups(input: {
  drillholeDraft: LocalDrillholeDraft | null
  lab: readonly ClassTable[]
  snapshot: LocalProjectSnapshot | null
  strength: readonly ClassTable[]
  xrfDraft?: LocalTabularDraft | undefined
}): SummaryGroup[] {
  const holes = effectiveDrillholes(input.snapshot, input.drillholeDraft)
  const classRows = (tables: readonly ClassTable[], empty: string): SummaryRow[] => tables.length === 0
    ? [{ name: empty, value: '0' }]
    : tables.map(table => ({ name: table.name, value: count(table.rows.length) }))
  const logging = loggingTemplates(input.snapshot?.fieldLogging ?? null)
  return [
    { label: 'Holes', rows: [
      { name: 'Holes', value: count(holes.length) },
      { name: 'Collar', value: count(holes.filter(hole => hole.collar !== null).length) },
      { name: 'Surveyed', value: count(holes.filter(hole => hole.surveyStationCount > 0).length) },
    ] },
    { label: 'Logging', rows: logging.length === 0
      ? [{ name: 'Templates', value: '0' }]
      : logging.map(template => ({ name: template.name, note: `${count(template.fields)} fields`, value: `${count(Math.round(template.metres))} m` })) },
    { label: 'Lab', rows: classRows(input.lab, 'Classes') },
    { label: 'Strength', rows: classRows(input.strength, 'Tests') },
    { label: 'XRF', rows: [{ name: 'Measurements', value: count(input.xrfDraft?.rows.length ?? databaseRows('xrf', input.snapshot, input.drillholeDraft).rows.length) }] },
  ]
}
