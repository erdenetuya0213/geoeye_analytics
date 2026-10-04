import {
  analysisResultPackageQuerySchema,
  collarInputSchema,
  derivedValueInputSchema,
  loginInputSchema,
  replaceSurveysInputSchema,
  saveAnalysisResultPackageInputSchema,
  saveProjectionBindingsInputSchema,
  tabularImportInputSchema,
} from '@geoeye/types'
import { z } from 'zod'

export const projectIdQuerySchema = z.object({
  projectId: z.string().uuid(),
})

export const createAnalysisRunSchema = z.object({
  projectId: z.string().uuid(),
  analysisType: z.string().trim().min(1),
  algorithmVersion: z.string().trim().min(1),
  datasetSnapshot: z.record(z.unknown()),
  parameters: z.record(z.unknown()),
})

export const derivedValuesBodySchema = z.object({
  values: z.array(derivedValueInputSchema).min(1),
})

export const optionalProjectIdQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
})

export const projectionRunBodySchema = z.object({
  force: z.boolean().default(false),
})

export const loginBodySchema = loginInputSchema
export const uuidPathParameterSchema = z.string().uuid()
export const collarBodySchema = collarInputSchema
export const surveysBodySchema = replaceSurveysInputSchema
export const tabularImportBodySchema = tabularImportInputSchema
export const projectionBindingsBodySchema = saveProjectionBindingsInputSchema
export const analysisResultPackageBodySchema = saveAnalysisResultPackageInputSchema
export const analysisResultPackagesQuerySchema = analysisResultPackageQuerySchema

export type CreateAnalysisRunInput = z.infer<typeof createAnalysisRunSchema>
