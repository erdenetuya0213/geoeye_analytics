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

export const fieldLoggingOverviewSchema = z.object({
  projectId: z.string().uuid(),
  templates: z.array(fieldLoggingTemplateSchema),
  submissions: z.array(fieldLoggingSubmissionSchema),
})

export type FieldLoggingTemplate = z.infer<typeof fieldLoggingTemplateSchema>
export type FieldLoggingSubmission = z.infer<typeof fieldLoggingSubmissionSchema>
export type FieldLoggingOverview = z.infer<typeof fieldLoggingOverviewSchema>
