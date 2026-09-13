/** Validated enterprise wire records; resource IDs are opaque to clients. */
import { z } from 'zod'

export const accountId = z.string().min(1).max(128).brand<'AccountId'>()
export const organizationId = z.uuid().brand<'OrganizationId'>()
export const resourceId = z.uuid().brand<'ResourceId'>()
export const sessionId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).brand<'SessionId'>()
export const sessionHeader = z.object({
  id: sessionId, version: z.literal(2), createdAt: z.number().int().nonnegative(), isSeeded: z.boolean(),
  cwd: z.string().regex(/^(?:\/|[A-Za-z]:[\\/])/).optional(), parentSession: sessionId.optional(),
  origin: z.literal('subagent').optional(), delegationDepth: z.number().int().nonnegative().optional(),
  agentPreset: z.string().optional(),
}).strict()
export const sessionEvent = z.object({
  seq: z.number().int().nonnegative(), type: z.string().min(1).max(200),
  time: z.number().int().nonnegative(), data: z.json(), ignorable: z.literal(true).optional(),
  sourceEventSeqs: z.array(z.number().int().nonnegative()).optional(), surfaceOp: z.json().optional(),
}).strict()
export const sessionCreate = z.object({
  id: sessionId, header: sessionHeader, inheritedEventCount: z.number().int().nonnegative().default(0),
  writer: resourceId.optional(),
}).strict().refine(value => value.id === value.header.id && (value.header.isSeeded || value.inheritedEventCount === 0), 'Invalid session metadata')
export const sessionMetadata = z.object({
  id: sessionId, header: sessionHeader, inheritedEventCount: z.number().int().nonnegative(), nextSeq: z.number().int().nonnegative(),
}).strict()
export const sessionPage = sessionMetadata.extend({ events: z.array(sessionEvent).max(500) })
export const sessionLease = z.object({ writer: resourceId, leaseUntil: z.iso.datetime(), nextSeq: z.number().int().nonnegative() }).strict()
export const sessionAppend = z.object({ writer: resourceId, events: z.array(sessionEvent).min(1).max(500) }).strict()
export const desktopAuthorization = z.object({
  organizationId,
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  callback: z.url(),
  state: z.string().min(32).max(128),
}).strict()
export const desktopTokenRequest = z.object({
  code: z.string().min(32).max(128),
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
}).strict()
export const desktopCredential = z.object({
  runtimeId: resourceId,
  token: z.string().min(32).max(200),
  leaseUntil: z.iso.datetime(),
  organizationId,
}).strict()
export const runtimeHeartbeat = z.object({ leaseUntil: z.iso.datetime(), policyRevision: z.number().int().positive() }).strict()
export const modelCatalog = z.array(z.object({
  id: resourceId, name: z.string().min(1), images: z.boolean(),
  contextTokens: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
}).strict())
export const modelCall = z.object({
  model: resourceId, runtimeId: resourceId,
  policyRevision: z.number().int().positive().optional(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.union([z.string(), z.array(z.json()), z.null()]).optional(),
    tool_calls: z.array(z.json()).optional(), tool_call_id: z.string().optional(),
    reasoning_content: z.string().optional(), name: z.string().optional(),
  }).strict()).min(1).max(1000),
  tools: z.array(z.json()).max(128).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  stop: z.array(z.string()).min(1).max(4).optional(),
  purpose: z.enum(['chat', 'subagent', 'compaction', 'title', 'plugin_review']).default('chat'),
}).strict()
export const modelStreamChunk = z.object({
  choices: z.array(z.object({
    index: z.literal(0),
    delta: z.object({
      content: z.string().nullable().optional(), reasoning_content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({
        index: z.number().int().nonnegative(), id: z.string().nullable().optional(),
        function: z.object({ name: z.string().nullable().optional(), arguments: z.string().optional() }).optional(),
      })).optional(),
    }).optional(),
    finish_reason: z.string().nullable().optional(),
  })).max(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(),
    prompt_cache_hit_tokens: z.number().int().nonnegative().optional(),
    prompt_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative().optional() }).optional(),
    completion_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative().optional() }).optional(),
  }).nullable().optional(),
})
export const role = z.enum([
  'owner',
  'administrator',
  'member',
  'security_reviewer',
  'plugin_publisher',
  'finance_auditor',
])
export const registrationPolicy = z.enum(['open', 'domain_restricted', 'invite_only', 'disabled'])
export const workspaceMode = z.enum(['read-only', 'workspace-write', 'danger-full-access'])
export const createOrganization = z.object({ name: z.string().trim().min(1).max(120) }).strict()
export const createUnit = z
  .object({
    name: z.string().trim().min(1).max(120),
    parentId: resourceId,
    unitType: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  })
  .strict()
export const inviteMember = z
  .object({
    email: z.email().toLowerCase(),
    role: role.exclude(['owner']).default('member'),
    unitId: resourceId.optional(),
  })
  .strict()
export const modelInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    baseUrl: z.url(),
    upstreamModel: z.string().min(1).max(200),
    apiKey: z.string().min(1).max(4096),
    inputMicrosPerMillion: z.number().int().min(0).max(1_000_000_000),
    outputMicrosPerMillion: z.number().int().min(0).max(1_000_000_000),
    maxOutputTokens: z.number().int().min(1).max(131072),
    contextTokens: z.number().int().min(1024).max(2_000_000),
    images: z.boolean().default(false),
  })
  .strict()
export const runtimeInput = z
  .object({
    name: z.string().min(1).max(120),
    type: z.enum(['browser', 'desktop']),
    version: z.string().min(1).max(40),
    capabilities: z.array(z.string().max(80)).max(80),
  })
  .strict()
export const pluginManifest = z
  .object({
    pluginId: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    targets: z
      .array(z.enum(['browser', 'desktop', 'cloud']))
      .min(1)
      .max(2),
    permissions: z.array(z.string().max(120)).max(80),
    tools: z
      .array(
        z
          .object({
            name: z.string().max(80),
            description: z.string().max(2000),
            inputSchema: z.record(z.string(), z.json()),
          })
          .strict(),
      )
      .max(40),
  })
  .strict()
export const pluginSubmission = z
  .object({
    manifest: pluginManifest,
    hostCode: z.string().max(256000).optional(),
    clientCode: z.string().max(256000).optional(),
    lockfile: z.string().max(512000).optional(),
  })
  .strict()
  .refine(v => Boolean(v.hostCode || v.clientCode), 'At least one code target is required')
export const aiReview = z
  .object({
    verdict: z.enum(['pass', 'reject']),
    summary: z.string().min(1).max(4000),
    findings: z
      .array(z.object({ severity: z.enum(['info', 'warning', 'blocker']), message: z.string().max(2000) }).strict())
      .max(100),
  })
  .strict()
export type AccountId = z.infer<typeof accountId>
export type OrganizationId = z.infer<typeof organizationId>
export type ResourceId = z.infer<typeof resourceId>
export type Role = z.infer<typeof role>
