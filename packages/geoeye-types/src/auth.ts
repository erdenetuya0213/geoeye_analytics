import { z } from 'zod'

/** Sign-in with a GeoEye account. Accounts are shared with GeoEye Field. */
export const loginInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(1024),
})

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().min(1),
  displayName: z.string().min(1),
  role: z.string().min(1),
  isPlatformAdmin: z.boolean(),
})

/** A tenant the user belongs to. Projects are grouped under organizations. */
export const organizationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().nullable(),
  role: z.string().nullable(),
})

export const sessionSchema = z.object({
  user: sessionUserSchema,
  organizations: z.array(organizationSummarySchema),
})

export const loginResultSchema = sessionSchema.extend({
  accessToken: z.string().min(1),
  tokenType: z.literal('bearer'),
  expiresAt: z.string().datetime(),
})

export type LoginInput = z.infer<typeof loginInputSchema>
export type SessionUser = z.infer<typeof sessionUserSchema>
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>
export type Session = z.infer<typeof sessionSchema>
export type LoginResult = z.infer<typeof loginResultSchema>
