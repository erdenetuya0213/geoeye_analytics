import { z } from 'zod'

export const analysisRunStatusSchema = z.enum([
  'draft',
  'running',
  'saved',
  'accepted',
  'failed',
  'cancelled',
  'superseded',
])

export const analysisRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  analysisType: z.string().min(1),
  algorithmVersion: z.string().min(1),
  datasetSnapshot: z.record(z.unknown()),
  parameters: z.record(z.unknown()),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  status: analysisRunStatusSchema,
})

export const derivedValueStatusSchema = z.enum(['draft', 'saved', 'accepted', 'superseded'])
export const analysisFeatureSchema = z.enum(['structure', 'geotechnical', 'multivariate', 'domain'])
export const analysisSaveModeSchema = z.enum(['overwrite', 'new-version'])

export const analysisResultArtifactInputSchema = z.object({
  boreholeId: z.string().uuid().nullable(),
  artifactType: z.enum(['analysis_file', 'graph_image']),
  objectKey: z.string().trim().min(1),
  fileName: z.string().trim().min(1).regex(/^[^/\\]+$/, 'fileName must not contain path separators'),
  mediaType: z.enum(['application/json', 'image/png']),
  byteSize: z.number().int().nonnegative().nullable().default(null),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
})

export const saveAnalysisResultPackageInputSchema = z.object({
  tenantKey: z.string().trim().regex(/^[A-Za-z0-9._-]+$/, 'tenantKey must be a stable path segment'),
  projectId: z.string().uuid(),
  datasetId: z.string().uuid(),
  analysisRunId: z.string().uuid(),
  feature: analysisFeatureSchema,
  mode: analysisSaveModeSchema,
  fallbackTemplateVersion: z.number().int().positive(),
  sourceFileName: z.string().trim().min(1),
  inputName: z.string().trim().min(1),
  analysisFileKey: z.string().trim().min(1),
  derivedFieldKeys: z.array(z.string().trim().min(1)),
  metadata: z.record(z.unknown()).default({}),
  artifacts: z.array(analysisResultArtifactInputSchema).min(1),
}).superRefine((value, context) => {
  const analysisFiles = value.artifacts.filter((artifact) => artifact.artifactType === 'analysis_file')
  if (analysisFiles.length !== 1 || analysisFiles[0]?.objectKey !== value.analysisFileKey) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Exactly one analysis_file artifact must match analysisFileKey',
      path: ['artifacts'],
    })
  }
  value.artifacts.forEach((artifact, index) => {
    const validMediaType = artifact.artifactType === 'analysis_file'
      ? artifact.mediaType === 'application/json'
      : artifact.mediaType === 'image/png'
    if (!validMediaType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${artifact.artifactType} uses an incompatible mediaType`,
        path: ['artifacts', index, 'mediaType'],
      })
    }
  })
})

export const savedAnalysisResultPackageSchema = z.object({
  id: z.string().uuid(),
  tenantKey: z.string(),
  projectId: z.string().uuid(),
  datasetId: z.string().uuid(),
  analysisRunId: z.string().uuid(),
  feature: analysisFeatureSchema,
  templateVersion: z.number().int().positive(),
  sourceFileName: z.string(),
  inputName: z.string(),
  analysisFileKey: z.string(),
  derivedFieldKeys: z.array(z.string()),
  artifactIds: z.array(z.string().uuid()),
  createdAt: z.string().datetime(),
})

export const analysisResultPackageQuerySchema = z.object({
  tenantKey: z.string().trim().regex(/^[A-Za-z0-9._-]+$/, 'tenantKey must be a stable path segment'),
  projectId: z.string().uuid(),
  datasetId: z.string().uuid().optional(),
  boreholeId: z.string().uuid().optional(),
  feature: analysisFeatureSchema.optional(),
})

export const savedAnalysisResultArtifactSchema = analysisResultArtifactInputSchema.extend({
  id: z.string().uuid(),
})

export const analysisResultPackageRecordSchema = savedAnalysisResultPackageSchema.extend({
  artifacts: z.array(savedAnalysisResultArtifactSchema),
})

export const derivedValueInputSchema = z
  .object({
    variableKey: z.string().min(1),
    sourceEntityType: z.string().min(1),
    sourceEntityId: z.string().min(1),
    holeId: z.string().uuid().nullable(),
    depthFrom: z.number().nonnegative().nullable(),
    depthTo: z.number().nonnegative().nullable(),
    numericValue: z.number().finite().nullable().default(null),
    textValue: z.string().nullable().default(null),
    categoryValue: z.string().nullable().default(null),
    confidence: z.number().min(0).max(1).nullable(),
    status: derivedValueStatusSchema.default('draft'),
    inputObservationIds: z.array(z.string().uuid()).min(1),
  })
  .superRefine((value, context) => {
    const populated = [value.numericValue, value.textValue, value.categoryValue].filter(
      (item) => item !== null,
    )
    if (populated.length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Exactly one derived value must be provided',
      })
    }
  })

export type AnalysisRunStatus = z.infer<typeof analysisRunStatusSchema>
export type AnalysisRun = z.infer<typeof analysisRunSchema>
export type DerivedValueStatus = z.infer<typeof derivedValueStatusSchema>
export type DerivedValueInput = z.infer<typeof derivedValueInputSchema>
export type AnalysisFeature = z.infer<typeof analysisFeatureSchema>
export type AnalysisSaveMode = z.infer<typeof analysisSaveModeSchema>
export type AnalysisResultArtifactInput = z.infer<typeof analysisResultArtifactInputSchema>
export type SaveAnalysisResultPackageInput = z.infer<typeof saveAnalysisResultPackageInputSchema>
export type SavedAnalysisResultPackage = z.infer<typeof savedAnalysisResultPackageSchema>
export type AnalysisResultPackageQuery = z.infer<typeof analysisResultPackageQuerySchema>
export type SavedAnalysisResultArtifact = z.infer<typeof savedAnalysisResultArtifactSchema>
export type AnalysisResultPackageRecord = z.infer<typeof analysisResultPackageRecordSchema>
