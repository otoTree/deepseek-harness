/** Trusted Host bridge from the local Web client to the enterprise control plane. */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { z } from 'zod'
import { enterpriseDashboard, enterpriseModelSelection, enterprisePluginCatalog, revokeRuntimeInput, setModelInput } from './wire.ts'

type UsageTotal = {
  calls: number
  inputTokens: number
  outputTokens: number
  actualMicros: number
  billedMicros: number
}

export const name = 'enterprise-client'
export const inject = ['connection']
export const Config = z.object({
  apiUrl: z.url(),
  organizationId: z.uuid(),
  keychainHelper: z.string().refine(isAbsolute),
  keychainAccount: z.string().min(1),
  maxResponseBytes: z.number().int().min(1024).max(4 * 1024 * 1024).default(1024 * 1024),
}).strict()
type Settings = z.infer<typeof Config>

interface EnterpriseDefaultModel {
  currentSelection(): { provider: string; model: string }
  saveSelection(selection: { provider: string; model: string }): Promise<void>
}

const credential = z.object({
  apiOrigin: z.url(),
  runtimeId: z.uuid(),
  organizationId: z.uuid(),
  token: z.string().min(32),
  leaseUntil: z.iso.datetime(),
}).loose()

async function readKeychain(helper: string, account: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(helper, ['get', account], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 65_536, env: { PATH: '/usr/bin:/bin' },
    }, (error, stdout) => {
      if (error) reject(new Error('Enterprise device credential is unavailable'))
      else resolve(stdout)
    })
  })
}

async function readJson(response: Response, limit: number): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Enterprise API refused the request (${String(response.status)})`)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Enterprise API returned an empty response')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > limit) throw new Error('Enterprise API response exceeds the configured limit')
      chunks.push(item.value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** Register browser-safe enterprise reads without exposing the Runtime token to the WebView. */
export function apply(ctx: Context, input: Settings): void {
  const config = Config.parse(input)
  const api = new URL(config.apiUrl)
  if ((api.protocol !== 'https:' && !(api.protocol === 'http:' && api.hostname === '127.0.0.1'))
    || api.username || api.password || api.search || api.hash || api.pathname !== '/') {
    throw new Error('Enterprise client API must be an HTTPS or loopback origin')
  }

  const authorize = async () => {
    const value = credential.parse(JSON.parse(await readKeychain(config.keychainHelper, config.keychainAccount)))
    const expected = createHash('sha256').update(api.origin).digest('hex')
      + ':' + value.organizationId + ':' + value.runtimeId
    // The login response's leaseUntil is a snapshot; the API owns renewed lease liveness.
    if (value.apiOrigin !== api.origin || value.organizationId !== config.organizationId
      || expected !== config.keychainAccount) {
      throw new Error('Enterprise device credential does not match this organization')
    }
    return value
  }
  const request = async (path: string, signal: AbortSignal, init: RequestInit = {}) => {
    const auth = await authorize()
    signal.throwIfAborted()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${auth.token}`)
    return readJson(await fetch(new URL(`/v1/organizations/${config.organizationId}/${path}`, api), {
      ...init,
      signal,
      redirect: 'error',
      headers,
    }), config.maxResponseBytes)
  }

  ctx.effect(() => ctx.connection.rpc.handle('/enterprise', async (endpoint, payload, signal) => {
    try {
      const args = (payload as { args?: unknown } | null)?.args ?? payload
      const lookup = ctx as unknown as { get(name: string): unknown }
      const defaultModel = lookup.get('agentDefaultModel') as EnterpriseDefaultModel | undefined
      if (endpoint === 'model-selection') {
        if (defaultModel === undefined) throw new Error('Enterprise default model service is unavailable')
        return { ok: true, value: enterpriseModelSelection.parse(defaultModel.currentSelection()) }
      }
      if (endpoint === 'set-model') {
        const selected = setModelInput.parse(args)
        if (defaultModel === undefined) throw new Error('Enterprise default model service is unavailable')
        const catalog = z.array(z.object({ id: z.string() }).loose()).parse(await request('models', signal))
        if (!catalog.some(model => model.id === selected.model)) throw new Error('The selected model is not authorized for this organization')
        await defaultModel.saveSelection({ provider: 'enterprise', model: selected.model })
        return { ok: true, value: enterpriseModelSelection.parse({ provider: 'enterprise', model: selected.model }) }
      }
      if (endpoint === 'dashboard') {
        const auth = await authorize()
        const [overviewRaw, modelsRaw, runtimesRaw, usageRaw] = await Promise.all([
          request('overview', signal), request('models', signal), request('runtimes', signal), request('usage?scope=own', signal),
        ])
        const overview = z.object({
          organization: z.object({
            id: z.string(), name: z.string(), kind: z.string(), status: z.string(), policyRevision: z.number(),
          }).loose(),
          subscription: z.object({
            plan: z.string(), seats: z.number(), runtimes: z.number(), budgetMicros: z.number(),
            spentMicros: z.number(), reservedMicros: z.number(),
          }).loose(),
          roles: z.array(z.object({ role: z.string(), unitId: z.string().nullable() }).loose()),
        }).parse(overviewRaw)
        const models = z.array(z.object({
          id: z.string(), name: z.string(), images: z.boolean(), contextTokens: z.number(), maxOutputTokens: z.number(),
        }).loose()).parse(modelsRaw)
        const runtimes = z.array(z.object({
          id: z.string(), name: z.string(), type: z.string(), version: z.string(),
          leaseUntil: z.coerce.string(), revokedAt: z.coerce.string().nullable(),
        }).loose()).parse(runtimesRaw)
        const rows = z.array(z.object({
          inputTokens: z.number().nullable(), outputTokens: z.number().nullable(),
          actualMicros: z.number().nullable(), billedMicros: z.number().nullable(),
        }).loose()).parse(usageRaw)
        const usage = rows.reduce<UsageTotal>((total, row) => ({
          calls: total.calls + 1,
          inputTokens: total.inputTokens + (row.inputTokens ?? 0),
          outputTokens: total.outputTokens + (row.outputTokens ?? 0),
          actualMicros: total.actualMicros + (row.actualMicros ?? 0),
          billedMicros: total.billedMicros + (row.billedMicros ?? 0),
        }), { calls: 0, inputTokens: 0, outputTokens: 0, actualMicros: 0, billedMicros: 0 })
        return { ok: true, value: enterpriseDashboard.parse({
          organization: {
            id: overview.organization.id,
            name: overview.organization.name,
            kind: overview.organization.kind,
            status: overview.organization.status,
            policyRevision: overview.organization.policyRevision,
          },
          subscription: {
            plan: overview.subscription.plan,
            seats: overview.subscription.seats,
            runtimes: overview.subscription.runtimes,
            budgetMicros: overview.subscription.budgetMicros,
            spentMicros: overview.subscription.spentMicros,
            reservedMicros: overview.subscription.reservedMicros,
          },
          roles: overview.roles.map(role => ({ role: role.role, unitId: role.unitId })),
          models: models.map(model => ({
            id: model.id, name: model.name, images: model.images,
            contextTokens: model.contextTokens, maxOutputTokens: model.maxOutputTokens,
          })),
          runtimes: runtimes.map(runtime => ({
            id: runtime.id,
            name: runtime.name,
            type: runtime.type,
            version: runtime.version,
            leaseUntil: runtime.leaseUntil,
            revokedAt: runtime.revokedAt,
            current: runtime.id === auth.runtimeId,
          })),
          usage,
        }) }
      }
      if (endpoint === 'plugins') {
        return { ok: true, value: enterprisePluginCatalog.parse(await request('plugins/catalog', signal)) }
      }
      if (endpoint === 'revoke-runtime') {
        const { runtimeId } = revokeRuntimeInput.parse(payload)
        await request(`runtimes/${runtimeId}`, signal, { method: 'DELETE' })
        return { ok: true, value: { runtimeId } }
      }
      return { ok: false, error: { code: 'enterprise/not-found', message: 'Unknown enterprise operation', details: {} } }
    } catch (error) {
      return { ok: false, error: {
        code: 'enterprise/request-failed',
        message: error instanceof Error ? error.message : 'Enterprise request failed',
        details: {},
      } }
    }
  }), 'enterprise-client: authenticated browser bridge')
}
