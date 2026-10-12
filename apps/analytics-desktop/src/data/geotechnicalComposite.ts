import { calculateRmr76, type ExcavationType, type Rmr76JointCondition, type Rmr76Groundwater, type Rmr76Orientation } from '../analysis/geotechnical.js'
import { InputResolver, RMR76_METHOD_DEFINITION, type GeotechnicalInterval, type InputCandidate, type Rmr76CanonicalInputKey } from '../analysis/geotechnicalWorkflow.js'
import { buildJoinedRmrDataset, mappedValue, rmrStrengthSourceLabel, type DatabaseRmrRecord, type DatabaseRmrSource, type JoinedRmrDataset, type Rmr76ParameterSource, type Rmr76ParameterSourceMapping } from './geotechnicalDatabase.js'
import { selectedFieldSpans, splitFieldSpans } from './compositeBoundaries.js'

export interface CompositeRules {
  intervalLength: number
  startDepth: number
  boundarySourceId: string
  boundaryFieldKey?: string
  secondaryBoundarySourceId?: string
  secondaryBoundaryFieldKey?: string
  population: 'mean' | 'minimum' | 'mode'
}
export interface CompositeParameterCoverage {
  covered: number
  missing: number
  mean: number | null
  samples: number
  estimated: number
}
export interface CompositeRmrDataset extends JoinedRmrDataset {
  coverage: Record<Rmr76CanonicalInputKey, CompositeParameterCoverage>
}

export function buildCompositeRmrDataset(
  sources: readonly DatabaseRmrSource[], mapping: Rmr76ParameterSourceMapping,
  excavation: ExcavationType, rules: CompositeRules,
  meanFill: Partial<Record<Rmr76CanonicalInputKey, boolean>> = {},
  inScope: (record: DatabaseRmrRecord, source: DatabaseRmrSource) => boolean = () => true,
): CompositeRmrDataset {
  const base = buildJoinedRmrDataset(sources, mapping, excavation)
  const byId = new Map(sources.map(source => [source.dataset.id, source]))
  if (rules.boundarySourceId && !rules.boundarySourceId.startsWith('field:') && !rules.boundaryFieldKey) {
    throw new Error('Choose the field that defines the boundary in the selected template.')
  }
  if (rules.secondaryBoundarySourceId && !rules.secondaryBoundaryFieldKey) throw new Error('Choose the second boundary field.')
  const selected = new Set(Object.values(mapping).flatMap(selection => selection === undefined ? [] : [selection.sourceId, ...(selection.fallback ? [selection.fallback.sourceId] : [])]))
  const resolver = new InputResolver()
  const scopedRecords = [...selected].flatMap(id => {
    const source = byId.get(id)
    if (!source) return []
    return source.records.filter(record => record.holeId !== null && record.depthFrom !== null
      && record.depthTo !== null && record.depthTo >= record.depthFrom && inScope(record, source))
      .map(record => ({ record, source }))
  })
  const holes = [...new Set(scopedRecords.map(({ record }) => record.holeId!))]
  const length = Number.isFinite(rules.intervalLength) ? Math.max(0.1, rules.intervalLength) : 3
  const start = Number.isFinite(rules.startDepth) ? Math.max(0, rules.startDepth) : 0
  const fieldSource = rules.boundarySourceId.startsWith('field:') ? byId.get(rules.boundarySourceId.slice(6)) : undefined
  if (rules.boundarySourceId.startsWith('field:') && !fieldSource?.composite) throw new Error('The selected Field rule source is unavailable. Select a current template.')
  const intervals: GeotechnicalInterval[] = []
  for (const hole of holes) {
    const records = scopedRecords.filter(item => item.record.holeId === hole)
    const firstDepth = Math.min(...records.map(item => item.record.depthFrom!))
    const minimum = Math.max(start, start + Math.floor((firstDepth - start) / length) * length)
    const lastDepth = Math.max(...records.map(item => item.record.depthTo!))
    // A laboratory sample is a point, including one on the final bin boundary.
    const maximum = records.some(({ record }) => record.depthFrom === lastDepth && record.depthTo === lastDepth)
      ? start + (Math.floor((lastDepth - start) / length) + 1) * length : lastDepth
    if (maximum <= minimum) continue
    const boundaries = new Set<number>([minimum, maximum])
    const count = Math.ceil((maximum - start) / length)
    if (count > 100000) throw new Error('Composite interval length is too small for this depth range.')
    for (let step = Math.max(0, Math.floor((minimum - start) / length)); step <= count; step++) {
      const depth = Number((start + step * length).toFixed(8))
      if (depth > minimum && depth < maximum) boundaries.add(depth)
    }
    const boundarySource = byId.get(rules.boundarySourceId)
    for (const record of boundarySource?.records ?? []) {
      if (record.holeId !== hole) continue
      for (const depth of [record.depthFrom, record.depthTo]) {
        if (depth !== null && depth > minimum && depth < maximum) boundaries.add(depth)
      }
    }
    const depths = [...boundaries].sort((a, b) => a - b)
    const fieldSpans = fieldSource?.composite?.intervals.filter(item => item.holeId === hole)
    const selectedSpans = rules.boundaryFieldKey ? selectedFieldSpans(boundarySource, hole, rules.boundaryFieldKey) : undefined
    const secondarySpans = rules.secondaryBoundarySourceId && rules.secondaryBoundaryFieldKey
      ? selectedFieldSpans(byId.get(rules.secondaryBoundarySourceId), hole, rules.secondaryBoundaryFieldKey) : []
    const spans = fieldSource ? (fieldSpans ?? [])
      : selectedSpans ? splitFieldSpans(selectedSpans, length, start, maximum, [...new Set(secondarySpans.flatMap(span => [span.depthFrom, span.depthTo]))].sort((a, b) => a - b))
        : depths.slice(0, -1).map((depthFrom, index) => ({ depthFrom, depthTo: depths[index + 1]!, exclusionReason: undefined }))
    for (const span of spans) {
      const from = span.depthFrom, to = span.depthTo
      if (!inScope({ ...records[0]!.record, depthFrom: from, depthTo: to }, records[0]!.source)) continue
      const candidates: InputCandidate[] = []
      for (const definition of RMR76_METHOD_DEFINITION.requiredInputs) {
        const initialSelection = mapping[definition.key]
        const initialSource = initialSelection === undefined ? undefined : byId.get(initialSelection.sourceId)
        if (initialSource === undefined || initialSelection === undefined) continue
        let selection: Rmr76ParameterSource = initialSelection
        let source: DatabaseRmrSource = initialSource
        const unique = new Map<string, { value: unknown; weight: number; id: string }>()
        for (let attempt = 0; attempt < 2; attempt++) {
          for (const record of source.records) {
          if (record.holeId !== hole || record.depthFrom === null || record.depthTo === null || !inScope(record, source)) continue
          const point = record.depthFrom === record.depthTo
          const overlap = Math.min(to, record.depthTo) - Math.max(from, record.depthFrom)
          if (point ? record.depthFrom < from || record.depthFrom >= to : overlap <= 0) continue
          let value = record.values[selection.columnKey]
          if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) continue
          value = mappedValue(definition.key, value, excavation, selection)
          const id = record.observationIds[selection.columnKey] ?? record.id
          unique.set(JSON.stringify([record.depthFrom, record.depthTo, value]), { value, weight: point ? 1 : overlap, id })
        }
          if ([...unique.values()].some(sample => sample.value != null) || definition.key !== 'geotech.ucs' || !selection?.fallback) break
          const fallback: NonNullable<Rmr76ParameterSource['fallback']> = selection.fallback
          const fallbackSource = byId.get(fallback.sourceId)
          if (!fallbackSource) break
          selection = fallback; source = fallbackSource; unique.clear()
        }
        const samples = [...unique.values()]
        if (samples.length === 0) continue
        let value: unknown
        if (samples.every(sample => typeof sample.value === 'number' && Number.isFinite(sample.value)) && rules.population !== 'mode') {
          value = rules.population === 'minimum' ? Math.min(...samples.map(sample => sample.value as number))
            : samples.reduce((sum, sample) => sum + (sample.value as number) * sample.weight, 0) / samples.reduce((sum, sample) => sum + sample.weight, 0)
          value = Math.max(Math.min(...samples.map(sample => sample.value as number)), Math.min(Math.max(...samples.map(sample => sample.value as number)), value as number))
        } else {
          const groups = new Map<string, { value: unknown; weight: number }>()
          for (const sample of samples) {
            const key = JSON.stringify(sample.value), previous = groups.get(key)
            groups.set(key, { value: sample.value, weight: (previous?.weight ?? 0) + sample.weight })
          }
          value = [...groups.values()].sort((a, b) => b.weight - a.weight || JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)))[0]!.value
        }
        candidates.push({ canonicalKey: definition.key, value, availability: 'derived',
          sourceTemplateId: source.dataset.id, sourceFieldId: selection.columnKey,
          observationId: samples.map(sample => sample.id).sort().join('|'),
          sourceLabel: `${definition.key === 'geotech.ucs' ? rmrStrengthSourceLabel(source.dataset.name, selection) : source.dataset.name} · composite ${rules.population}` })
      }
      intervals.push({ id: `composite:${hole}:${from}:${to}`, holeId: records[0]!.source.holeNames.get(hole) ?? hole,
        depthFrom: from, depthTo: to, candidates, lithology: 'Unassigned',
        ...(span.exclusionReason ? { exclusionReason: span.exclusionReason, exclusionSource: fieldSource?.dataset.name ?? 'Field' } : {}) })
    }
  }
  const coverage = {} as CompositeRmrDataset['coverage']
  for (const definition of RMR76_METHOD_DEFINITION.requiredInputs) {
    const resolved = intervals.map(interval => resolver.resolve(interval, selected).inputs[definition.key])
    const numbers = resolved.flatMap((input, index) => {
      const weight = intervals[index]!.depthTo - intervals[index]!.depthFrom
      if (input.availability === 'missing' || intervals[index]!.exclusionReason) return []
      if (typeof input.value === 'number') return [{ value: input.value, weight }]
      const scores = definition.key === 'geotech.joint_condition'
        ? calculateRmr76({ jointCondition: input.value as Rmr76JointCondition }).scores.jointCondition
        : definition.key === 'geotech.groundwater'
          ? calculateRmr76({ groundwater: input.value as Rmr76Groundwater }).scores.groundwater
          : definition.key === 'structure.orientation_rating'
            ? calculateRmr76({ excavationType: excavation, orientation: (input.value as { orientation: Rmr76Orientation }).orientation }).orientationAdjustment : null
      return typeof scores === 'number' && Number.isFinite(scores) ? [{ value: scores, weight }] : []
    })
    const assessed = intervals.filter(interval => !interval.exclusionReason).length
    const missing = resolved.filter((input, index) => !intervals[index]!.exclusionReason && input.availability === 'missing').length
    const mean = numbers.length === 0 ? null : numbers.reduce((sum, sample) => sum + sample.value * sample.weight, 0) / numbers.reduce((sum, sample) => sum + sample.weight, 0)
    let estimated = 0
    const selection = mapping[definition.key]
    const source = selection === undefined ? undefined : byId.get(selection.sourceId)
    if (meanFill[definition.key] && mean !== null && source !== undefined && selection !== undefined) {
      intervals.forEach((interval, index) => {
        if (interval.exclusionReason) return
        if (resolved[index]!.availability !== 'missing') return
        // Invalid recorded values require correction; only genuinely blank intervals are filled.
        if (interval.candidates.some(candidate => candidate.canonicalKey === definition.key)) return
        interval.candidates = [...interval.candidates, { canonicalKey: definition.key, value: mean, availability: 'fallback',
          sourceTemplateId: source.dataset.id, sourceFieldId: selection.columnKey,
          sourceLabel: `${definition.key === 'geotech.ucs' ? rmrStrengthSourceLabel(source.dataset.name, selection) : source.dataset.name} · estimated scoped composite mean (${numbers.length} intervals)`,
          observationId: `mean:${definition.key}:${mean}:n=${numbers.length}:${interval.id}` }]
        estimated++
      })
    }
    coverage[definition.key] = { covered: assessed - missing, missing, mean, samples: numbers.length, estimated }
    base.diagnostics.parameters[definition.key] = { ambiguousIntervalCount: 0, matchedIntervalCount: assessed - missing + estimated,
      sourceIntervalCount: assessed - missing, unmatchedIntervalCount: missing - estimated }
  }
  intervals.sort((a, b) => a.holeId.localeCompare(b.holeId) || a.depthFrom - b.depthFrom || a.depthTo - b.depthTo)
  base.dataset = { ...base.dataset, intervals, label: 'Local RMR76 composite',
    snapshotId: `${base.dataset.snapshotId}:composite:${JSON.stringify(rules)}:${JSON.stringify(meanFill)}`,
    snapshotLabel: `Composite ${length} m · ${rules.population}` }
  const ready = intervals.filter(interval => !interval.exclusionReason && resolver.resolve(interval, selected).missing.every(key => key === 'structure.orientation_rating'))
  base.diagnostics.complete = RMR76_METHOD_DEFINITION.requiredInputs.filter(input => input.key !== 'structure.orientation_rating').every(input => mapping[input.key] !== undefined)
  base.diagnostics.matchedIntervalCount = ready.length
  base.diagnostics.matchedBoreholeCount = new Set(ready.map(interval => interval.holeId)).size
  return { ...base, coverage }
}
