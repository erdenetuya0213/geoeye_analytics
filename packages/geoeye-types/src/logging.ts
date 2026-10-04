import { z } from 'zod'

export const fieldLoggingTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  version: z.number().int().positive(),
})

export const fieldLoggingSubmissionSchema = z.object({
  projectId: z.string().uuid(),
  holeId: z.string().uuid(),
  holeName: z.string().min(1),
  templateId: z.string().uuid(),
  templateName: z.string().min(1),
  templateVersion: z.number().int().positive(),
  depthFrom: z.number().nonnegative().nullable(),
  depthTo: z.number().nonnegative().nullable(),
  selectedRowCount: z.number().int().nonnegative(),
  intervalCount: z.number().int().nonnegative(),
  structureCount: z.number().int().nonnegative(),
  generatedLogCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime().nullable(),
})

export const fieldLoggingColumnSchema = z.object({
  dataType: z.enum(['numeric', 'category', 'text', 'boolean', 'datetime']),
  key: z.string().min(1),
  label: z.string().min(1),
  unit: z.string().min(1).nullable(),
})

const fieldLoggingCellSchema = z.union([
  z.number().finite(),
  z.string(),
  z.boolean(),
  z.null(),
])

export const fieldLoggingRecordSchema = z.object({
  depthFrom: z.number().nonnegative().nullable(),
  depthTo: z.number().nonnegative().nullable(),
  holeId: z.string().uuid().nullable(),
  id: z.string().min(1),
  values: z.record(z.string(), fieldLoggingCellSchema),
})

/**
 * A database-backed, tabular view of one Field logging template. Field IDs are
 * kept verbatim so analytical tools can require explicit, exact column maps.
 */
export const fieldLoggingDatasetSchema = z.object({
  category: z.string().min(1).nullable(),
  columns: z.array(fieldLoggingColumnSchema),
  id: z.string().min(1),
  name: z.string().min(1),
  records: z.array(fieldLoggingRecordSchema),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive(),
})

export const fieldLoggingOverviewSchema = z.object({
  datasets: z.array(fieldLoggingDatasetSchema).optional(),
  projectId: z.string().uuid(),
  templates: z.array(fieldLoggingTemplateSchema),
  submissions: z.array(fieldLoggingSubmissionSchema),
})

/**
 * A source structural-log row normalized just enough for Structure Analysis.
 * Draft rows are intentionally included: this workspace is where Alpha/Beta
 * observations are reviewed and converted, not a consumer of accepted results.
 */
export const fieldLoggingStructureSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  holeId: z.string().uuid().nullable(),
  templateId: z.string().uuid().nullable(),
  depthFrom: z.number().nonnegative().nullable(),
  depthTo: z.number().nonnegative().nullable(),
  alpha: z.number().finite().nullable(),
  beta: z.number().finite().nullable(),
  structureType: z.string().nullable(),
  orientationStatus: z.string().nullable(),
  reviewStatus: z.enum(['draft', 'accepted', 'flagged']),
})

export type FieldLoggingTemplate = z.infer<typeof fieldLoggingTemplateSchema>
export type FieldLoggingSubmission = z.infer<typeof fieldLoggingSubmissionSchema>
export type FieldLoggingOverview = z.infer<typeof fieldLoggingOverviewSchema>
export type FieldLoggingColumn = z.infer<typeof fieldLoggingColumnSchema>
export type FieldLoggingDataset = z.infer<typeof fieldLoggingDatasetSchema>
export type FieldLoggingRecord = z.infer<typeof fieldLoggingRecordSchema>
export type FieldLoggingStructure = z.infer<typeof fieldLoggingStructureSchema>
