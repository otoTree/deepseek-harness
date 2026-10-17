/** Versioned media-operation configuration, provider decoding, and integer CNY pricing. */
import { roundMicrosCny } from './model-money.ts'
import { z } from 'zod'

export const operationSchema = z.enum(['embedding.create', 'image.generate', 'video.generate', 'audio.synthesize', 'audio.transcribe'])
const pathSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,240}$/u)
const amountSchema = z.string().regex(/^\d{1,12}$/u)
const scalarSchema = z.union([z.string(), z.number(), z.boolean()])
const parameterSchema = z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean', 'array', 'object']),
  required: z.boolean().default(false), label: z.string().max(120).optional(),
  default: z.unknown().optional(), minimum: z.number().optional(), maximum: z.number().optional(),
  values: z.array(scalarSchema).max(100).optional(), specialValues: z.array(scalarSchema).max(16).default([]),
}).strict().refine(rule => rule.minimum === undefined || rule.maximum === undefined || rule.minimum <= rule.maximum,
  'Invalid parameter range')
const mappingSchema = z.object({
  method: z.enum(['GET', 'POST']).default('POST'), path: z.string().min(1).max(500),
  headers: z.record(z.string(), z.string()).default({}), body: z.record(z.string(), z.unknown()).default({}),
}).strict()
export const usageUnitSchema = z.enum(['token', 'image', 'second', 'character', 'request'])
export const finalStates = new Set(['succeeded', 'failed', 'cancelled'])
export const taskConfigSchema = z.object({
  baseUrl: z.url(), mode: z.enum(['synchronous', 'asynchronous']).default('asynchronous'),
  driver: z.enum(['template-v1', 'crl-seedance-v1']).default('template-v1'),
  upstreamModel: z.string().min(1).max(200).optional(),
  billing: z.enum(['provider-usage', 'fixed-reservation']).default('provider-usage'),
  failureBilling: z.enum(['free', 'usage']).default('free'),
  missingUsagePolicy: z.enum(['use_reserved', 'await_usage']).default('use_reserved'),
  pollIntervalMs: z.number().int().min(1_000).max(3_600_000).default(30_000),
  timeoutMs: z.number().int().min(1_000).max(1_800_000).default(300_000),
  retryableHttpStatuses: z.array(z.number().int().min(400).max(599)).default([429, 500, 502, 503, 504]),
  parameters: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/u), parameterSchema).default({}),
  referenceMapping: z.partialRecord(z.enum(['image', 'video', 'audio']), z.object({
    type: z.string().min(1), locationKey: z.string().regex(/^[a-z_]+$/u), role: z.string().min(1).optional(),
  }).strict()).default({}),
  submit: mappingSchema, query: mappingSchema,
  reserve: z.object({ quantityPath: pathSchema, microsCnyPerUnit: amountSchema,
    quantityOverrides: z.record(z.string(), z.number().nonnegative()).default({}),
  }).strict().optional(),
  videoReferencePrices: z.record(z.string(), amountSchema).optional(),
  response: z.object({
    status: pathSchema, statusValues: z.record(z.string(), z.enum(['processing', 'succeeded', 'failed', 'cancelled', 'unknown'])),
    providerTaskId: pathSchema.optional(), providerTaskIdPaths: z.array(pathSchema).max(8).optional(),
    results: pathSchema.optional(), resultKind: z.enum(['embedding', 'image', 'video', 'audio', 'transcript']).optional(),
    resultUrl: pathSchema.optional(), resultContent: pathSchema.optional(),
    usage: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u), unit: usageUnitSchema,
      path: pathSchema, factor: z.number().positive().max(1_000_000).default(1),
    }).strict()).max(16).default([]), errorCode: pathSchema.optional(), errorMessage: pathSchema.optional(),
  }).strict(),
}).strict().superRefine((config, context) => {
  const keys = config.response.usage.map(item => item.key)
  const paths = config.response.usage.map(item => item.path)
  if (new Set(keys).size !== keys.length || new Set(paths).size !== paths.length
    || (paths.some(path => path.endsWith('.total_tokens')) &&
      paths.some(path => /\.(?:input|output|prompt|completion)_tokens$/u.test(path)))) {
    context.addIssue({ code: 'custom', path: ['response', 'usage'], message: 'Usage measures must not overlap' })
  }
  if (config.driver === 'crl-seedance-v1' && !config.upstreamModel) {
    context.addIssue({ code: 'custom', path: ['upstreamModel'], message: 'Seedance requires an upstream model' })
  }
})
export type TaskConfig = z.infer<typeof taskConfigSchema>
export type TaskUsage = {
  complete: boolean
  items: { key: string; unit: z.infer<typeof usageUnitSchema>; quantity: string; source: string; final: boolean }[]
}
export type TaskOutcome = {
  status: 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  providerTaskId?: string
  results: Record<string, unknown>[]
  usage?: TaskUsage
  error?: { code: string; message: string; retryable: boolean }
}

/**
 * Read a dotted JSON path without evaluating expressions.
 * @param value JSON input.
 * @param path Property path.
 * @returns Located value, or undefined.
 */
export function readTemplatePath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object'
    && Object.hasOwn(current, key) ? (current as Record<string, unknown>)[key] : undefined, value)
}

function scalarText(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  throw new Error('Adapter text field must be scalar')
}

/** Expand literal JSON templates. @param value Template. @param scope Substitution values. @returns Expanded JSON. */
export function expandAdapterTemplate(value: unknown, scope: Readonly<Record<string, unknown>>): unknown {
  if (typeof value === 'string') {
    const exact = /^\{\{([A-Za-z0-9_.-]+)\}\}$/u.exec(value)
    if (exact) return readTemplatePath(scope, exact[1] ?? '')
    return value.replace(/\{\{([A-Za-z0-9_.-]+)\}\}/gu, (_match, path: string) => scalarText(readTemplatePath(scope, path), ''))
  }
  if (Array.isArray(value)) return value.map(item => expandAdapterTemplate(item, scope))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    expandAdapterTemplate(item, scope)]))
  return value
}

function quantityMicros(value: unknown): bigint {
  const text = String(value)
  if (!/^\d+(?:\.\d{1,6})?$/u.test(text)) throw new Error('Invalid nonnegative usage quantity')
  const [whole = '0', fraction = ''] = text.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
}

/**
 * Price final usage in integer micro-yuan.
 * @param usage Final provider measures.
 * @param prices Micro-yuan per unit, or per million tokens.
 * @returns Rounded charge.
 */
export function calculateTaskCost(usage: TaskUsage, prices: Readonly<Record<string, string>>): number {
  if (!usage.complete || usage.items.some(item => !item.final)) throw new Error('Final usage is incomplete')
  const total = usage.items.reduce((sum, item) => {
    const price = prices[item.key]
    if (price === undefined || !/^\d+$/u.test(price)) throw new Error(`Missing final price or quantity for ${item.key}`)
    const divisor = item.unit === 'token' ? 1_000_000_000_000n : 1_000_000n
    return sum + BigInt(roundMicrosCny(quantityMicros(item.quantity) * BigInt(price), divisor, 'up'))
  }, 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Final task charge exceeds the supported wallet range')
  return Number(total)
}

/**
 * Public settlement units for the configured price measures.
 * @param config Versioned billing rules.
 * @returns Price keys mapped to their denominators.
 */
export function taskPriceUnits(config: TaskConfig): Record<string, string> {
  if (config.billing === 'fixed-reservation') return { request: 'request' }
  if (config.driver === 'crl-seedance-v1') return { completion_tokens: 'token_million' }
  return Object.fromEntries(config.response.usage.map(item => [item.key, item.unit === 'token' ? 'token_million' : item.unit]))
}

/**
 * Resolve and validate operation parameters before reserving funds.
 * @param config Adapter configuration.
 * @param values Explicit parameters.
 * @returns Defaults and validated values.
 */
export function resolveTaskParameters(config: TaskConfig, values: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(values)) if (!Object.hasOwn(config.parameters, key)) throw new Error(`Unsupported model parameter: ${key}`)
  const resolved: Record<string, unknown> = {}
  for (const [key, rule] of Object.entries(config.parameters)) {
    const value = Object.hasOwn(values, key) ? values[key] : rule.default
    if (value === undefined) { if (rule.required) throw new Error(`Missing model parameter: ${key}`); continue }
    const matches = rule.type === 'array' ? Array.isArray(value) : rule.type === 'object'
      ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : rule.type === 'integer' ? Number.isSafeInteger(value) : typeof value === rule.type
    if (!matches || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`Invalid model parameter: ${key}`)
    if (!rule.specialValues.includes(value as string | number | boolean)) {
      if (typeof value === 'number' && ((rule.minimum !== undefined && value < rule.minimum) || (rule.maximum !== undefined && value > rule.maximum))) throw new Error(`Model parameter is outside its configured range: ${key}`)
      if (rule.values && !rule.values.includes(value as string | number | boolean)) throw new Error(`Unsupported model parameter value: ${key}`)
    }
    resolved[key] = value
  }
  return resolved
}

/**
 * Compute a parameter-priced reservation.
 * @param config Adapter rules.
 * @param parameters Resolved input.
 * @param fixed Legacy reservation.
 * @returns Integer micro-yuan.
 */
export function taskReservation(config: TaskConfig, parameters: Record<string, unknown>, fixed: number): number {
  if (!config.reserve) return fixed
  const value = readTemplatePath({ parameters, settings: parameters }, config.reserve.quantityPath)
  const quantity = config.reserve.quantityOverrides[String(value)] ?? value
  return calculateTaskCost({ complete: true, items: [{ key: 'reserve', unit: 'second', quantity: String(quantity), source: config.reserve.quantityPath, final: true }] }, { reserve: config.reserve.microsCnyPerUnit })
}

function failed(code: string, message: string): TaskOutcome {
  return { status: 'failed', results: [], error: { code, message, retryable: false } }
}

/**
 * Decode one submit or query response and validate successful output.
 * @param config Adapter rules.
 * @param body Provider JSON.
 * @param submitting Whether this is submission.
 * @returns Canonical provider outcome.
 */
export function decodeTaskOutcome(config: TaskConfig, body: unknown, submitting: boolean): TaskOutcome {
  const spec = config.response
  const seedance = config.driver === 'crl-seedance-v1'
  const paths = seedance ? ['id', 'task_id', 'data.id'] : spec.providerTaskIdPaths ?? (spec.providerTaskId ? [spec.providerTaskId] : [])
  const providerTaskId = paths.map(path => readTemplatePath(body, path)).find(value => typeof value === 'string' && value.length > 0) as string | undefined
  const rawStatus = readTemplatePath(body, seedance ? 'status' : spec.status)
  const states: Record<string, TaskOutcome['status']> = seedance ? {
    queued: 'processing', pending: 'processing', running: 'processing', processing: 'processing',
    completed: 'succeeded', succeeded: 'succeeded', success: 'succeeded', failed: 'failed', error: 'failed',
    cancelled: 'cancelled', canceled: 'cancelled', expired: 'failed',
  } : spec.statusValues
  const status = typeof rawStatus === 'string' ? states[rawStatus]
    : config.mode === 'synchronous' ? 'succeeded' : submitting && providerTaskId ? 'processing' : undefined
  if (!status) throw new Error('Provider response has an unmapped task status')
  const raw = readTemplatePath(body, seedance ? 'content.video_url' : spec.results ?? 'data')
  const rows = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
  const results = rows.map((row, index): Record<string, unknown> => {
    const kind = seedance ? 'video' : spec.resultKind
    if (kind === 'embedding') return { kind, index, vector: Array.isArray(row) ? row : readTemplatePath(row, 'embedding') }
    if (kind === 'transcript') return { kind, index, text: spec.resultContent ? readTemplatePath(row, spec.resultContent) : row }
    return { kind, index, url: seedance ? row : spec.resultUrl ? readTemplatePath(row, spec.resultUrl) : row }
  })
  const measures = seedance ? [{ key: 'completion_tokens', unit: 'token' as const, path: 'usage.completion_tokens', factor: 1 }] : spec.usage
  const items = measures.flatMap((item) => {
    const value = readTemplatePath(body, item.path)
    if (value === undefined || value === null) return []
    const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/u.test(value) ? Number(value) : NaN
    const quantity = numeric * item.factor
    const valid = Number.isFinite(quantity) && quantity >= 0 && quantity <= Number.MAX_SAFE_INTEGER
      && (item.unit === 'token' ? Number.isSafeInteger(quantity) : /^\d+(?:\.\d{1,6})?$/u.test(String(quantity)))
    return [{ key: item.key, unit: item.unit, quantity: valid ? String(quantity) : 'invalid', source: item.path, final: finalStates.has(status) }]
  })
  const usage: TaskUsage | undefined = config.billing === 'fixed-reservation'
    ? { complete: finalStates.has(status), items: [{ key: 'request', unit: 'request', quantity: '1', source: 'fixed-reservation', final: finalStates.has(status) }] }
    : measures.length ? { complete: finalStates.has(status) && items.length === measures.length && items.every(item => item.quantity !== 'invalid'), items } : undefined
  if (status === 'succeeded' && (results.length === 0 || results.some((result) => {
    if (result.kind === 'embedding') return !Array.isArray(result.vector) || result.vector.length === 0 || result.vector.some(n => typeof n !== 'number' || !Number.isFinite(n))
    if (result.kind === 'transcript') return typeof result.text !== 'string' || result.text.length === 0
    try { const url = new URL(String(result.url)); return url.protocol !== 'https:' || Boolean(url.username || url.password) } catch { return true }
  }))) return { ...failed('provider_output_invalid', 'Provider completed without valid output'), ...(usage ? { usage } : {}) }
  if (status === 'failed' || status === 'cancelled') return {
    ...(usage ? { usage } : {}), ...failed(scalarText(readTemplatePath(body, spec.errorCode ?? 'error.code'), 'provider_failed'),
      scalarText(readTemplatePath(body, spec.errorMessage ?? 'error.message'), 'Provider reported a failed task')), status,
  }
  return { status, results, ...(providerTaskId ? { providerTaskId } : {}), ...(usage ? { usage } : {}) }
}

/**
 * Build the verified Seedance text/settings request; reference fragments are configured explicitly.
 * @param config Adapter rules.
 * @param input User input with resolved asset access.
 * @param parameters Validated settings.
 * @returns Provider JSON.
 */
export function seedanceRequest(config: TaskConfig, input: Record<string, unknown>,
  parameters: Record<string, unknown>): Record<string, unknown> {
  const content: unknown[] = [{ type: 'text', text: z.string().min(1).parse(input.prompt) }]
  const references = z.array(z.object({ kind: z.enum(['image', 'video', 'audio']), url: z.url() })).max(16).parse(input.references ?? [])
  for (const reference of references) {
    const mapping = config.referenceMapping[reference.kind]
    if (!mapping) throw new Error(`Reference mapping is not configured: ${reference.kind}`)
    content.push({ type: mapping.type, [mapping.locationKey]: { url: reference.url }, ...(mapping.role ? { role: mapping.role } : {}) })
  }
  return { model: config.upstreamModel, content, resolution: parameters.resolution, ratio: parameters.ratio,
    duration: parameters.duration ?? 5, generate_audio: parameters.withAudio ?? parameters.generate_audio ?? true,
    watermark: parameters.watermark ?? false }
}
