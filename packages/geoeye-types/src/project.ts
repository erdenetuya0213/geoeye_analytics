import { z } from 'zod'

/** Shared Data Pool project identity. Field owns creation; Analytics reads it. */
export const projectSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  isActive: z.boolean(),
  drillholeCount: z.number().int().nonnegative(),
  /** The tenant that owns the project. Older Field projects may have none. */
  organizationId: z.string().uuid().nullable(),
  organizationName: z.string().nullable(),
  /** False when the signed-in user may only read this project. */
  canWrite: z.boolean(),
})

export const crsReferenceSchema = z.object({
  authority: z.string().trim().min(1).max(40),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200).optional(),
})

export const collarInputSchema = z.object({
  easting: z.number().finite(),
  northing: z.number().finite(),
  elevation: z.number().finite(),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  crs: crsReferenceSchema,
  surveyMethod: z.string().trim().min(1).nullable().default(null),
  accuracy: z.number().nonnegative().nullable().default(null),
  source: z.string().trim().min(1),
})

export const collarSchema = z.object({
  easting: z.number().finite(),
  northing: z.number().finite(),
  elevation: z.number().finite(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  crs: z.object({
    authority: z.string().min(1),
    code: z.string().min(1),
    name: z.string().min(1),
  }),
  surveyMethod: z.string().nullable(),
  accuracy: z.number().nullable(),
  source: z.string().min(1),
  updatedAt: z.string().datetime(),
})

export const surveyStationInputSchema = z.object({
  measuredDepth: z.number().nonnegative(),
  azimuth: z.number().min(0).lt(360),
  dip: z.number().min(-90).max(90),
  surveyMethod: z.string().trim().min(1).nullable().default(null),
  tool: z.string().trim().min(1).nullable().default(null),
  accuracy: z.number().nonnegative().nullable().default(null),
  source: z.string().trim().min(1),
  surveyedAt: z.string().datetime().nullable().default(null),
})

export const surveyStationSchema = z.object({
  id: z.string().uuid(),
  measuredDepth: z.number().nonnegative(),
  azimuth: z.number(),
  dip: z.number(),
  surveyMethod: z.string().nullable(),
  tool: z.string().nullable(),
  accuracy: z.number().nullable(),
  source: z.string().min(1),
  surveyedAt: z.string().datetime().nullable(),
})

/** A full replacement of the downhole survey of one drillhole. */
export const replaceSurveysInputSchema = z
  .object({ stations: z.array(surveyStationInputSchema).max(20_000) })
  .superRefine((value, context) => {
    const seen = new Set<number>()
    value.stations.forEach((station, index) => {
      if (seen.has(station.measuredDepth)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'measuredDepth must be unique within a drillhole survey',
          path: ['stations', index, 'measuredDepth'],
        })
      }
      seen.add(station.measuredDepth)
    })
  })

export const drillholeSummarySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1),
  collar: collarSchema.nullable(),
  surveyStationCount: z.number().int().nonnegative(),
})

export type ProjectSummary = z.infer<typeof projectSummarySchema>
export type CrsReference = z.infer<typeof crsReferenceSchema>
export type CollarInput = z.infer<typeof collarInputSchema>
export type Collar = z.infer<typeof collarSchema>
export type SurveyStationInput = z.infer<typeof surveyStationInputSchema>
export type SurveyStation = z.infer<typeof surveyStationSchema>
export type ReplaceSurveysInput = z.infer<typeof replaceSurveysInputSchema>
export type DrillholeSummary = z.infer<typeof drillholeSummarySchema>
