import { z } from 'zod'
import { spatialSupportSchema } from './variable.js'

export const datasetStatusSchema = z.enum(['active', 'archived'])

export const datasetSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  producerType: z.enum(['field', 'laboratory', 'instrument', 'analytics', 'external']),
  producerName: z.string().min(1),
  sourceSystem: z.string().nullable(),
  spatialSupport: spatialSupportSchema,
  status: datasetStatusSchema,
  currentVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const datasetVersionSchema = z.object({
  id: z.string().uuid(),
  datasetId: z.string().uuid(),
  version: z.number().int().positive(),
  contentHash: z.string().min(1).nullable(),
  recordCount: z.number().int().nonnegative(),
  schema: z.record(z.unknown()),
  sourceObjectKey: z.string().nullable(),
  snapshotAt: z.string().datetime(),
})

export type DatasetStatus = z.infer<typeof datasetStatusSchema>
export type Dataset = z.infer<typeof datasetSchema>
export type DatasetVersion = z.infer<typeof datasetVersionSchema>

