import { z } from 'zod'

export const coordinateReferenceSystemSchema = z.object({
  id: z.string().uuid(),
  authority: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  wkt: z.string().nullable(),
})

export const drillholeCollarSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  holeId: z.string().uuid(),
  easting: z.number().finite(),
  northing: z.number().finite(),
  elevation: z.number().finite(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  crsId: z.string().uuid(),
  surveyMethod: z.string().nullable(),
  accuracy: z.number().nonnegative().nullable(),
  source: z.string().min(1),
})

export const drillholeSurveySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  holeId: z.string().uuid(),
  measuredDepth: z.number().nonnegative(),
  azimuth: z.number().min(0).lt(360),
  dip: z.number().min(-90).max(90),
  surveyMethod: z.string().nullable(),
  tool: z.string().nullable(),
  accuracy: z.number().nonnegative().nullable(),
  source: z.string().min(1),
  surveyedAt: z.string().datetime().nullable(),
})

export type CoordinateReferenceSystem = z.infer<typeof coordinateReferenceSystemSchema>
export type DrillholeCollar = z.infer<typeof drillholeCollarSchema>
export type DrillholeSurvey = z.infer<typeof drillholeSurveySchema>

