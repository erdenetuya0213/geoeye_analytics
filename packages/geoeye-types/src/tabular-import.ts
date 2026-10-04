import { z } from 'zod'
import { datasetSchema } from './dataset.js'

export const tabularImportSectionSchema = z.enum(['laboratory', 'strength', 'xrf', 'spectral'])

export const tabularImportInputSchema = z.object({
  columns: z.array(z.string().trim().min(1)).min(1).max(100),
  fileName: z.string().trim().min(1).max(255),
  rows: z.array(z.array(z.string()).min(1).max(100)).min(1).max(20_000),
  section: tabularImportSectionSchema,
}).superRefine((value, context) => {
  const normalized = value.columns.map((column) => column.toLocaleLowerCase())
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'CSV column names must be unique', path: ['columns'] })
  }
  value.rows.forEach((row, index) => {
    if (row.length !== value.columns.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Every CSV row must match the header width', path: ['rows', index] })
    }
  })
})

export const tabularImportResultSchema = z.object({
  dataset: datasetSchema,
  importedRows: z.number().int().nonnegative(),
  observationCount: z.number().int().nonnegative(),
  unmatchedHoles: z.array(z.string()),
  version: z.number().int().positive(),
})

export type TabularImportInput = z.infer<typeof tabularImportInputSchema>
export type TabularImportResult = z.infer<typeof tabularImportResultSchema>
export type TabularImportSection = z.infer<typeof tabularImportSectionSchema>
