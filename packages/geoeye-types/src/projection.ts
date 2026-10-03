import { z } from 'zod'

/** Field-owned sources the Data Pool projects into `observation_values`. */
export const projectionSourceTypeSchema = z.enum([
  'field.logging_structure',
  'field.core_row',
])

export const projectionExtractionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('selection'), key: z.string().trim().min(1).max(120) }),
  z.object({ kind: z.literal('column'), column: z.enum(['angleDeg', 'structureType']) }),
])

export const projectionBindingInputSchema = z.object({
  /** `null` defines a default for every project; a project binding overrides it. */
  projectId: z.string().uuid().nullable(),
  sourceEntityType: z.literal('field.logging_structure'),
  sourceField: z.string().trim().min(1).max(200),
  variableKey: z.string().min(1),
  extraction: projectionExtractionSchema,
  isActive: z.boolean().default(true),
})

export const projectionBindingSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  sourceEntityType: z.string().min(1),
  sourceField: z.string().min(1),
  variableKey: z.string().min(1),
  extraction: z.record(z.unknown()),
  isActive: z.boolean(),
})

export const saveProjectionBindingsInputSchema = z.object({
  bindings: z.array(projectionBindingInputSchema).min(1).max(500),
})

export const projectionStatusSchema = z.object({
  projectId: z.string().uuid(),
  sourceEntityType: z.string().min(1),
  datasetId: z.string().uuid().nullable(),
  sourceRowCount: z.number().int().nonnegative(),
  observationCount: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  issueSummary: z.record(z.number().int().nonnegative()),
  lastStatus: z.enum(['ok', 'failed']),
  lastError: z.string().nullable(),
  lastRunAt: z.string().datetime(),
  lastChangedAt: z.string().datetime().nullable(),
})

export const projectionSourceResultSchema = z.object({
  sourceEntityType: z.string().min(1),
  outcome: z.enum(['projected', 'unchanged', 'skipped', 'failed']),
  datasetId: z.string().uuid().nullable(),
  sourceRowCount: z.number().int().nonnegative(),
  observationCount: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  issueSummary: z.record(z.number().int().nonnegative()),
  message: z.string().nullable(),
})

export const projectionRunResultSchema = z.object({
  projectId: z.string().uuid(),
  sources: z.array(projectionSourceResultSchema),
})

export type ProjectionSourceType = z.infer<typeof projectionSourceTypeSchema>
export type ProjectionExtraction = z.infer<typeof projectionExtractionSchema>
export type ProjectionBindingInput = z.infer<typeof projectionBindingInputSchema>
export type ProjectionBinding = z.infer<typeof projectionBindingSchema>
export type SaveProjectionBindingsInput = z.infer<typeof saveProjectionBindingsInputSchema>
export type ProjectionStatus = z.infer<typeof projectionStatusSchema>
export type ProjectionSourceResult = z.infer<typeof projectionSourceResultSchema>
export type ProjectionRunResult = z.infer<typeof projectionRunResultSchema>
