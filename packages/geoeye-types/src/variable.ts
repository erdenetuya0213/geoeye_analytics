import { z } from 'zod'

export const variableDataTypeSchema = z.enum([
  'numeric',
  'text',
  'category',
  'boolean',
  'datetime',
])

export const variableOriginSchema = z.enum([
  'primary',
  'integrated',
  'derived',
  'interpreted',
])

export const spatialSupportSchema = z.enum([
  'point',
  'interval',
  'orientation',
  'raster',
  'none',
])

export const variableDefinitionSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'Use a namespaced lower-case key'),
  displayName: z.string().min(1),
  description: z.string().min(1),
  dataType: variableDataTypeSchema,
  canonicalUnit: z.string().min(1).nullable(),
  origin: variableOriginSchema,
  spatialSupport: spatialSupportSchema,
  compatibleAnalyses: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).optional(),
})

export type VariableDataType = z.infer<typeof variableDataTypeSchema>
export type VariableOrigin = z.infer<typeof variableOriginSchema>
export type SpatialSupport = z.infer<typeof spatialSupportSchema>
export type VariableDefinition = z.infer<typeof variableDefinitionSchema>
