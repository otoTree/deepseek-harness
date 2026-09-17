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
  /** Provider wire protocol selected by the platform directory. */
  protocol: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']).default('openai-completions'),
  /** Provider input capabilities; text is always present for the current gateway. */
  inputModalities: z.array(z.enum(['text', 'image', 'video', 'audio', 'document'])).min(1).default(['text']),
  /** Whether video input is interpreted as frames only or frames plus its embedded audio track. */
  videoAudioMode: z.enum(['visual-only', 'visual-and-audio']).default('visual-only'),
  /** File handling policy reserved for provider Files API integrations. */
  fileInputPolicy: z.enum(['unsupported', 'inline', 'provider-files']).default('unsupported'),
  maxFileBytes: z.number().int().positive().default(10 * 1024 * 1024),
  maxRequestBytes: z.number().int().positive().default(32 * 1024 * 1024),
  filesTtlSeconds: z.number().int().positive().default(7 * 24 * 60 * 60),
  fileUploadTimeoutMs: z.number().int().positive().default(120_000),
  fileUploadMaxRetries: z.number().int().nonnegative().default(1),
  fileRefreshMarginSeconds: z.number().int().nonnegative().default(60),
  fileQuotaCleanupBatch: z.number().int().nonnegative().default(0),
  modelCallTimeoutMs: z.number().int().positive().default(300_000),
  contextTokens: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
}).strict())
export const modelCall = z.looseObject({
  /** Legacy platform model resource location. */
  model: resourceId.optional(), runtimeId: resourceId,
  /** Platform model resource used for routing; separate from the upstream body model name. */
  modelId: resourceId.optional(),
  /** Exact path on the configured upstream; no endpoint suffix is injected. */
  path: z.string().min(1).max(4096).regex(/^\/(?!\/)/).optional(),
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE', 'GET']).default('POST'),
  /** Optional OpenAI-compatible body. Unknown fields are deliberately retained. */
  body: z.record(z.string(), z.json()).optional(),
  /** Headers are forwarded except hop-by-hop fields and Authorization. */
  headers: z.record(z.string(), z.string()).optional(),
  policyRevision: z.number().int().positive().optional(),
  purpose: z.enum(['chat', 'subagent', 'compaction', 'title', 'plugin_review']).default('chat'),
  /** Normalized, non-secret request dimensions used for usage reporting. */
  inputModalities: z.array(z.enum(['text', 'image', 'video', 'audio', 'document'])).min(1).max(5).default(['text']),
  fileUsage: z.object({
    uploads: z.number().int().nonnegative().default(0),
    uploadedBytes: z.number().int().nonnegative().default(0),
    failures: z.number().int().nonnegative().default(0),
  }).strict().default({ uploads: 0, uploadedBytes: 0, failures: 0 }),
}).superRefine((value, context) => {
  if (value.model === undefined && value.modelId === undefined) {
    context.addIssue({ code: 'custom', path: ['modelId'], message: 'A platform model ID is required' })
  }
  if (!value.inputModalities.includes('text')) {
    context.addIssue({ code: 'custom', path: ['inputModalities'], message: 'Text modality is required' })
  }
})
/** One attachment uploaded through the enterprise gateway to a provider Files API. */
export const modelFileUpload = z.object({
  modelId: resourceId,
  runtimeId: resourceId,
  policyRevision: z.number().int().positive(),
  attachmentId: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  name: z.string().min(1).max(255).refine(value => !/[\\/\u0000-\u001f\u007f]/.test(value), 'Invalid file name'),
  mediaType: z.string().regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i).max(200),
  data: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  /** Exact cached generation rejected by the model endpoint, when replacing it once. */
  replaceFileId: z.string().min(1).max(512).optional(),
}).strict()
export const modelFileReceipt = z.object({
  fileId: z.string().min(1).max(512),
  expiresAt: z.iso.datetime(),
  uploaded: z.boolean().default(true),
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
/** Maximum model context and output capacities accepted by the platform directory. */
export const MAX_MODEL_TOKENS = 2_000_000
/** Maximum CNY price accepted for one million tokens. */
export const MAX_MODEL_PRICE_CNY_PER_MILLION = 1_000_000
export const modelPriceCny = z.number().min(0).max(MAX_MODEL_PRICE_CNY_PER_MILLION)
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
    inputPriceCnyPerMillion: modelPriceCny,
    cachedInputPriceCnyPerMillion: modelPriceCny,
    outputPriceCnyPerMillion: modelPriceCny,
    maxOutputTokens: z.number().int().min(1).max(MAX_MODEL_TOKENS),
    contextTokens: z.number().int().min(1024).max(MAX_MODEL_TOKENS),
    images: z.boolean().default(false),
    protocol: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']).default('openai-completions'),
    inputModalities: z.array(z.enum(['text', 'image', 'video', 'audio', 'document'])).min(1).max(5).default(['text']),
    videoAudioMode: z.enum(['visual-only', 'visual-and-audio']).default('visual-only'),
    fileInputPolicy: z.enum(['unsupported', 'inline', 'provider-files']).default('unsupported'),
    maxFileBytes: z.number().int().min(1).max(512 * 1024 * 1024).default(10 * 1024 * 1024),
    maxRequestBytes: z.number().int().min(1).max(512 * 1024 * 1024).default(32 * 1024 * 1024),
    filesTtlSeconds: z.number().int().min(60).max(30 * 24 * 60 * 60).default(7 * 24 * 60 * 60),
    fileUploadTimeoutMs: z.number().int().min(1_000).max(10 * 60 * 1_000).default(120_000),
    fileUploadMaxRetries: z.number().int().min(0).max(10).default(1),
    fileRefreshMarginSeconds: z.number().int().min(0).max(30 * 24 * 60 * 60).default(60),
    fileQuotaCleanupBatch: z.number().int().min(0).max(10_000).default(0),
    modelCallTimeoutMs: z.number().int().min(1_000).max(30 * 60 * 1_000).default(300_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.inputModalities.includes('text')) context.addIssue({ code: 'custom', path: ['inputModalities'], message: 'Text modality is required' })
    if (value.videoAudioMode === 'visual-and-audio' && !value.inputModalities.includes('video')) {
      context.addIssue({ code: 'custom', path: ['videoAudioMode'], message: 'Video audio understanding requires video input' })
    }
    if (value.maxRequestBytes < value.maxFileBytes) context.addIssue({ code: 'custom', path: ['maxRequestBytes'], message: 'Request limit must include one maximum-size file' })
    if (value.fileRefreshMarginSeconds >= value.filesTtlSeconds) context.addIssue({ code: 'custom', path: ['fileRefreshMarginSeconds'], message: 'Refresh margin must be shorter than provider file lifetime' })
    if (value.inputModalities.some(modality => !['text', 'image'].includes(modality)) && value.fileInputPolicy === 'unsupported') {
      context.addIssue({ code: 'custom', path: ['fileInputPolicy'], message: 'Native file modalities require a file input policy' })
    }
  })
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
