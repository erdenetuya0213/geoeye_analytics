import type { FieldLoggingDataset } from '@geoeye/types'
import type { LiveLoggingInput } from './live-structure.js'

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null
const omissionSignature = (value: unknown): string => JSON.stringify((Array.isArray(value) ? value : [])
  .map(rule => ({ field: String(object(rule).field), values: [...new Set(Array.isArray(object(rule).values) ? (object(rule).values as unknown[]).map(String) : [])].sort() }))
  .sort((a, b) => a.field.localeCompare(b.field)))

/** A recalculation adds a field to a shared template, but its values belong to one hole.
 * Choose the newest populated run separately for each hole; never fill its blanks
 * from an older run. Original composite geometry survives the image-row fragments.
 */
export function appendLatestRqd(dataset: FieldLoggingDataset, template: unknown, intervals: readonly LiveLoggingInput[]): void {
  const classes = object(template).classes
  if (!Array.isArray(classes)) return
  const fields = classes.flatMap(cls => Array.isArray(object(cls).fields) ? (object(cls).fields as unknown[]).map(object) : [])
    .filter(field => object(field.calculation).sourceFieldId === 'rqd_pct')
    .sort((a, b) => String(object(b.calculation).createdAt).localeCompare(String(object(a.calculation).createdAt))
      || Number(object(b.calculation).number) - Number(object(a.calculation).number))
  if (!fields.length) return
  const rows = intervals.filter(row => row.template_id === dataset.id)
  const key = 'derived:Latest RQD'
  dataset.columns.push({ key, label: 'Latest RQD per borehole', dataType: 'numeric', unit: '%' })
  dataset.columns.push({ key: 'derived:RQD run status', label: 'RQD run status', dataType: 'text', unit: null })
  const config = object(object(template).rqdComposite)
  dataset.composite = { intervalLength: numeric(config.intervalLengthM) ?? 3, startDepth: numeric(config.startDepthM) ?? 0,
    boundaryRules: [config.boundaryRule, config.secondaryBoundaryRule].filter((value): value is string => typeof value === 'string' && value !== 'none'), intervals: [] }
  for (const hole of new Set(rows.map(row => row.hole_id))) {
    const holeRows = rows.filter(row => row.hole_id === hole)
    const field = fields.find(field => holeRows.some(row => Object.hasOwn(object(row.selections_json), String(field.id))))
    if (!field) continue
    const rules = object(object(field.calculation).rules)
    const sameRule = ['boundaryRule', 'secondaryBoundaryRule', 'intervalLengthM', 'minimumPieceLengthMm', 'calculationSource', 'structureTemplateId']
      .every(key => config[key] === undefined || rules[key] === config[key])
      && (numeric(config.startDepthM) ?? 0) === (numeric(rules.startDepthM) ?? 0)
      && omissionSignature(config.omissionRules) === omissionSignature(rules.omissionRules)
      && (config.calculationSource === 'structures' || config.soundnessRule === undefined || config.soundnessRule === rules.soundnessRule)
    const omitted = Array.isArray(rules.omitted) ? rules.omitted.map(object) : []
    const seen = new Set<string>()
    for (const row of holeRows) {
      const values = object(row.selections_json)
      if (!Object.hasOwn(values, String(field.id))) continue
      const from = numeric(values._calculation_from) ?? numeric(row.depth_from)
      const to = numeric(values._calculation_to) ?? numeric(row.depth_to)
      if (from === null || to === null || to <= from) continue
      const id = `${dataset.id}:latest-rqd:${hole}:${values._calculation_run ?? row.id}`
      if (seen.has(id)) continue
      seen.add(id)
      const omittedLength = omitted.reduce((sum, zone) => sum + Math.max(0, Math.min(to, numeric(zone.to) ?? 0) - Math.max(from, numeric(zone.from) ?? 0)), 0)
      if (sameRule) dataset.composite.intervals.push({ holeId: hole, depthFrom: from, depthTo: to,
        ...(omittedLength > (to - from) / 2 ? { exclusionReason: 'Field RQD omission rule' } : {}) })
      dataset.records.push({ id, holeId: hole, depthFrom: from, depthTo: to,
        values: { [key]: sameRule ? numeric(values[String(field.id)]) : null,
          'derived:RQD source field': String(field.label), 'derived:RQD run status': sameRule ? 'Current' : 'Recalculate: Field rules changed' } })
    }
  }
}
