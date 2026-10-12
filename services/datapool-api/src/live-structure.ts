import type { FieldLoggingDataset } from '@geoeye/types'
import { deriveStructureCompositeExportRecords, structureCompositeExportColumns, STRUCTURE_TEXT_EXPORT_COLUMN_PATTERN } from './structure-calculations/structure-log-export.js'
import type { StructureSummaryObservation } from './structure-calculations/structure-log-summary.js'
import type { StructureRatingSystem } from './structure-calculations/structure-rating-systems.js'
import { withoutCoreLoss, isCoreLossDepth } from './structure-calculations/core-loss-ranges.js'

export interface LiveLoggingInput {
  id: string
  template_id: string
  hole_id: string
  class_id?: string
  depth_from: number | string | null
  depth_to: number | string | null
  selections_json: unknown
}
export interface LiveCoreRange {
  hole_id: string
  depth_from: number | string | null
  depth_to: number | string | null
  row_bbox_json?: unknown
  recovery_json?: unknown
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const number = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string' || typeof value === 'string' && value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function observation(row: LiveLoggingInput, dictionaryCodes: ReadonlyMap<string, string>): StructureSummaryObservation | null {
  const values = object(row.selections_json)
  const depthM = number(row.depth_from) ?? number(values.structure_depth_m)
  if (depthM === null) return null
  const code = (key: string): string | null => typeof values[key] === 'string'
    ? dictionaryCodes.get(values[key] as string) ?? (values[key] as string).replace(/^relog-unassigned:/, '') : null
  return {
    depthM, alphaDeg: number(values.alpha_to_core_axis_deg), structureType: code('discontinuity_type'),
    breakOrigin: code('break_origin'), jointShape: code('joint_shape'), roughness: code('roughness'),
    wallAlteration: code('jwa'), jointSetId: code('joint_set_id'), wallRockHardness: code('wall_rock_hardness'),
    jointContinuity: code('joint_continuity'), infillHardness: code('infill_hardness'), jrc: number(values.jrc),
    infillType: code('infill_type'), infillThicknessMm: number(values.infill_thickness_mm),
    apertureMm: number(values.aperture_mm), apertureBand: code('aperture_band'),
    persistenceM: number(values.persistence_m), persistenceBand: code('persistence_band'),
    l90Macro: code('l90_macro'), l90Micro: code('l90_micro'), l90Wall: code('l90_wall'),
    l90Filling: code('l90_filling'), l90Water: code('l90_water'), l90Weight: number(values.l90_condition_weight),
  }
}

interface Range { from: number; to: number }
interface Template { id: string; template_json: unknown }
function templateAliases(id: string, templates: readonly Template[]): Set<string> {
  const template = templates.find(item => item.id === id || object(item.template_json).id === id)
  return new Set([id, ...(template ? [template.id, String(object(template.template_json).id ?? template.id)] : [])])
}
function range(row: LiveCoreRange): Range | null {
  const from = number(row.depth_from), to = number(row.depth_to)
  return from !== null && to !== null && from >= 0 && to > from ? { from, to } : null
}
function mergeRanges(ranges: Range[]): Range[] {
  const merged: Range[] = []
  for (const item of ranges.sort((a, b) => a.from - b.from)) {
    const previous = merged.at(-1)
    if (previous && item.from <= previous.to) previous.to = Math.max(previous.to, item.to)
    else merged.push({ ...item })
  }
  return merged
}

/** Field's state matching joins split image-row records before comparing values. */
function boundaryRanges(rule: string, intervals: readonly LiveLoggingInput[], templates: readonly Template[]): Range[] {
  const [templateId, classId, fieldId] = rule.split('::')
  const aliases = templateAliases(templateId!, templates)
  const definition = object(templates.find(item => aliases.has(item.id))?.template_json)
  const classes = Array.isArray(definition.classes) ? definition.classes.map(object) : []
  const fields = classes.find(item => item.id === classId)?.fields
  if (!Array.isArray(fields)) return []
  const ids = fields.map(field => object(field).id).filter((id): id is string => typeof id === 'string' && !id.startsWith('_'))
  if (fieldId && !ids.includes(fieldId)) return []
  const candidates = intervals.filter(item => aliases.has(item.template_id) && item.class_id === classId
    && (!fieldId || String(object(item.selections_json)[fieldId] ?? '').trim()))
    .flatMap(item => { const span = range(item); return span ? [{ ...span, values: object(item.selections_json) }] : [] })
  const depths = [...new Set(candidates.flatMap(item => [item.from, item.to]))].sort((a, b) => a - b)
  const result: Array<Range & { state: string }> = []
  for (let index = 0; index < depths.length - 1; index++) {
    const from = depths[index]!, to = depths[index + 1]!
    const covering = candidates.filter(item => item.from <= from && item.to >= to)
    if (!covering.length) continue
    const values = (fieldId ? [fieldId] : ids).flatMap(id => {
      const values = [...new Set(covering.map(item => String(item.values[id] ?? '').trim()).filter(Boolean))].sort()
      return values.length ? [[id, values]] : []
    })
    const state = JSON.stringify(values.length ? values : covering.map(item => item.values._relog_record ?? `${item.from}:${item.to}`).sort())
    const previous = result.at(-1)
    if (previous?.to === from && previous.state === state) previous.to = to
    else result.push({ from, to, state })
  }
  return result
}

function fixedRanges(span: Range, length: number, start: number, boundaries: number[], losses: Range[]): Range[] {
  if (losses.length) return withoutCoreLoss({ from: Math.max(span.from, start), to: span.to }, losses)
    .flatMap(item => fixedRanges(item, length, item.from, boundaries, []))
  const result: Range[] = []
  let cursor = Math.max(span.from, start)
  while (cursor < span.to - 1e-7) {
    const planned = Math.min(span.to, cursor + length)
    const to = boundaries.find(depth => depth > cursor + 1e-7 && depth < planned - 1e-7) ?? planned
    result.push({ from: cursor, to })
    cursor = to
  }
  return result
}

/** Calculate the Field export's named columns from the current observations, per hole. */
export function appendLiveStructureCalculations(input: {
  dataset: FieldLoggingDataset
  template: unknown
  structures: readonly LiveLoggingInput[]
  intervals: readonly LiveLoggingInput[]
  coreRanges: readonly LiveCoreRange[]
  dictionaryCodes: ReadonlyMap<string, string>
  templates?: readonly Template[]
}): void {
  const { dataset, structures, intervals, coreRanges, dictionaryCodes } = input
  const template = object(input.template)
  const config = object(template.structureComposite)
  const classes = Array.isArray(template.classes) ? template.classes.map(object) : []
  const structural = classes.filter(item => Array.isArray(item.fields)
    && item.fields.some(field => object(field).id === 'structure_depth_m')
    && item.fields.some(field => object(field).id === 'discontinuity_type'))
  if (!structural.length || !Object.keys(config).length) return
  dataset.composite = { intervalLength: number(config.intervalLengthM) ?? 3, startDepth: number(config.startDepthM) ?? 0,
    boundaryRules: [config.boundaryRule, config.secondaryBoundaryRule].filter((value): value is string => typeof value === 'string' && value !== 'none'), intervals: [] }
  const systems = [...new Set(structural.flatMap(item => Array.isArray(item.structureRatingSystems)
    ? item.structureRatingSystems.filter((system): system is StructureRatingSystem => ['rmr76', 'rmr89', 'laubscher90', 'q'].includes(String(system))) : []))]
  const labels = structureCompositeExportColumns(systems)
  const columns = labels.map(label => ({
    key: `derived:${label}`, label, dataType: STRUCTURE_TEXT_EXPORT_COLUMN_PATTERN.test(label) ? 'text' as const : 'numeric' as const,
    unit: /spacing/i.test(label) && !/score/i.test(label) ? 'm' : /frequency/i.test(label) ? '1/m'
      : /(?:thickness|aperture) median/i.test(label) ? 'mm' : null,
  }))
  dataset.columns.push(...columns.filter(column => !dataset.columns.some(existing => existing.key === column.key)))
  const omissionRules = Array.isArray(config.omissionRules) ? config.omissionRules.map(object) : []
  const holes = new Set(structures.filter(row => row.template_id === dataset.id).map(row => row.hole_id))
  for (const hole of holes) {
    const holeRows = coreRanges.filter(row => row.hole_id === hole)
    const losses = mergeRanges(holeRows.flatMap(row => {
      const registered = object(row.row_bbox_json).coreLossIntervals
      const recovery = object(row.recovery_json).lossIntervalsM
      const raw = Array.isArray(registered) ? registered : Array.isArray(recovery) ? recovery : []
      return raw.flatMap(value => {
        const item = object(value)
        const from = number(item.depthFrom ?? item.fromM), to = number(item.depthTo ?? item.toM)
        return from !== null && to !== null && to > from ? [{ from, to }] : []
      })
    }))
    const observations = structures.filter(row => row.template_id === dataset.id && row.hole_id === hole
      && (row.class_id === undefined || structural.some(item => item.id === row.class_id)))
      .flatMap(row => { const value = observation(row, dictionaryCodes); return value === null || isCoreLossDepth(value.depthM, losses) ? [] : [value] })
    const rows = holeRows.flatMap(row => { const value = range(row); return value === null ? [] : [value] })
    if (!rows.length) continue // Do not invent assessed length from the first/last fracture.
    const from = Math.min(...rows.map(row => row.from)), to = Math.max(...rows.map(row => row.to))
    const rules = [config.boundaryRule, config.secondaryBoundaryRule].filter((rule): rule is string => typeof rule === 'string' && rule !== '' && rule !== 'none')
    const holeIntervals = intervals.filter(row => row.hole_id === hole)
    const templates = input.templates ?? [{ id: dataset.id, template_json: template }]
    const explicit = rules.filter(rule => rule.includes('::'))
    const matched = explicit.length ? boundaryRanges(explicit[0]!, holeIntervals, templates) : undefined
    // Current Field recalculation refuses a missing selected boundary. Do not
    // manufacture derived values using image-row boundaries instead.
    if (matched && !matched.length) continue
    const boundaries = [...new Set(explicit.flatMap(rule => boundaryRanges(rule, holeIntervals, templates).flatMap(item => [item.from, item.to])))].sort((a, b) => a - b)
    for (const rule of rules.filter(rule => !rule.includes('::'))) {
      const pattern = rule === 'lithology' ? /litholog|rock type|lith1|lith_code/i
        : rule === 'alteration' ? /alteration|altered|\balt1\b/i : /geotech_gsi_integrity|core[_ ]integrity|gsi_integrity/i
      const classes = templates.flatMap(item => {
        const raw = object(item.template_json).classes
        return Array.isArray(raw) ? raw.map(object).filter(cls => pattern.test(`${cls.id} ${cls.label} ${JSON.stringify(cls.fields)}`)).map(cls => ({ template: item.id, id: cls.id })) : []
      })
      let previous = ''
      for (const item of holeIntervals.filter(row => classes.some(cls => cls.template === row.template_id && cls.id === row.class_id))
        .sort((a, b) => (number(a.depth_from) ?? 0) - (number(b.depth_from) ?? 0))) {
        const state = Object.entries(object(item.selections_json)).find(([key, value]) => !key.startsWith('_') && value)?.[1]
        const value = String(state ?? item.class_id)
        const depth = number(item.depth_from)
        if ((!previous || previous !== value) && depth !== null) boundaries.push(depth)
        previous = value
      }
    }
    boundaries.sort((a, b) => a - b)
    let ranges: Range[]
    if (config.rule === 'fixed') {
      const length = number(config.intervalLengthM) ?? 1, start = number(config.startDepthM) ?? from
      if (length <= 0 || start < 0 || (to - start) / length > 100_000) continue
      ranges = (matched ?? [{ from, to }]).flatMap(span => fixedRanges(span, Math.max(0.1, length), start, boundaries, losses))
    } else if (config.rule === 'match_class' && typeof config.matchClassId === 'string') {
      ranges = intervals.filter(row => row.hole_id === hole && row.class_id === config.matchClassId)
        .flatMap(row => { const value = range(row); return value === null ? [] : [value] })
    } else {
      ranges = matched ?? rows
    }
    if (!ranges.length) continue
    ranges = ranges.flatMap(item => withoutCoreLoss(item, losses))
    ranges = [...new Map(ranges.map(item => [`${item.from}:${item.to}`, item])).values()]
    const omitted = mergeRanges(omissionRules.flatMap(rule => {
      if (typeof rule.field !== 'string' || !Array.isArray(rule.values)) return []
      const [templateId, classId, fieldId] = rule.field.split('::')
      if (!templateId || !classId || !fieldId) return []
      const aliases = templateAliases(templateId, templates)
      return intervals.filter(row => row.hole_id === hole && aliases.has(row.template_id) && row.class_id === classId
        && (rule.values as unknown[]).includes(object(row.selections_json)[fieldId]))
        .flatMap(row => { const value = range(row); return value === null ? [] : [value] })
    }))
    dataset.composite.intervals.push(...ranges.map(item => ({ holeId: hole, depthFrom: item.from, depthTo: item.to,
      ...(omitted.reduce((sum, zone) => sum + Math.max(0, Math.min(item.to, zone.to) - Math.max(item.from, zone.from)), 0) > (item.to - item.from) / 2
        ? { exclusionReason: 'Field structure omission rule' } : {}) })))
    const calculated = deriveStructureCompositeExportRecords({
      ratingSystems: systems, populationMode: config.populationMode === 'adverse_median' ? 'adverse_median' : 'mode',
      composites: ranges.map(item => ({
        depthFromM: item.from, depthToM: item.to,
        observations: observations.filter(value => value.depthM >= item.from && (value.depthM < item.to || item.to === to && value.depthM === to)),
        nonRmr: omitted.reduce((sum, zone) => sum + Math.max(0, Math.min(item.to, zone.to) - Math.max(item.from, zone.from)), 0) > (item.to - item.from) / 2,
      })),
    })
    for (const item of calculated) dataset.records.push({
      id: `${dataset.id}:derived:${hole}:${item.depthFromM}:${item.depthToM}`,
      holeId: hole, depthFrom: item.depthFromM, depthTo: item.depthToM,
      values: Object.fromEntries(columns.flatMap(column => {
        const raw = item.values[column.label]
        return raw === undefined || raw === '' ? [] : [[column.key, column.dataType === 'numeric' ? number(raw) : raw]]
      })),
    })
  }
}
