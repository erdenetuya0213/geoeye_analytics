import type { ObservationQuality, VariableDataType } from '@geoeye/types'
import type { VariableRegistry } from '@geoeye/variable-registry'

export interface FieldLoggingStructure {
  id: string
  projectId: string
  holeId: string | null
  rowId: string
  depthFrom: number | null
  depthTo: number | null
  angleDeg: number | null
  structureType: string | null
  selectionsJson: string | Record<string, unknown>
  reviewStatus: 'draft' | 'accepted' | 'flagged'
  updatedAt?: string | null
}

export type FieldProjectionSource =
  | { kind: 'selection'; key: string }
  | { kind: 'column'; column: 'angleDeg' | 'structureType' }

export interface FieldProjectionBinding {
  variableKey: string
  source: FieldProjectionSource
}

export interface ProjectionContext {
  datasetId: string
  datasetVersionId: string | null
  includeUnaccepted?: boolean
}

export interface ProjectedObservation {
  projectId: string
  datasetId: string
  datasetVersionId: string | null
  sourceType: 'field.logging_structure'
  sourceId: string
  holeId: string | null
  depthFrom: number | null
  depthTo: number | null
  variableKey: string
  numericValue: number | null
  textValue: string | null
  categoryValue: string | null
  booleanValue: boolean | null
  datetimeValue: string | null
  unit: string | null
  quality: ObservationQuality
  observedAt: string | null
}

export interface ProjectionIssue {
  code:
    | 'invalid_selections_json'
    | 'unaccepted_source'
    | 'unknown_variable'
    | 'missing_value'
    | 'invalid_value'
  sourceId: string
  variableKey?: string
  message: string
}

export interface ProjectionResult {
  observations: ProjectedObservation[]
  issues: ProjectionIssue[]
}

function parseSelections(
  source: FieldLoggingStructure,
): { selections: Record<string, unknown>; issue?: ProjectionIssue } {
  if (typeof source.selectionsJson !== 'string') {
    return { selections: source.selectionsJson }
  }

  try {
    const candidate: unknown = JSON.parse(source.selectionsJson)
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return { selections: candidate as Record<string, unknown> }
    }
  } catch {
    // Returned below as an operational projection issue.
  }

  return {
    selections: {},
    issue: {
      code: 'invalid_selections_json',
      sourceId: source.id,
      message: 'Field selections_json is not a JSON object',
    },
  }
}

function sourceValue(
  source: FieldLoggingStructure,
  selections: Record<string, unknown>,
  binding: FieldProjectionBinding,
): unknown {
  if (binding.source.kind === 'selection') {
    return selections[binding.source.key]
  }
  return source[binding.source.column]
}

type ProjectedTypedValue = Pick<
  ProjectedObservation,
  'numericValue' | 'textValue' | 'categoryValue' | 'booleanValue' | 'datetimeValue'
>

function emptyTypedValue(): ProjectedTypedValue {
  return {
    numericValue: null,
    textValue: null,
    categoryValue: null,
    booleanValue: null,
    datetimeValue: null,
  }
}

function coerceValue(
  value: unknown,
  dataType: VariableDataType,
): ProjectedTypedValue | undefined {
  const output = emptyTypedValue()

  if (dataType === 'numeric') {
    if (typeof value === 'string' && value.trim() === '') return undefined
    const numeric = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numeric)) return undefined
    output.numericValue = numeric
    return output
  }

  if (dataType === 'boolean') {
    if (value === true || value === false) {
      output.booleanValue = value
      return output
    }
    if (value === 'true' || value === 'false') {
      output.booleanValue = value === 'true'
      return output
    }
    return undefined
  }

  if (dataType === 'datetime') {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined
    output.datetimeValue = new Date(value).toISOString()
    return output
  }

  if (typeof value !== 'string' || value.trim() === '') return undefined
  if (dataType === 'category') output.categoryValue = value
  else output.textValue = value
  return output
}

function qualityFor(status: FieldLoggingStructure['reviewStatus']): ObservationQuality {
  if (status === 'accepted') return 'accepted'
  if (status === 'flagged') return 'flagged'
  return 'raw'
}

export function projectFieldLoggingStructure(
  source: FieldLoggingStructure,
  bindings: readonly FieldProjectionBinding[],
  registry: VariableRegistry,
  context: ProjectionContext,
): ProjectionResult {
  if (source.reviewStatus !== 'accepted' && !context.includeUnaccepted) {
    return {
      observations: [],
      issues: [
        {
          code: 'unaccepted_source',
          sourceId: source.id,
          message: `Field structure is ${source.reviewStatus}; only accepted observations are projected`,
        },
      ],
    }
  }

  const parsed = parseSelections(source)
  const issues = parsed.issue ? [parsed.issue] : []
  const observations: ProjectedObservation[] = []

  for (const binding of bindings) {
    const definition = registry.get(binding.variableKey)
    if (!definition) {
      issues.push({
        code: 'unknown_variable',
        sourceId: source.id,
        variableKey: binding.variableKey,
        message: `Projection binding targets unknown variable ${binding.variableKey}`,
      })
      continue
    }

    const rawValue = sourceValue(source, parsed.selections, binding)
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      issues.push({
        code: 'missing_value',
        sourceId: source.id,
        variableKey: binding.variableKey,
        message: `No source value was found for ${binding.variableKey}`,
      })
      continue
    }

    const typedValue = coerceValue(rawValue, definition.dataType)
    if (!typedValue) {
      issues.push({
        code: 'invalid_value',
        sourceId: source.id,
        variableKey: binding.variableKey,
        message: `Value cannot be converted to ${definition.dataType}`,
      })
      continue
    }

    observations.push({
      projectId: source.projectId,
      datasetId: context.datasetId,
      datasetVersionId: context.datasetVersionId,
      sourceType: 'field.logging_structure',
      sourceId: source.id,
      holeId: source.holeId,
      depthFrom: source.depthFrom,
      depthTo: source.depthTo,
      variableKey: definition.key,
      ...typedValue,
      unit: definition.canonicalUnit,
      quality: qualityFor(source.reviewStatus),
      observedAt: source.updatedAt ?? null,
    })
  }

  return { observations, issues }
}
