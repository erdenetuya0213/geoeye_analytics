import { z } from 'zod'

export const observationQualitySchema = z.enum([
  'raw',
  'reviewed',
  'accepted',
  'flagged',
])

const typedValueShape = {
  numericValue: z.number().finite().nullable().default(null),
  textValue: z.string().nullable().default(null),
  categoryValue: z.string().nullable().default(null),
  booleanValue: z.boolean().nullable().default(null),
  datetimeValue: z.string().datetime().nullable().default(null),
}

function hasOneTypedValue(value: Record<string, unknown>): boolean {
  return [
    value.numericValue,
    value.textValue,
    value.categoryValue,
    value.booleanValue,
    value.datetimeValue,
  ].filter((item) => item !== null && item !== undefined).length === 1
}

export const observationValueSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    datasetId: z.string().uuid(),
    datasetVersionId: z.string().uuid().nullable(),
    sourceType: z.string().min(1),
    sourceId: z.string().min(1),
    /** Field logging template that owns the source row, when the source provides one. */
    sourceTemplateId: z.string().uuid().nullable().optional(),
    holeId: z.string().uuid().nullable(),
    depthFrom: z.number().nonnegative().nullable(),
    depthTo: z.number().nonnegative().nullable(),
    variableKey: z.string().min(1),
    ...typedValueShape,
    unit: z.string().nullable(),
    quality: observationQualitySchema,
    observedAt: z.string().datetime().nullable(),
  })
  .superRefine((value, context) => {
    if (!hasOneTypedValue(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Exactly one typed value must be provided',
      })
    }
    if (value.depthFrom !== null && value.depthTo !== null && value.depthTo < value.depthFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'depthTo must be greater than or equal to depthFrom',
        path: ['depthTo'],
      })
    }
  })

export const OBSERVATION_QUERY_DEFAULT_LIMIT = 50_000
export const OBSERVATION_QUERY_MAX_LIMIT = 200_000

export const observationQuerySchema = z.object({
  projectId: z.string().uuid(),
  variableKeys: z.array(z.string().min(1)).min(1),
  datasetIds: z.array(z.string().uuid()).optional(),
  holeIds: z.array(z.string().uuid()).optional(),
  depthFrom: z.number().nonnegative().optional(),
  depthTo: z.number().nonnegative().optional(),
  acceptedOnly: z.boolean().default(true),
  /** Page size. The Data Pool applies OBSERVATION_QUERY_DEFAULT_LIMIT when omitted. */
  limit: z.number().int().min(1).max(OBSERVATION_QUERY_MAX_LIMIT).optional(),
  offset: z.number().int().nonnegative().optional(),
})

export type ObservationQuality = z.infer<typeof observationQualitySchema>
export type ObservationValue = z.infer<typeof observationValueSchema>
export type ObservationQuery = z.infer<typeof observationQuerySchema>
