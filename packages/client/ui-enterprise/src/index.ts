/* oxlint-disable @stylistic/max-len -- Dispatch paths mirror the enterprise RPC operation catalog. */
/** Trusted Host bridge from the local Web client to the enterprise control plane. */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-trigger'
import {
  CloudFileTriggerProvider,
  matchesGlob,
  TriggerBatchId,
  TriggerRuleId,
  TriggerService,
} from '@deepseek-ai/dsh-trigger'
import type { TriggerRuleInput } from '@deepseek-ai/dsh-trigger/types'
import { z } from 'zod'
import { EnterprisePluginRuntime } from './plugin-runtime.ts'
import {
  enterpriseDashboard,
  enterpriseModelSelection,
  enterprisePluginCatalog,
  enterprisePluginInstallations,
  enterprisePluginDeviceTargets,
  pluginEnableInput,
  pluginInstallationInput,
  pluginUpgradeInput,
  pluginUploadInput,
  enterpriseTeam,
  enterpriseUsagePage,
  enterpriseWallet,
  enterpriseWalletLedger,
  inviteMemberInput,
  memberUsageInput,
  redeemCodeInput,
  revokeInvitationInput,
  revokeRuntimeInput,
  setModelInput,
  teamUsageRangeInput,
  driveSpaces,
  driveFilePage,
  driveCreateFolderInput,
  driveFileSearchInput,
  driveUploadInput,
  driveUploadSession,
  cloudFileChangePage,
  triggerRule,
  triggerRuleSaveInput,
  triggerSnapshot,
} from './wire.ts'

type UsageTotal = {
  calls: number
  inputTokens: number
  outputTokens: number
  totalCostMicrosCny: number
  unpricedCalls: number
}

export const name = 'enterprise-client'
export const inject = ['connection']
export const Config = z.object({
  apiUrl: z.url(),
  organizationId: z.uuid(),
  keychainHelper: z.string().refine(isAbsolute),
  keychainAccount: z.string().min(1),
  maxResponseBytes: z.number().int().min(1024).max(4 * 1024 * 1024).default(1024 * 1024),
  activationTimeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
  cleanupTimeoutMs: z.number().int().min(1_000).max(120_000).default(10_000),
  triggerStatePath: z.string().refine(isAbsolute),
  triggerCloudPollMs: z.number().int().min(1_000).max(300_000).default(10_000),
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
  const decoded = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!response.ok) {
    const code = z.object({ error: z.string().min(1) }).loose().safeParse(decoded)
    throw new Error(code.success ? code.data.error : `HTTP_${String(response.status)}`)
  }
  return decoded
}

async function readBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`HTTP_${String(response.status)}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > limit) throw new Error('Enterprise API response exceeds the configured limit')
  return bytes
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
  const requestBytes = async (path: string, signal: AbortSignal): Promise<Uint8Array> => {
    const auth = await authorize()
    signal.throwIfAborted()
    const headers = new Headers({ Authorization: `Bearer ${auth.token}` })
    return readBytes(await fetch(new URL(`/v1/organizations/${config.organizationId}/${path}`, api), {
      signal, redirect: 'error', headers,
    }), config.maxResponseBytes)
  }

  ctx.plugin(TriggerService, {
    statePath: config.triggerStatePath,
    maxParallelTargets: 4,
    retainedEvents: 10_000,
    retainedBatches: 10_000,
  })
  ctx.inject(['triggers'], (triggerCtx: Context) => {
    return triggerCtx.triggers.registerSourceProvider(context => new CloudFileTriggerProvider(context, async (spaceId: string, cursor: string | undefined, signal: AbortSignal) => {
      const query = new URLSearchParams({ spaceId })
      if (cursor !== undefined) query.set('cursor', cursor)
      return cloudFileChangePage.parse(await request(`drive/changes?${query.toString()}`, signal))
    }, config.triggerCloudPollMs))
  })

  const pluginRuntime = new EnterprisePluginRuntime({
    ctx, apiUrl: api.origin, organizationId: config.organizationId,
    deviceId: async () => (await authorize()).runtimeId,
    request, requestBytes, activationTimeoutMs: config.activationTimeoutMs, cleanupTimeoutMs: config.cleanupTimeoutMs,
  })
  ctx.effect(() => {
    const controller = new AbortController()
    void pluginRuntime.reconcile(controller.signal).catch(error => ctx.logger('enterprise-client').warn(error))
    return async () => {
      controller.abort('enterprise-client disposed')
      await pluginRuntime.dispose()
    }
  }, 'enterprise-client: plugin target runtime')

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
        if (!catalog.some(model => model.id === selected.model)) throw new Error('The selected model is not available on the platform')
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
            plan: z.string(), seats: z.number(), runtimes: z.number(),
          }).loose(),
          roles: z.array(z.object({ role: z.string(), unitId: z.string().nullable() }).loose()),
        }).parse(overviewRaw)
        const models = z.array(z.object({
          id: z.string(), name: z.string(), images: z.boolean(), contextTokens: z.number(), maxOutputTokens: z.number(),
          protocol: z.enum(['openai-completions', 'openai-responses']).default('openai-completions'),
          inputModalities: z.array(z.enum(['text', 'image', 'video', 'audio', 'document'])).default(['text']),
          videoAudioMode: z.enum(['visual-only', 'visual-and-audio']).default('visual-only'),
          fileInputPolicy: z.enum(['unsupported', 'inline', 'provider-files']).default('unsupported'),
        }).loose()).parse(modelsRaw)
        const runtimes = z.array(z.object({
          id: z.string(), name: z.string(), type: z.string(), version: z.string(),
          leaseUntil: z.coerce.string(), revokedAt: z.coerce.string().nullable(),
        }).loose()).parse(runtimesRaw)
        const rows = enterpriseUsagePage.parse(usageRaw).items
        const usage = rows.reduce<UsageTotal>((total, row) => ({
          calls: total.calls + 1,
          inputTokens: total.inputTokens + (row.inputTokens ?? 0),
          outputTokens: total.outputTokens + (row.outputTokens ?? 0),
          totalCostMicrosCny: total.totalCostMicrosCny
            + (row.status === 'settled' && row.currency === 'CNY' ? row.totalCostMicrosCny ?? 0 : 0),
          unpricedCalls: total.unpricedCalls
            + (row.status === 'settled' && (row.currency !== 'CNY' || row.totalCostMicrosCny === null) ? 1 : 0),
        }), { calls: 0, inputTokens: 0, outputTokens: 0, totalCostMicrosCny: 0, unpricedCalls: 0 })
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
          },
          roles: overview.roles.map(role => ({ role: role.role, unitId: role.unitId })),
          models: models.map(model => ({
            id: model.id, name: model.name, images: model.images,
            protocol: model.protocol, inputModalities: model.inputModalities,
            videoAudioMode: model.videoAudioMode, fileInputPolicy: model.fileInputPolicy,
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
      if (endpoint === 'plugin-installations') {
        return { ok: true, value: enterprisePluginInstallations.parse(await request('plugins/installations', signal)) }
      }
      if (endpoint === 'plugin-device-targets') {
        return { ok: true, value: enterprisePluginDeviceTargets.parse(await request('plugins/device-targets', signal)) }
      }
      if (endpoint === 'plugin-runtime-targets') {
        await pluginRuntime.reconcile(signal)
        return { ok: true, value: {
          targets: pluginRuntime.clientTargets(),
          activationTimeoutMs: config.activationTimeoutMs,
          cleanupTimeoutMs: config.cleanupTimeoutMs,
        } }
      }
      if (endpoint === 'plugin-device-targets') {
        return { ok: true, value: enterprisePluginDeviceTargets.parse(await request('plugins/device-targets', signal)) }
      }
      if (endpoint === 'plugin-sdk-call') {
        const input = z.object({ activationId: z.string().uuid(), operation: z.string().min(1), input: z.unknown() }).strict().parse(args)
        return { ok: true, value: await pluginRuntime.callClient(input.activationId, input.operation, input.input, signal) }
      }
      if (endpoint === 'plugin-sdk-stream') {
        const input = z.object({ activationId: z.string().uuid(), operation: z.string().min(1), input: z.unknown() }).strict().parse(args)
        return { ok: true, value: await pluginRuntime.streamClient(input.activationId, input.operation, input.input, signal) }
      }
      if (endpoint === 'plugin-client-heartbeat') {
        const input = z.object({ activationId: z.string().uuid(), state: z.enum(['active', 'failed']), error: z.string().max(1000).nullable() }).strict().parse(args)
        await pluginRuntime.reportClient(input.activationId, input.state, input.error, signal)
        return { ok: true, value: null }
      }
      if (endpoint === 'plugin-install') {
        const input = pluginInstallationInput.parse(args)
        const installed = await request(`plugins/${input.releaseId}/install`, signal, { method: 'POST' })
        const bytes = await requestBytes(`plugins/${input.releaseId}/package`, signal)
        if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Downloaded plugin package is not a ZIP')
        return { ok: true, value: installed }
      }
      if (endpoint === 'plugin-enable') {
        const input = pluginEnableInput.parse(args)
        const value = await request(`plugins/installations/${input.installationId}`, signal, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: input.enabled }),
        })
        await pluginRuntime.reconcile(signal)
        return { ok: true, value }
      }
      if (endpoint === 'plugin-upgrade') {
        const input = pluginUpgradeInput.parse(args)
        const value = await request(`plugins/installations/${input.installationId}/upgrade`, signal, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ releaseId: input.releaseId, confirmPermissions: input.confirmPermissions }),
        })
        await pluginRuntime.reconcile(signal)
        return { ok: true, value }
      }
      if (endpoint === 'plugin-uninstall') {
        const input = z.object({ installationId: z.string().min(1) }).strict().parse(args)
        const value = await request(`plugins/installations/${input.installationId}`, signal, { method: 'DELETE' })
        await pluginRuntime.reconcile(signal)
        return { ok: true, value }
      }
      if (endpoint === 'plugin-upload') {
        const input = pluginUploadInput.parse(args)
        return { ok: true, value: await request(`plugins/packages?visibility=${encodeURIComponent(input.visibility)}`, signal, {
          method: 'POST', headers: { 'Content-Type': 'application/zip' },
          body: Uint8Array.from(input.bytes),
        }) }
      }
      if (endpoint === 'wallet') {
        return { ok: true, value: enterpriseWallet.parse(await request('wallet', signal)) }
      }
      if (endpoint === 'wallet-ledger') {
        return { ok: true, value: enterpriseWalletLedger.parse(await request('wallet/ledger', signal)) }
      }
      if (endpoint === 'own-usage') {
        return { ok: true, value: enterpriseUsagePage.parse(await request('usage?scope=own', signal)) }
      }
      if (endpoint === 'redeem') {
        const input = redeemCodeInput.parse(args)
        await request('wallet/redeem', signal, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        })
        return { ok: true, value: enterpriseWallet.parse(await request('wallet', signal)) }
      }
      if (endpoint === 'team') {
        const input = teamUsageRangeInput.parse(args)
        const range = new URLSearchParams()
        if (input.from !== undefined && input.to !== undefined) {
          range.set('from', input.from)
          range.set('to', input.to)
        }
        const suffix = range.size === 0 ? '' : `?${range.toString()}`
        const overview = z.object({
          roles: z.array(z.object({ role: z.string() }).loose()),
        }).loose().parse(await request('overview', signal))
        const roles = new Set(overview.roles.map(role => role.role))
        const canInviteAdministrator = roles.has('owner')
        const canManage = canInviteAdministrator || roles.has('administrator')
        if (!canManage) throw new Error('TEAM_MANAGEMENT_FORBIDDEN')
        const [summaryRaw, invitationsRaw] = await Promise.all([
          request(`members/usage-summary${suffix}`, signal), request('invitations', signal),
        ])
        const summary = z.object({
          items: enterpriseTeam.shape.members,
          range: enterpriseTeam.shape.range,
        }).strict().parse(summaryRaw)
        const invitations = enterpriseTeam.shape.invitations.parse(invitationsRaw)
          .filter(invitation => invitation.acceptedAt === null && new Date(invitation.expiresAt) > new Date())
        return { ok: true, value: enterpriseTeam.parse({
          canManage, canInviteAdministrator, members: summary.items, invitations, range: summary.range,
        }) }
      }
      if (endpoint === 'member-usage') {
        const input = memberUsageInput.parse(args)
        const query = new URLSearchParams({ scope: 'organization', accountId: input.accountId })
        if (input.cursor !== undefined) query.set('cursor', input.cursor)
        if (input.from !== undefined && input.to !== undefined) {
          query.set('from', input.from)
          query.set('to', input.to)
        }
        return { ok: true, value: enterpriseUsagePage.parse(await request(`usage?${query.toString()}`, signal)) }
      }
      if (endpoint === 'invite-member') {
        const input = inviteMemberInput.parse(args)
        return { ok: true, value: await request('invitations', signal, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        }) }
      }
      if (endpoint === 'revoke-invitation') {
        const { invitationId } = revokeInvitationInput.parse(args)
        await request(`invitations/${invitationId}`, signal, { method: 'DELETE' })
        return { ok: true, value: { invitationId } }
      }
      if (endpoint === 'revoke-runtime') {
        const { runtimeId } = revokeRuntimeInput.parse(args)
        await request(`runtimes/${runtimeId}`, signal, { method: 'DELETE' })
        return { ok: true, value: { runtimeId } }
      }
      if (endpoint === 'trigger-snapshot') {
        const triggers = ctx.get('triggers')
        if (triggers === undefined) throw new Error('Trigger Runtime is unavailable')
        return { ok: true, value: triggerSnapshot.parse(await triggers.snapshot()) }
      }
      if (endpoint === 'trigger-save') {
        const input = triggerRuleSaveInput.parse(args)
        if (input.source.kind === 'cloud-file') {
          const query = new URLSearchParams({ spaceId: input.source.spaceId, limit: '1' })
          await request(`drive/files?${query.toString()}`, signal)
        }
        const auth = await authorize()
        const triggers = ctx.get('triggers')
        if (triggers === undefined) throw new Error('Trigger Runtime is unavailable')
        const saved = await triggers.saveRule({ ...input, createdBy: auth.runtimeId } as unknown as TriggerRuleInput)
        return { ok: true, value: triggerRule.parse(saved) }
      }
      if (endpoint === 'trigger-enable') {
        const input = z.object({ ruleId: z.string().min(1), enabled: z.boolean() }).strict().parse(args)
        const triggers = ctx.get('triggers')
        if (triggers === undefined) throw new Error('Trigger Runtime is unavailable')
        return { ok: true, value: triggerRule.parse(
          await triggers.setEnabled(TriggerRuleId(input.ruleId), input.enabled),
        ) }
      }
      if (endpoint === 'trigger-remove') {
        const input = z.object({ ruleId: z.string().min(1) }).strict().parse(args)
        const triggers = ctx.get('triggers')
        if (triggers === undefined) throw new Error('Trigger Runtime is unavailable')
        await triggers.removeRule(TriggerRuleId(input.ruleId))
        return { ok: true, value: null }
      }
      if (endpoint === 'trigger-retry') {
        const input = z.object({ batchId: z.string().min(1) }).strict().parse(args)
        const triggers = ctx.get('triggers')
        if (triggers === undefined) throw new Error('Trigger Runtime is unavailable')
        await triggers.retryBatch(TriggerBatchId(input.batchId))
        return { ok: true, value: null }
      }
      if (endpoint === 'trigger-test-match') {
        const input = z.object({
          path: z.string().min(1), includes: z.array(z.string().min(1)).max(100),
          excludes: z.array(z.string().min(1)).max(100),
        }).strict().parse(args)
        const matched = input.includes.some(pattern => matchesGlob(input.path, pattern))
          && !input.excludes.some(pattern => matchesGlob(input.path, pattern))
        return { ok: true, value: { matched } }
      }
      if (endpoint === 'drive-spaces') {
        return { ok: true, value: driveSpaces.parse(await request('drive/spaces', signal)) }
      }
      if (endpoint === 'drive-files') {
        const input = z.object({ spaceId: z.string().min(1), parentId: z.string().min(1).nullable(), cursor: z.string().max(512).optional(), sort: z.enum(['name', 'updatedAt']).default('name') }).strict().parse(args)
        const query = new URLSearchParams({ spaceId: input.spaceId, sort: input.sort })
        if (input.parentId !== null) query.set('parentId', input.parentId)
        if (input.cursor !== undefined) query.set('cursor', input.cursor)
        return { ok: true, value: driveFilePage.parse(await request(`drive/files?${query.toString()}`, signal)) }
      }
      if (endpoint === 'drive-search') {
        const input = driveFileSearchInput.parse(args)
        const query = new URLSearchParams({ spaceId: input.spaceId, query: input.query })
        if (input.cursor !== undefined) query.set('cursor', input.cursor)
        return { ok: true, value: driveFilePage.parse(await request(`drive/search?${query.toString()}`, signal)) }
      }
      if (endpoint === 'drive-create-folder') {
        const input = driveCreateFolderInput.parse(args)
        return { ok: true, value: await request('drive/folders', signal, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        }) }
      }
      if (endpoint === 'drive-create-upload') {
        const input = driveUploadInput.parse(args)
        return { ok: true, value: driveUploadSession.parse(await request('drive/uploads', signal, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })) }
      }
      if (endpoint === 'drive-commit-upload') {
        const input = z.object({ uploadId: z.string().min(1), baseVersionId: z.string().min(1).optional() }).strict().parse(args)
        return { ok: true, value: await request('drive/uploads/commit', signal, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }) }
      }
      if (endpoint === 'drive-download') {
        const input = z.object({ nodeId: z.string().min(1) }).strict().parse(args)
        return { ok: true, value: await request(`drive/files/${encodeURIComponent(input.nodeId)}/download`, signal) }
      }
      if (endpoint === 'drive-versions' || endpoint === 'drive-descriptions') {
        const input = z.object({ nodeId: z.string().min(1), includeHistory: z.boolean().optional() }).strict().parse(args)
        const suffix = endpoint === 'drive-descriptions' && input.includeHistory ? '?includeHistory=true' : ''
        return { ok: true, value: await request(`drive/files/${encodeURIComponent(input.nodeId)}/${endpoint === 'drive-versions' ? 'versions' : `descriptions${suffix}`}`, signal) }
      }
      if (endpoint === 'drive-description-create') {
        return { ok: true, value: await request('drive/descriptions', signal, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) }) }
      }
      if (endpoint === 'drive-description-update') {
        const input = z.object({ descriptionId: z.string().min(1) }).passthrough().parse(args)
        const { descriptionId, ...body } = input
        return { ok: true, value: await request(`drive/descriptions/${encodeURIComponent(descriptionId)}`, signal, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
      }
      if (endpoint === 'drive-description-supersede') {
        const input = z.object({ descriptionId: z.string().min(1) }).strict().parse(args)
        return { ok: true, value: await request(`drive/descriptions/${encodeURIComponent(input.descriptionId)}/supersede`, signal, { method: 'POST' }) }
      }
      if (endpoint === 'drive-node-update') {
        const input = z.object({ nodeId: z.string().min(1), spaceId: z.string().min(1), name: z.string().trim().min(1).max(255).optional(), parentId: z.string().nullable().optional(), baseVersionId: z.string().nullable().optional() }).strict().parse(args)
        const { nodeId, ...body } = input
        return { ok: true, value: await request(`drive/files/${encodeURIComponent(nodeId)}`, signal, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId, ...body }) }) }
      }
      if (endpoint === 'drive-node-delete' || endpoint === 'drive-node-restore') {
        const input = z.object({ nodeId: z.string().min(1) }).strict().parse(args)
        const method = endpoint === 'drive-node-delete' ? 'DELETE' : 'POST'
        return { ok: true, value: await request(`drive/files/${encodeURIComponent(input.nodeId)}${method === 'POST' ? '/restore' : ''}`, signal, { method }) }
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
