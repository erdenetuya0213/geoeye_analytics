import { buildAnalyticalObservations, type AnalyticalObservation } from './analyticalDataset.js'
import type { EdaObservation } from './eda.js'
import type { EdaDataset } from '../data/edaTypes.js'
import { MINERAL_COMPONENTS, MINERAL_CRITERIA, MINERAL_RULE_VERSION, MINERAL_SYSTEM_MODELS, type MineralComponent, type MineralSystemModel } from './mineralSystemModels.js'

const CRITERIA_BY_ID = new Map(MINERAL_CRITERIA.map(criterion => [criterion.id, criterion]))

export interface EvidenceBinding {
  id: string
  criterionId: string
  datasetId: string
  fieldKey: string
  operator: 'gte' | 'lte' | 'contains' | 'equals'
  threshold: number
  unit: 'ppm' | 'native'
  terms: string[]
  polarity: 'support' | 'contradict'
  reliability: number
  /** Optional acquisition / identification quality gate, expressed in that field's native units. */
  qualityFieldKey?: string
  minimumQuality?: number
}
export interface MineralAssessmentConfiguration {
  baseDatasetId: string
  bindings: EvidenceBinding[]
  /** A spatially linked subset of base supports, never the attached source IDs. */
  baseObservationIds?: string[]
}
export interface EvidenceMatch {
  criterionId: string
  bindingId: string
  datasetId: string
  fieldKey: string
  value: number | string
  comparedValue: number | string
  polarity: EvidenceBinding['polarity']
  reliability: number
  sourceObservationIds: string[]
  quality?: { fieldKey: string; value: number; minimum: number }
}
export interface EvidenceSummary {
  criterionId: string
  state: 'supports' | 'contradicts' | 'conflicting' | 'not-observed'
  support: number
  contradiction: number
  sourceObservationIds: string[]
  datasetIds: string[]
  matchCount: number
}
export interface MineralSystemAssessment {
  systemId: string
  label: string
  fit: number | null
  coverage: number
  reliability: number
  components: Record<MineralComponent, number>
  contributions: Array<{ criterionId: string; weight: number; signed: number; state: EvidenceSummary['state'] }>
}
export interface MineralAssessmentInterval {
  observationId: string
  holeId: string
  depthFrom: number
  depthTo: number
  sourceObservationIds: string[]
  matches: EvidenceMatch[]
}
export interface MineralAssessmentRun {
  version: 1
  ruleVersion: string
  runId: string
  createdAt: string
  baseDatasetId: string
  configuration: MineralAssessmentConfiguration
  snapshots: Array<{ datasetId: string; snapshotAt: string; name: string }>
  evidence: EvidenceSummary[]
  systems: MineralSystemAssessment[]
  intervals: MineralAssessmentInterval[]
  issues: string[]
  inputCount: number
  excludedLocationCount: number
}

function fieldKey(datasetId: string, key: string) { return `${datasetId}::${key}` }
function namespaced(dataset: EdaDataset): EdaObservation[] {
  return dataset.observations.map(row => ({
    ...row,
    values: Object.fromEntries(Object.entries(row.values).map(([key, value]) => [fieldKey(dataset.id, key), value])),
    dimensions: Object.fromEntries(Object.entries(row.dimensions).map(([key, value]) => [fieldKey(dataset.id, key), value])),
  }))
}
export function concentrationFactor(unit: string): number | null {
  switch (unit.toLowerCase().replace(/\s+/g, '')) {
    case 'ppm': case 'mg/kg': case 'g/t': case 'gpt': return 1
    case '%': case 'wt%': case 'wt.%': return 10_000
    case 'ppb': case 'ug/kg': case 'µg/kg': return 0.001
    default: return null
  }
}
function validSupport(row: EdaObservation) {
  return row.locationValid !== false && row.holeId.trim().length > 0 && row.holeId !== 'Project'
    && Number.isFinite(row.depthFrom) && Number.isFinite(row.depthTo) && row.depthFrom >= 0 && row.depthTo >= row.depthFrom
}

export function suggestEvidenceBindings(datasets: readonly EdaDataset[]): EvidenceBinding[] {
  return datasets.flatMap(dataset => {
    const fields = new Map([...dataset.dimensions.map(d => [d.key, d.label] as const), ...dataset.variables.filter(v => v.dataType === 'category').map(v => [v.key, v.label] as const)])
    const categoryValues = new Map([...fields].filter(([key, label]) => /mineral|alteration|litholog|rock.?type|texture|structure|fluid|preserv|geometry|host/i.test(`${key} ${label}`))
      .map(([key]) => [key, new Set<string>()] as const))
    dataset.observations.forEach(row => categoryValues.forEach((values, key) => { const value = row.dimensions[key]; if (value !== undefined) values.add(value) }))
    return MINERAL_CRITERIA.flatMap((criterion): EvidenceBinding[] => {
    if (criterion.element !== undefined) {
      // Portable XRF cannot be assumed to quantify these elements reliably.
      if (/xrf/i.test(`${dataset.id} ${dataset.name} ${dataset.producer}`) && ['Au', 'Pt', 'Li'].includes(criterion.element)) return []
      const element = criterion.element.toLowerCase()
      return dataset.variables.filter(variable => variable.dataType !== 'category' && concentrationFactor(variable.unit) !== null
        && `${variable.key} ${variable.label}`.toLowerCase().split(/[^a-z]+/).includes(element)).map(variable => ({
          id: `${criterion.id}:${dataset.id}:${variable.key}`, criterionId: criterion.id, datasetId: dataset.id, fieldKey: variable.key,
          operator: 'gte' as const, threshold: criterion.threshold ?? 0, unit: 'ppm' as const, terms: [], polarity: 'support' as const,
          reliability: /xrf/i.test(`${dataset.id} ${dataset.name} ${dataset.producer}`) ? 0.65 : 0.9,
        }))
    }
    return [...categoryValues].filter(([, values]) => [...values].some(value => textMatches(value, criterion.tokens ?? [], 'contains')))
      .map(([key]) => ({
        id: `${criterion.id}:${dataset.id}:${key}`, criterionId: criterion.id, datasetId: dataset.id, fieldKey: key,
        operator: 'contains' as const, threshold: 0, unit: 'native' as const, terms: [...criterion.tokens ?? []], polarity: 'support' as const,
        reliability: /spectral/i.test(`${dataset.id} ${dataset.name} ${dataset.producer}`) ? 0.75 : 0.7,
      }))
    })
  })
}

/** Literal phrases with word boundaries. A negated or uncertain label does not establish a mineral. */
function textMatches(value: string, terms: readonly string[], operator: 'contains' | 'equals') {
  const normalized = value.trim().toLowerCase()
  if (operator === 'equals') return terms.some(term => normalized === term.trim().toLowerCase() && term.trim().length > 0)
  if (/\b(no|not|absent|without|possible|possibly|uncertain|trace of)\b|\?/.test(normalized)) return false
  return terms.some(term => {
    const phrase = term.trim().toLowerCase()
    if (!phrase) return false
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, 'i').test(normalized)
  })
}

function aggregate(matches: readonly EvidenceMatch[], criterionIds?: readonly string[]): EvidenceSummary[] {
  const grouped = new Map<string, EvidenceMatch[]>()
  matches.forEach(match => { const group = grouped.get(match.criterionId) ?? []; group.push(match); grouped.set(match.criterionId, group) })
  const criteria = criterionIds === undefined ? MINERAL_CRITERIA : criterionIds.map(id => CRITERIA_BY_ID.get(id)!)
  return criteria.map(criterion => {
    const group = grouped.get(criterion.id) ?? []
    let support = 0, contradiction = 0
    group.forEach(m => { if (m.polarity === 'support') support = Math.max(support, m.reliability); else contradiction = Math.max(contradiction, m.reliability) })
    return { criterionId: criterion.id, support, contradiction,
      state: support > 0 && contradiction > 0 ? 'conflicting' : support > 0 ? 'supports' : contradiction > 0 ? 'contradicts' : 'not-observed',
      sourceObservationIds: [...new Set(group.flatMap(m => m.sourceObservationIds))], datasetIds: [...new Set(group.map(m => m.datasetId))], matchCount: group.length,
    }
  })
}

export function assessMineralModel(model: MineralSystemModel, evidence: readonly EvidenceSummary[]): MineralSystemAssessment {
  const byId = new Map(evidence.map(e => [e.criterionId, e]))
  const components = Object.fromEntries(MINERAL_COMPONENTS.map(c => [c, 0])) as Record<MineralComponent, number>
  const groups = new Map<string, { cap: number; support: number; contradiction: number }>()
  let observed = 0, totalReliability = 0
  const contributions = model.criteria.map(item => {
    const criterion = CRITERIA_BY_ID.get(item.id)!
    const summary = byId.get(item.id)
    const support = summary?.support ?? 0, contradiction = summary?.contradiction ?? 0
    if (support > 0 || contradiction > 0) observed += 1
    totalReliability += Math.max(support, contradiction)
    const key = `${criterion.component}:${criterion.group}`
    const group = groups.get(key) ?? { cap: 0, support: 0, contradiction: 0 }
    group.cap = Math.max(group.cap, item.weight)
    group.support += item.weight * support
    group.contradiction += item.weight * contradiction
    groups.set(key, group)
    return { criterionId: item.id, weight: item.weight, signed: item.weight * (support - contradiction), state: summary?.state ?? 'not-observed' as const }
  })
  let net = 0, capacity = 0
  groups.forEach(group => { net += Math.min(group.cap, group.support) - Math.min(group.cap, group.contradiction); capacity += group.cap })
  MINERAL_COMPONENTS.forEach(component => {
    const criteria = model.criteria.filter(item => CRITERIA_BY_ID.get(item.id)!.component === component)
    components[component] = criteria.length === 0 ? 0 : criteria.reduce((sum, item) => {
      const summary = byId.get(item.id); return sum + Math.max(summary?.support ?? 0, summary?.contradiction ?? 0)
    }, 0) / criteria.length * 100
  })
  return { systemId: model.id, label: model.label, fit: observed === 0 ? null : Math.max(0, Math.min(100, net / capacity * 100)),
    coverage: observed / model.criteria.length * 100, reliability: observed === 0 ? 0 : totalReliability / observed * 100, components, contributions }
}

export function runMineralAssessment(datasets: readonly EdaDataset[], configuration: MineralAssessmentConfiguration, runId: string = crypto.randomUUID(), createdAt = new Date().toISOString()): MineralAssessmentRun {
  const base = datasets.find(d => d.id === configuration.baseDatasetId)
  if (!base) throw new Error('Choose an available interval dataset for mineral-system assessment.')
  const issues = new Set<string>()
  const bindings = configuration.bindings.filter(binding => {
    const dataset = datasets.find(d => d.id === binding.datasetId)
    const knownCriterion = MINERAL_CRITERIA.some(c => c.id === binding.criterionId)
    const field = dataset?.variables.find(v => v.key === binding.fieldKey)
    const categorical = binding.operator === 'contains' || binding.operator === 'equals'
    const qualityField = binding.qualityFieldKey ? dataset?.variables.find(variable => variable.key === binding.qualityFieldKey) : undefined
    const validQuality = !binding.qualityFieldKey || (qualityField !== undefined && qualityField.dataType !== 'category' && Number.isFinite(binding.minimumQuality))
    const valid = knownCriterion && dataset !== undefined && Number.isFinite(binding.reliability) && binding.reliability > 0 && binding.reliability <= 1
      && validQuality
      && (categorical ? binding.terms.some(t => t.trim().length > 0) && (dataset.dimensions.some(d => d.key === binding.fieldKey) || field?.dataType === 'category')
        : field !== undefined && field.dataType !== 'category' && Number.isFinite(binding.threshold) && (binding.unit === 'native' || concentrationFactor(field.unit) !== null))
    if (!valid) issues.add(`Skipped invalid mapping: ${binding.criterionId} / ${binding.datasetId} / ${binding.fieldKey}. Check the field, unit, predicate, and reliability.`)
    return valid
  })
  const boundDatasetIds = new Set(bindings.map(b => b.datasetId))
  const inputs = datasets.filter(d => boundDatasetIds.has(d.id) || d.id === base.id)
  const selected = configuration.baseObservationIds === undefined ? null : new Set(configuration.baseObservationIds)
  const baseRows = namespaced(base).filter(row => selected === null || selected.has(row.id))
  const located = baseRows.filter(validSupport)
  if (located.length < baseRows.length) issues.add(`${baseRows.length - located.length} base rows excluded because drillhole / depth support is invalid.`)
  if (bindings.length === 0) issues.add('No valid evidence mappings. Configure fields and predicates before interpreting rankings.')
  const attachments = inputs.filter(d => d.id !== base.id).map(d => {
    const observations = namespaced(d)
    return { datasetId: d.id, observations, match: 'point-or-interval' as const, dimensions: [...new Set(observations.flatMap(row => Object.keys(row.dimensions)))] }
  })
  const integrated = buildAnalyticalObservations(base.id, located, attachments)
  const preparedBindings = bindings.map(binding => ({ ...binding, key: fieldKey(binding.datasetId, binding.fieldKey),
    factor: binding.unit === 'ppm' ? concentrationFactor(inputs.find(d => d.id === binding.datasetId)!.variables.find(v => v.key === binding.fieldKey)!.unit)! : 1 }))
  const intervals = integrated.map((row: AnalyticalObservation, index): MineralAssessmentInterval => {
    const matches = preparedBindings.flatMap((binding): EvidenceMatch[] => {
      const qualityValue = binding.qualityFieldKey ? row.values[fieldKey(binding.datasetId, binding.qualityFieldKey)] : undefined
      if (binding.qualityFieldKey && (qualityValue == null || !Number.isFinite(qualityValue) || qualityValue < binding.minimumQuality!)) return []
      const value = binding.operator === 'contains' || binding.operator === 'equals' ? row.dimensions[binding.key] : row.values[binding.key]
      if (value === undefined || value === null || (typeof value === 'number' && (!Number.isFinite(value) || value < 0))) return []
      const comparedValue = typeof value === 'number' ? value * binding.factor : value
      const matched = binding.operator === 'contains' || binding.operator === 'equals'
        ? typeof comparedValue === 'string' && textMatches(comparedValue, binding.terms, binding.operator)
        : typeof comparedValue === 'number' && (binding.operator === 'gte' ? comparedValue >= binding.threshold : comparedValue <= binding.threshold)
      if (!matched) return []
      const sourceObservationIds = [...new Set(row.analyticalLineage.filter(l => l.datasetId === binding.datasetId).map(l => l.sourceObservationId))]
      return [{ criterionId: binding.criterionId, bindingId: binding.id, datasetId: binding.datasetId, fieldKey: binding.fieldKey, value, comparedValue,
        polarity: binding.polarity, reliability: binding.reliability, sourceObservationIds,
        ...(binding.qualityFieldKey && qualityValue != null ? { quality: { fieldKey: binding.qualityFieldKey, value: qualityValue, minimum: binding.minimumQuality! } } : {}) }]
    })
    return { observationId: located[index]!.id, holeId: row.holeId, depthFrom: row.depthFrom, depthTo: row.depthTo,
      sourceObservationIds: [...new Set([...(located[index]!.sourceObservationIds ?? [located[index]!.sourceObservationId]), ...matches.flatMap(m => m.sourceObservationIds)])], matches }
  })
  const evidence = aggregate(intervals.flatMap(row => row.matches))
  const systems = MINERAL_SYSTEM_MODELS.map(model => assessMineralModel(model, evidence)).sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || b.coverage - a.coverage || a.systemId.localeCompare(b.systemId))
  const matchedIds = new Set(intervals.flatMap(row => row.matches.map(m => m.bindingId)))
  bindings.filter(b => !matchedIds.has(b.id)).forEach(b => issues.add(`No qualifying linked observations: ${b.criterionId} / ${b.datasetId} / ${b.fieldKey}. This is not evidence of absence.`))
  return { version: 1, ruleVersion: MINERAL_RULE_VERSION, runId, createdAt, baseDatasetId: base.id, configuration: structuredClone(configuration),
    snapshots: inputs.map(d => ({ datasetId: d.id, snapshotAt: d.snapshotAt, name: d.name })), evidence, systems, intervals, issues: [...issues],
    inputCount: baseRows.length, excludedLocationCount: baseRows.length - located.length }
}

export function assessmentIsCurrent(run: MineralAssessmentRun, datasets: readonly EdaDataset[]) {
  return run.ruleVersion === MINERAL_RULE_VERSION && run.snapshots.every(snapshot => datasets.some(d => d.id === snapshot.datasetId && d.snapshotAt === snapshot.snapshotAt))
}

export function investigationPriorities(run: MineralAssessmentRun, systemId: string) {
  const model = MINERAL_SYSTEM_MODELS.find(m => m.id === systemId)
  if (!model) return []
  return model.criteria.flatMap(item => {
    const summary = run.evidence.find(e => e.criterionId === item.id)
    if (summary?.state === 'supports') return []
    const criterion = MINERAL_CRITERIA.find(c => c.id === item.id)!
    return [{ ...criterion, state: summary?.state ?? 'not-observed', priority: item.weight * (1 - Math.max(summary?.support ?? 0, summary?.contradiction ?? 0) / 2) / criterion.cost }]
  }).sort((a, b) => b.priority - a.priority)
}

export function assessSourceSensitivity(run: MineralAssessmentRun, excludedDatasetIds: readonly string[]) {
  const excluded = new Set(excludedDatasetIds)
  const evidence = aggregate(run.intervals.flatMap(row => row.matches.filter(match => !excluded.has(match.datasetId))))
  return MINERAL_SYSTEM_MODELS.map(model => assessMineralModel(model, evidence)).sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || b.coverage - a.coverage || a.systemId.localeCompare(b.systemId))
}

/** Project the chosen model onto actual base supports; never fabricate interpolated ore envelopes. */
export function mineralAssessmentDataset(dataset: EdaDataset, run: MineralAssessmentRun, systemId: string): EdaDataset {
  if (dataset.id !== run.baseDatasetId || dataset.snapshotAt !== run.snapshots.find(s => s.datasetId === dataset.id)?.snapshotAt) return dataset
  const model = MINERAL_SYSTEM_MODELS.find(m => m.id === systemId)
  if (!model) return dataset
  const byId = new Map(run.intervals.map(row => [row.observationId, row]))
  const eligible = new Set(model.criteria.map(c => c.id))
  return { ...dataset,
    variables: [...dataset.variables, { key: 'mineral.fit', label: `${model.label} evidence fit`, shortLabel: 'Evidence fit', unit: 'index / 100', decimals: 1 },
      { key: 'mineral.coverage', label: 'Evidence coverage', shortLabel: 'Coverage', unit: '%', decimals: 1 }],
    dimensions: [...dataset.dimensions, { key: 'mineral.evidence', label: 'Evidence status' }, { key: 'mineral.methods', label: 'Evidence datasets' }],
    observations: dataset.observations.map(row => {
      const interval = byId.get(row.id)
      if (!interval) return { ...row, values: { ...row.values, 'mineral.fit': null, 'mineral.coverage': null }, dimensions: { ...row.dimensions, 'mineral.evidence': 'Not assessed' } }
      const matches = interval.matches.filter(m => eligible.has(m.criterionId))
      const assessment = assessMineralModel(model, aggregate(matches, model.criteria.map(item => item.id)))
      const positive = matches.some(m => m.polarity === 'support'), negative = matches.some(m => m.polarity === 'contradict')
      return { ...row, sourceObservationIds: interval.sourceObservationIds,
        values: { ...row.values, 'mineral.fit': assessment.fit, 'mineral.coverage': assessment.coverage },
        dimensions: { ...row.dimensions, 'mineral.evidence': positive && negative ? 'Conflicting evidence' : positive ? 'Supporting evidence' : negative ? 'Contradictory evidence' : 'No qualifying evidence',
          'mineral.methods': [...new Set(matches.map(m => run.snapshots.find(s => s.datasetId === m.datasetId)?.name ?? m.datasetId))].join(' + ') || 'No linked evidence' } }
    }) }
}
