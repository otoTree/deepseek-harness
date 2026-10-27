/** Presentation-only catalog for a trusted original Session's project. */
import { z } from 'zod'

export const sessionCatalogRequestSchema = z.strictObject({ version: z.literal(1), sessionId: z.string().min(1).max(256) })
const selection = z.strictObject({ provider: z.literal('arivo'), model: z.string().min(1).max(256) })
export const sessionCatalogSchema = z.strictObject({
  default: selection,
  routableProviders: z.array(z.literal('arivo')).length(1),
  groups: z.array(z.strictObject({ id: z.literal('arivo'), name: z.literal('Arivo'),
    models: z.array(z.strictObject({ id: z.string().min(1).max(256), name: z.string().min(1).max(1000),
      inputModalities: z.array(z.literal('text')).length(1) })).max(10000),
  })).length(1),
  failures: z.array(z.never()).length(0),
}).nullable()
