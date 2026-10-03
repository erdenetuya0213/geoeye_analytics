import {
  calculateRmr76,
  type ExcavationType,
  type Rmr76Groundwater,
  type Rmr76JointCondition,
  type Rmr76Orientation,
  type Rmr76Result,
} from './geotechnical.js'

export type InputAvailability = 'direct' | 'derived' | 'fallback' | 'missing'

export type Rmr76CanonicalInputKey =
  | 'geotech.ucs'
  | 'geotech.rqd'
  | 'structure.joint_spacing'
  | 'geotech.joint_condition'
  | 'geotech.groundwater'
  | 'structure.orientation_rating'

export interface MethodInputDefinition<TKey extends string = string> {
  key: TKey
  label: string
  unit: string | null
}

export interface MethodDefinition<TKey extends string = string> {
  id: string
  name: string
  reference: string
  requiredInputs: readonly MethodInputDefinition<TKey>[]
  version: string
}

export interface SourceLineage {
  availability: Exclude<InputAvailability, 'missing'>
  canonicalKey: Rmr76CanonicalInputKey
  observationId: string
  sourceFieldId: string
  sourceLabel: string
  sourceTemplateId: string
}

export interface InputCandidate extends SourceLineage {
  value: unknown
}

export interface GeotechnicalInterval {
  candidates: readonly InputCandidate[]
  depthFrom: number
  depthTo: number
  exclusionReason?: string
  exclusionSource?: string
  holeId: string
  id: string
  lithology: string
}

export interface ResolvedInput {
  availability: InputAvailability
  definition: MethodInputDefinition<Rmr76CanonicalInputKey>
  lineage: SourceLineage | null
  value: unknown
}

export interface ResolvedInputs {
  inputs: Record<Rmr76CanonicalInputKey, ResolvedInput>
  missing: Rmr76CanonicalInputKey[]
}

export interface Rmr76IntervalResult {
  calculation: Rmr76Result | null
  depthFrom: number
  depthTo: number
  exclusionReason: string | null
  exclusionSource: string | null
  holeId: string
  id: string
  inputValues: {
    rqdPercent: number | null
    ucsMpa: number | null
  }
  lineage: SourceLineage[]
  lithology: string
  missing: Rmr76CanonicalInputKey[]
  resolvedInputs: ResolvedInputs['inputs']
  status: 'valid' | 'excluded' | 'missing'
}

export interface Rmr76RunSummary {
  classCounts: Record<string, number>
  excluded: number
  mean: number | null
  median: number | null
  missing: number
  valid: number
}

export interface Rmr76CalculationRun {
  calculatedAt: string
  intervals: Rmr76IntervalResult[]
  method: MethodDefinition
  runId: string
  snapshotId: string
  sourceSignature: string
  summary: Rmr76RunSummary
}

export const RMR76_METHOD_DEFINITION: MethodDefinition<Rmr76CanonicalInputKey> = {
  id: 'rmr76',
  name: 'RMR76 · Bieniawski 1976',
  reference: 'Bieniawski (1976), Rock mass classifications in rock engineering',
  version: 'rmr76-bieniawski-1976.1',
  requiredInputs: [
    { key: 'geotech.ucs', label: 'UCS', unit: 'MPa' },
    { key: 'geotech.rqd', label: 'RQD', unit: '%' },
    { key: 'structure.joint_spacing', label: 'Joint spacing', unit: 'm' },
    { key: 'geotech.joint_condition', label: 'Joint condition', unit: null },
    { key: 'geotech.groundwater', label: 'Groundwater', unit: null },
    { key: 'structure.orientation_rating', label: 'Orientation', unit: null },
  ],
}

const availabilityPriority: Record<Exclude<InputAvailability, 'missing'>, number> = {
  direct: 0,
  derived: 1,
  fallback: 2,
}

const jointConditions = new Set<Rmr76JointCondition>([
  'very-rough-closed',
  'slightly-rough-hard-wall',
  'slightly-rough-soft-wall',
  'slickensided-or-thin-gouge',
  'thick-soft-gouge-or-open',
])

const groundwaterConditions = new Set<Rmr76Groundwater>(['dry', 'moist', 'moderate', 'severe'])
const orientations = new Set<Rmr76Orientation>(['very-favourable', 'favourable', 'fair', 'unfavourable', 'very-unfavourable'])
const excavationTypes = new Set<ExcavationType>(['tunnel', 'foundation', 'slope'])

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidValue(key: Rmr76CanonicalInputKey, value: unknown) {
  if (key === 'geotech.ucs') return isFiniteNumber(value) && value >= 0
  if (key === 'geotech.rqd') return isFiniteNumber(value) && value >= 0 && value <= 100
  if (key === 'structure.joint_spacing') return isFiniteNumber(value) && value >= 0
  if (key === 'geotech.joint_condition') return typeof value === 'string' && jointConditions.has(value as Rmr76JointCondition)
  if (key === 'geotech.groundwater') return typeof value === 'string' && groundwaterConditions.has(value as Rmr76Groundwater)
  if (typeof value !== 'object' || value === null) return false
  const orientation = value as { excavationType?: unknown; orientation?: unknown }
  return typeof orientation.excavationType === 'string'
    && excavationTypes.has(orientation.excavationType as ExcavationType)
    && typeof orientation.orientation === 'string'
    && orientations.has(orientation.orientation as Rmr76Orientation)
}

function compareCandidates(left: InputCandidate, right: InputCandidate) {
  const priority = availabilityPriority[left.availability] - availabilityPriority[right.availability]
  if (priority !== 0) return priority
  return `${left.sourceTemplateId}:${left.sourceFieldId}:${left.observationId}`
    .localeCompare(`${right.sourceTemplateId}:${right.sourceFieldId}:${right.observationId}`)
}

export class InputResolver {
  resolve(
    interval: GeotechnicalInterval,
    selectedSourceTemplateIds: ReadonlySet<string>,
    method: MethodDefinition<Rmr76CanonicalInputKey> = RMR76_METHOD_DEFINITION,
  ): ResolvedInputs {
    const resolved = {} as ResolvedInputs['inputs']
    const missing: Rmr76CanonicalInputKey[] = []

    for (const definition of method.requiredInputs) {
      const candidate = interval.candidates
        .filter((item) => item.canonicalKey === definition.key)
        .filter((item) => selectedSourceTemplateIds.has(item.sourceTemplateId))
        .filter((item) => isValidValue(item.canonicalKey, item.value))
        .sort(compareCandidates)[0]

      if (candidate === undefined) {
        missing.push(definition.key)
        resolved[definition.key] = { availability: 'missing', definition, lineage: null, value: null }
      } else {
        const { value, ...lineage } = candidate
        resolved[definition.key] = { availability: candidate.availability, definition, lineage, value }
      }
    }

    return { inputs: resolved, missing }
  }
}

export class DeterministicCalculator {
  calculate(method: MethodDefinition<Rmr76CanonicalInputKey>, resolved: ResolvedInputs): Rmr76Result | null {
    if (method.id !== 'rmr76' || resolved.missing.length > 0) return null
    const input = resolved.inputs
    const orientationValue = input['structure.orientation_rating'].value as {
      excavationType: ExcavationType
      orientation: Rmr76Orientation
    }
    return calculateRmr76({
      excavationType: orientationValue.excavationType,
      groundwater: input['geotech.groundwater'].value as Rmr76Groundwater,
      jointCondition: input['geotech.joint_condition'].value as Rmr76JointCondition,
      jointSpacingM: input['structure.joint_spacing'].value as number,
      orientation: orientationValue.orientation,
      rqdPercent: input['geotech.rqd'].value as number,
      ucsMpa: input['geotech.ucs'].value as number,
    })
  }
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${key}:${stableValue(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function buildRmr76SourceSignature(
  intervals: readonly GeotechnicalInterval[],
  selectedSourceTemplateIds: ReadonlySet<string>,
) {
  const selected = [...selectedSourceTemplateIds].sort()
  const payload = intervals.map((interval) => ({
    candidates: interval.candidates
      .filter((candidate) => selectedSourceTemplateIds.has(candidate.sourceTemplateId))
      .map((candidate) => ({
        availability: candidate.availability,
        canonicalKey: candidate.canonicalKey,
        observationId: candidate.observationId,
        sourceFieldId: candidate.sourceFieldId,
        sourceTemplateId: candidate.sourceTemplateId,
        value: candidate.value,
      }))
      .sort((left, right) => `${left.canonicalKey}:${left.sourceTemplateId}:${left.sourceFieldId}:${left.observationId}`
        .localeCompare(`${right.canonicalKey}:${right.sourceTemplateId}:${right.sourceFieldId}:${right.observationId}`)),
    depthFrom: interval.depthFrom,
    depthTo: interval.depthTo,
    exclusionReason: interval.exclusionReason ?? null,
    exclusionSource: interval.exclusionSource ?? null,
    id: interval.id,
  }))
  return `rmr76-${fnv1a(stableValue({ intervals: payload, selected }))}`
}

function summarize(intervals: readonly Rmr76IntervalResult[]): Rmr76RunSummary {
  const totals = intervals.flatMap((interval) => interval.status === 'valid' && typeof interval.calculation?.total === 'number'
    ? [interval.calculation.total]
    : [])
  const sorted = [...totals].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length === 0
    ? null
    : sorted.length % 2 === 1
      ? sorted[middle] ?? null
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  const classCounts = intervals.reduce<Record<string, number>>((counts, interval) => {
    const classification = interval.calculation?.classification
    if (interval.status === 'valid' && classification !== null && classification !== undefined) {
      counts[classification] = (counts[classification] ?? 0) + 1
    }
    return counts
  }, {})
  return {
    classCounts,
    excluded: intervals.filter((interval) => interval.status === 'excluded').length,
    mean: totals.length === 0 ? null : totals.reduce((sum, total) => sum + total, 0) / totals.length,
    median,
    missing: intervals.filter((interval) => interval.status === 'missing').length,
    valid: totals.length,
  }
}

export function calculateRmr76Intervals(
  intervals: readonly GeotechnicalInterval[],
  selectedSourceTemplateIds: ReadonlySet<string>,
  runId: string,
  calculatedAt: string,
  snapshotId = 'unversioned',
  resolver = new InputResolver(),
  calculator = new DeterministicCalculator(),
): Rmr76CalculationRun {
  const results = intervals.map((interval): Rmr76IntervalResult => {
    const resolved = resolver.resolve(interval, selectedSourceTemplateIds)
    const calculation = interval.exclusionReason === undefined
      ? calculator.calculate(RMR76_METHOD_DEFINITION, resolved)
      : null
    const lineage = Object.values(resolved.inputs).flatMap((input) => input.lineage === null ? [] : [input.lineage])
    return {
      calculation,
      depthFrom: interval.depthFrom,
      depthTo: interval.depthTo,
      exclusionReason: interval.exclusionReason ?? null,
      exclusionSource: interval.exclusionSource ?? null,
      holeId: interval.holeId,
      id: interval.id,
      inputValues: {
        rqdPercent: resolved.inputs['geotech.rqd'].availability === 'missing' ? null : resolved.inputs['geotech.rqd'].value as number,
        ucsMpa: resolved.inputs['geotech.ucs'].availability === 'missing' ? null : resolved.inputs['geotech.ucs'].value as number,
      },
      lineage,
      lithology: interval.lithology,
      missing: resolved.missing,
      resolvedInputs: resolved.inputs,
      status: interval.exclusionReason !== undefined ? 'excluded' : calculation === null ? 'missing' : 'valid',
    }
  })
  return {
    calculatedAt,
    intervals: results,
    method: RMR76_METHOD_DEFINITION,
    runId,
    snapshotId,
    sourceSignature: buildRmr76SourceSignature(intervals, selectedSourceTemplateIds),
    summary: summarize(results),
  }
}

export function summarizeInputReadiness(
  intervals: readonly GeotechnicalInterval[],
  selectedSourceTemplateIds: ReadonlySet<string>,
  resolver = new InputResolver(),
) {
  const priority: Record<InputAvailability, number> = { direct: 0, derived: 1, fallback: 2, missing: 3 }
  return RMR76_METHOD_DEFINITION.requiredInputs.map((definition) => {
    const availabilities = intervals.map((interval) => resolver.resolve(interval, selectedSourceTemplateIds).inputs[definition.key].availability)
    const availability = availabilities.sort((left, right) => priority[left] - priority[right])[0] ?? 'missing'
    return { ...definition, availability }
  })
}
