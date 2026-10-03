import { z } from 'zod'
import type { DerivedValueInput } from '@geoeye/types'

export const analysisJobSchema = z.object({
  runId: z.string().uuid(),
  projectId: z.string().uuid(),
  analysisType: z.string().min(1),
  algorithmVersion: z.string().min(1),
  datasetSnapshot: z.record(z.unknown()),
  parameters: z.record(z.unknown()),
  workspacePath: z.string().min(1),
})

export const jobStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('queued'), progress: z.literal(0) }),
  z.object({
    state: z.literal('running'),
    progress: z.number().min(0).max(1),
    message: z.string().optional(),
  }),
  z.object({ state: z.literal('succeeded'), progress: z.literal(1) }),
  z.object({ state: z.literal('failed'), progress: z.number().min(0).max(1), error: z.string() }),
  z.object({ state: z.literal('cancelled'), progress: z.number().min(0).max(1) }),
])

export interface AnalysisResult {
  runId: string
  derivedValues: DerivedValueInput[]
  artifacts: Array<{
    kind: string
    objectKey: string
    mediaType: string
  }>
  diagnostics: Record<string, unknown>
}

export type AnalysisJob = z.infer<typeof analysisJobSchema>
export type JobStatus = z.infer<typeof jobStatusSchema>
export type JobId = string

export interface ExecutionBackend {
  submit(job: AnalysisJob): Promise<JobId>
  status(jobId: JobId): Promise<JobStatus>
  cancel(jobId: JobId): Promise<void>
  result(jobId: JobId): Promise<AnalysisResult>
}

