/** Versioned, credential-free model controls shared by the startup Host and Client. */
import { z } from 'zod'

const id = z.uuid().brand<'ArivoCloudId'>()
const cursor = z.string().min(1).max(4096).optional()
const version = z.literal(1)
const scope = { cloudWorkspaceId: id, cloudProjectId: id }
const named = z.object({ id, name: z.string().min(1).max(1000) }).strict()

/** Browser operations are read-only except for an explicitly selected default route. */
export const modelRequestSchema = z.discriminatedUnion('type', [
  z.object({ version, type: z.literal('state') }).strict(),
  z.object({ version, type: z.literal('workspaces'), cursor }).strict(),
  z.object({ version, type: z.literal('projects'), cloudWorkspaceId: id, cursor }).strict(),
  z.object({ version, type: z.literal('models'), ...scope, cursor }).strict(),
  z.object({ version, type: z.literal('select'), ...scope, adapterId: id }).strict(),
])

/** Safe catalog pages and durable default-selection status, never credentials or Provider configuration. */
export const modelResponseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), configured: z.boolean() }).strict(),
  z.object({ type: z.literal('workspaces'), items: z.array(named).max(100), nextCursor: cursor.unwrap().nullable() }).strict(),
  z.object({ type: z.literal('projects'), items: z.array(named).max(100), nextCursor: cursor.unwrap().nullable() }).strict(),
  z.object({ type: z.literal('models'), items: z.array(named).max(100), nextCursor: cursor.unwrap().nullable() }).strict(),
])

/** Parsed local RPC operation; cloud IDs are validated and opaque. */
export type ArivoModelRequest = z.infer<typeof modelRequestSchema>
/** Parsed local RPC result for product controls. */
export type ArivoModelResponse = z.infer<typeof modelResponseSchema>
