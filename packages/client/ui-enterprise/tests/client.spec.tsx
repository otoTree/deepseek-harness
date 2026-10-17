// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import { resolveSlotLabel, type TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '../../ui-renderer/src/client/bind.ts'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { EnterpriseClientPluginRuntime } from '../src/client/enterprise.tsx'
import { driveFilePage, enterprisePluginCapabilityDiagnostics } from '../src/wire.ts'
import type {
  EnterpriseDashboard,
  EnterprisePluginCatalog,
  EnterprisePluginDeviceTargets,
  EnterprisePluginInstallations,
  EnterpriseTeam,
  EnterpriseUsagePage,
  EnterpriseWallet,
  EnterpriseWalletLedger,
  TriggerRule,
  TriggerRuleSaveInput,
  TriggerSnapshot,
} from '../src/wire.ts'

afterEach(cleanup)

describe('EnterpriseClientPluginRuntime', () => {
  it('mounts and unmounts Client bundles independently within one product installation', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({ name:'root',children:{ 'settings.section':{ kind:'list',scope:'root' } } } as never,()=>null)
    const disposed: string[] = []
    const imported: string[] = []
    const modules = new Map(['first-client', 'second-client'].map(name => [name, {
      name,
      inject: ['slots'],
      apply(target: Context) {
        target.slots.inject('settings.section', () => target.slots.register({ name: 'settings.section', id: name } as never, () => null))
        target.effect(() => () => { disposed.push(name) })
      },
    }]))
    ctx.reflect.provide('modules', {
      invalidate() {},
      async import(name: string) {
        imported.push(name)
        const module = modules.get(name)
        if (module === undefined) throw new Error(`Unknown Client module ${name}`)
        return module
      },
    })
    const target = (moduleId: string, activationId: string) => ({
      installationId: 'installation', releaseId: 'release', pluginId: 'multi-client', version: '1.0.0',
      activationId, moduleId, source: '', contributions: [{ kind:'slot',id:moduleId,slot:'settings.section',multiplicity:'many' }],
    })
    let targets = [
      target('first-client', '00000000-0000-4000-8000-000000000001'),
      target('second-client', '00000000-0000-4000-8000-000000000001'),
    ]
    const runtime = new EnterpriseClientPluginRuntime({
      ctx,
      call: async endpoint => endpoint === 'plugin-runtime-targets'
        ? { targets, activationTimeoutMs: 1_000, cleanupTimeoutMs: 1_000 }
        : {},
      loadTarget: async () => {},
      windowId: 'test-window',
    })

    await runtime.reconcile()
    expect(imported).toEqual(['first-client', 'second-client'])
    expect(disposed).toEqual([])
    expect(ctx.slots.entries('settings.section').map(entry=>entry.options.id)).toEqual(['first-client','second-client'])

    targets = [target('second-client', '00000000-0000-4000-8000-000000000001')]
    await runtime.reconcile()
    expect(disposed).toEqual(['first-client'])
    expect(ctx.slots.entries('settings.section').map(entry=>entry.options.id)).toEqual(['second-client'])

    await runtime.dispose()
    expect(disposed).toEqual(['first-client', 'second-client'])
    expect(ctx.slots.entries('settings.section')).toEqual([])
    await ctx.fiber.dispose()
  })
})

const dashboard: EnterpriseDashboard = {
  organization: { id: 'organization', name: 'Acme Research', kind: 'team', status: 'active', policyRevision: 7 },
  subscription: { plan: 'Enterprise', seats: 20, runtimes: 6 },
  roles: [{ role: 'member', unitId: null }],
  capabilities: { manageOrganizationPlugins: false, publishPlugins: false },
  models: [{ id: 'model', name: 'Enterprise Chat', images: false, protocol: 'openai-completions',
    inputModalities: ['text', 'video'], videoAudioMode: 'visual-and-audio', fileInputPolicy: 'provider-files',
    contextTokens: 65536, maxOutputTokens: 8192 }],
  runtimes: [{ id: 'runtime', name: 'Studio Mac', type: 'desktop', version: '0.1.0', leaseUntil: '2026-09-10T12:00:00Z', revokedAt: null, current: true }],
  usage: { calls: 4, inputTokens: 1200, outputTokens: 300, totalCostMicrosCny: 125_081, unpricedCalls: 1 },
}

const catalog: EnterprisePluginCatalog = [{
  id: 'release',
  pluginId: 'document-review',
  version: '1.2.0',
  targets: ['desktop'],
  permissions: ['workspace.read'],
  tools: [{ name: 'review', description: 'Review a document' }],
  status: 'published',
  publishedAt: '2026-09-10T12:00:00Z',
  policyRevision: 7,
}]

const wallet: EnterpriseWallet = {
  organizationId: 'organization', balanceMicrosCny: 12_500_000, updatedAt: '2026-09-18T02:00:00Z', version: 2,
}

const ledger: EnterpriseWalletLedger = {
  currency: 'CNY', nextCursor: null, items: [{
    id: 'ledger-1', amountMicrosCny: 12_500_000, kind: 'redemption_credit', usageId: null,
    redemptionCodeId: 'code-1', accountId: 'account-self', runtimeId: null,
    balanceAfterMicrosCny: 12_500_000, createdAt: '2026-09-18T02:00:00Z',
  }],
}

function usagePage(id: string, nextCursor: string | null): EnterpriseUsagePage {
  return {
    items: [{
      id, accountId: id === 'usage-own' ? 'account-self' : 'account-member', runtimeId: 'runtime',
      modelId: id, purpose: 'conversation', status: 'settled', protocol: 'openai-completions',
      inputModalities: ['text'], inputTokens: 12, outputTokens: 8, totalTokens: 20,
      totalCostMicrosCny: 81_000, currency: 'CNY', occurredAt: '2026-09-18T03:00:00Z',
    }],
    nextCursor,
    range: { from: '2026-08-31T16:00:00.000Z', to: '2026-09-30T16:00:00.000Z', timeZone: 'Asia/Shanghai' },
  }
}

const team: EnterpriseTeam = {
  canManage: true,
  canInviteAdministrator: true,
  members: [{
    membershipId: 'membership-1', accountId: 'account-member', name: 'Alice', email: 'alice@example.com',
    status: 'active', roles: ['member'], calls: 2, inputTokens: 24, outputTokens: 16,
    totalTokens: 40, settledCostMicrosCny: 162_000, lastActivityAt: '2026-09-18T03:00:00Z',
  }],
  invitations: [{
    id: 'invitation-1', email: 'pending@example.com', role: 'member',
    expiresAt: '2099-09-30T16:00:00.000Z', acceptedAt: null,
  }],
  range: { from: '2026-08-31T16:00:00.000Z', to: '2026-09-30T16:00:00.000Z', timeZone: 'Asia/Shanghai' },
}

async function bench(options: { role?: 'member' | 'administrator' | 'owner'; uploadError?: string; forceRemoveError?: string; runtimeReconcileError?: string; runtimeReconcile?: () => Promise<void>; catalog?: EnterprisePluginCatalog; installations?: EnterprisePluginInstallations; deviceTargets?: EnterprisePluginDeviceTargets; diagnostics?: ReturnType<typeof enterprisePluginCapabilityDiagnostics.parse>; diagnosticsError?: string; generationReady?: boolean } = {}) {
  const calls: Array<{ endpoint: string; payload: unknown }> = []
  const dashboardValue = {
    ...dashboard,
    roles: [{ role: options.role ?? 'member', unitId: null }],
    capabilities: {
      manageOrganizationPlugins: options.role === 'owner' || options.role === 'administrator',
      publishPlugins: options.role === 'owner' || options.role === 'administrator',
    },
  }
  const ctx = new Context()
  ctx.reflect.provide('modules', {
    invalidate() {},
    async import(): Promise<never> { throw new Error('Unexpected dynamic Client module import') },
  })
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  let generation = options.generationReady === false ? undefined : { id: 1, host: { home: '/tmp' } }
  const generationListeners = new Set<() => void>()
  ctx.provide('connection', {
    generation: {
      getSnapshot: () => generation,
      subscribe: (listener: () => void) => { generationListeners.add(listener); return () => { generationListeners.delete(listener) } },
    },
    rpc: {
      call: async (_channel: string, endpoint: string, payload: unknown) => {
        calls.push({ endpoint, payload })
        if (endpoint === 'dashboard') return { ok: true as const, value: dashboardValue }
        if (endpoint === 'model-selection') return { ok: true as const, value: { provider: 'enterprise', model: 'model' } }
        if (endpoint === 'set-model') return { ok: true as const, value: { provider: 'enterprise', model: (payload as { model: string }).model } }
        if (endpoint === 'plugins') return { ok: true as const, value: options.catalog ?? catalog }
        if (endpoint === 'plugin-installations') return { ok: true as const, value: options.installations ?? [] }
        if (endpoint === 'plugin-device-targets') return { ok: true as const, value: options.deviceTargets ?? [] }
        if (endpoint === 'plugin-runtime-diagnostics') {
          if (options.diagnosticsError !== undefined) throw new Error(options.diagnosticsError)
          return { ok: true as const, value: options.diagnostics ?? [] }
        }
        if (endpoint === 'plugin-runtime-targets') {
          await options.runtimeReconcile?.()
          if (options.runtimeReconcileError !== undefined) throw new Error(options.runtimeReconcileError)
          return { ok: true as const, value: { targets: [], activationTimeoutMs: 30_000, cleanupTimeoutMs: 10_000 } }
        }
        if (endpoint === 'plugin-upload') {
          if (options.uploadError !== undefined) return { ok: false as const, error: { code: 'upload-failed', message: options.uploadError, details: {} } }
          return { ok: true as const, value: { id: 'uploaded-release' } }
        }
        if (endpoint === 'plugin-install') return { ok: true as const, value: { id: 'installation' } }
        if (endpoint === 'plugin-enable' || endpoint === 'plugin-uninstall') return { ok: true as const, value: payload }
        if (endpoint === 'plugin-upgrade') return { ok: true as const, value: payload }
        if (endpoint === 'plugin-force-remove') {
          if (options.forceRemoveError !== undefined) return { ok: false as const, error: { code: 'force-remove-failed', message: options.forceRemoveError, details: {} } }
          return { ok: true as const, value: payload }
        }
        if (endpoint === 'revoke-runtime') return { ok: true as const, value: payload }
        if (endpoint === 'wallet') return { ok: true as const, value: wallet }
        if (endpoint === 'wallet-ledger') return { ok: true as const, value: ledger }
        if (endpoint === 'own-usage') return { ok: true as const, value: usagePage('usage-own', null) }
        if (endpoint === 'redeem') return { ok: true as const, value: { ...wallet, balanceMicrosCny: 22_500_000, version: 3 } }
        if (endpoint === 'team') return { ok: true as const, value: {
          ...team,
          canInviteAdministrator: options.role === 'owner',
        } }
        if (endpoint === 'member-usage') {
          const cursor = (payload as { args?: { cursor?: string } }).args?.cursor
          return { ok: true as const, value: usagePage(cursor === undefined ? 'usage-member-1' : 'usage-member-2', cursor === undefined ? 'next-page' : null) }
        }
        if (endpoint === 'invite-member' || endpoint === 'revoke-invitation') return { ok: true as const, value: payload }
        return { ok: false as const, error: { code: 'not-found', message: 'Not found', details: {} } }
      },
    },
  } as ConnectionHandle)
  let surface: 'conversation' | 'plugin-market' | 'cloud-drive' = 'conversation'
  const listeners = new Set<() => void>()
  const setSurface = (value: typeof surface): void => {
    surface = value
    for (const listener of listeners) listener()
  }
  ctx.provide('mainNavigation', {
    get: () => surface,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    openPluginMarket: () => { setSurface('plugin-market') },
    openCloudDrive: () => { setSurface('cloud-drive') },
    openConversation: () => { setSurface('conversation') },
  })
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'sidebar.rail.item': { kind: 'list', scope: 'root' },
      'main.surface': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, locale, calls, fiber, connect: () => {
    generation = { id: (generation?.id ?? 0) + 1, host: { home: '/tmp' } }
    for (const listener of generationListeners) listener()
  } }
}

type SectionFace = {
  loadDashboard(): Promise<EnterpriseDashboard>
  loadModelSelection(): Promise<{ provider: 'enterprise'; model: string }>
  saveModel(model: string): Promise<{ provider: 'enterprise'; model: string }>
  openPluginMarket(): void
  close(): void
  loadPlugins(): Promise<EnterprisePluginCatalog>
  revokeRuntime(runtimeId: string): Promise<void>
  loadWallet(): Promise<EnterpriseWallet>
  loadWalletLedger(): Promise<EnterpriseWalletLedger>
  loadOwnUsage(): Promise<EnterpriseUsagePage>
  redeem(code: string): Promise<EnterpriseWallet>
  loadTeam(from?: string, to?: string): Promise<EnterpriseTeam>
  loadMemberUsage(accountId: string, cursor?: string, from?: string, to?: string): Promise<EnterpriseUsagePage>
  inviteMember(email: string, role: 'member' | 'administrator'): Promise<void>
  revokeInvitation(invitationId: string): Promise<void>
  switchOrganization(): void
  logout(): void
}

type MarketFace = {
  usePluginRevision: SnapshotSelectorHook<number>
  loadPlugins(): Promise<EnterprisePluginCatalog>
  loadPluginInstallations(): Promise<EnterprisePluginInstallations>
  uploadPlugin(visibility: 'private' | 'organization' | 'platform', bytes: Uint8Array): Promise<unknown>
  installPlugin(releaseId: string): Promise<unknown>
  upgradePlugin(installationId: string, releaseId: string): Promise<unknown>
  setPluginEnabled(installationId: string, enabled: boolean): Promise<unknown>
  openConversation(): void
}

function marketFace(inject: unknown): MarketFace {
  const { hooks, ...face } = (inject as () => Omit<MarketFace, 'usePluginRevision'> & { hooks: { pluginRevision: HostObservable<number> } })()
  return { ...face, usePluginRevision: bindSnapshotSelector(hooks.pluginRevision) }
}

type MarketActionFace = {
  navigation: {
    get(): 'conversation' | 'plugin-market' | 'cloud-drive'
    subscribe(listener: () => void): () => void
  }
  open(): void
}

type DriveFace = {
  loadSpaces(): Promise<[{ id: string; kind: 'personal'; name: string }]>
  loadFiles(spaceId: string, parentId: string | null, cursor?: string): Promise<unknown>
  searchFiles(spaceId: string, query: string, cursor?: string): Promise<unknown>
  createFolder(): Promise<void>
  createUpload(): Promise<{ uploadId: string; uploadUrl: string; name: string }>
  commitUpload(): Promise<void>
  downloadFile(nodeId: string): Promise<{ url: string; versionId: string; checksum: string }>
  updateNode(): Promise<void>
  deleteNode(): Promise<void>
  restoreNode(): Promise<void>
  loadVersions(): Promise<unknown[]>
  loadDescriptions(): Promise<unknown[]>
}

type TriggerFace = {
  loadTriggers(): Promise<TriggerSnapshot>
  saveTrigger(input: TriggerRuleSaveInput): Promise<TriggerRule>
  setTriggerEnabled(ruleId: string, enabled: boolean): Promise<TriggerRule>
  removeTrigger(ruleId: string): Promise<void>
  retryTrigger(batchId: string): Promise<void>
  testTriggerMatch(path: string, includes: string[], excludes: string[]): Promise<boolean>
  loadSpaces(): Promise<[]>
  openSession(sessionId: string): Promise<void>
}

function section(entry: ReturnType<SlotRegistry['entries']>[number]): {
  Component: ComponentType<SectionFace & { t: TranslateNS<'enterprise'> }>
  face: SectionFace
} {
  return {
    Component: entry.component as ComponentType<SectionFace & { t: TranslateNS<'enterprise'> }>,
    face: (entry.inject as () => SectionFace)(),
  }
}

describe('enterprise Web client', () => {
  it('reconciles browser plugin targets when the first connection generation becomes ready', async () => {
    const b = await bench({ generationReady: false, catalog: [] })
    expect(b.calls.some(call => call.endpoint === 'plugin-runtime-targets')).toBe(false)
    b.connect()
    await waitFor(() => {
      expect(b.calls.filter(call => call.endpoint === 'plugin-runtime-targets')).toHaveLength(1)
    })
    await b.fiber.dispose()
  })

  it('accepts drive file pages returned by the API, including deletedAt', () => {
    expect(driveFilePage.parse({
      items: [{ id: 'file-1', parentId: null, name: 'report.txt', kind: 'file', size: 7,
        contentType: 'text/plain', versionId: 'version-1', updatedAt: '2026-09-23T00:00:00.000Z', deletedAt: null }],
      nextCursor: null,
      summary: { spaceId: 'space-1', parentId: null, totalKnown: null },
    }).items[0]?.name).toBe('report.txt')
  })

  it('opens file details in a drawer and confirms rename/delete actions', async () => {
    const b = await bench()
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<DriveFace & { surface: 'cloud-drive'; t: TranslateNS<'enterprise'> }>
    const file = { id: 'file-1', parentId: null, name: 'report.pdf', kind: 'file' as const, size: 7, contentType: 'application/pdf', versionId: 'version-1', updatedAt: '2026-09-23T00:00:00.000Z', deletedAt: null }
    const updateNode = vi.fn(async () => {})
    const face: DriveFace = {
      loadSpaces: async () => [{ id: 'space-1', kind: 'personal', name: 'Personal' }],
      loadFiles: async () => ({ items: [file], nextCursor: null, summary: { spaceId: 'space-1', parentId: null, totalKnown: 1 } }),
      searchFiles: async () => ({ items: [], nextCursor: null, summary: { spaceId: 'space-1', parentId: null, totalKnown: 0 } }),
      createFolder: async () => {}, createUpload: async () => ({ uploadId: 'u', uploadUrl: 'https://upload.example', name: file.name }), commitUpload: async () => {},
      downloadFile: async () => ({ url: 'https://download.example/report.txt', versionId: 'version-1', checksum: 'abc' }),
      updateNode, deleteNode: async () => {}, restoreNode: async () => {},
      loadVersions: async () => [{ id: 'version-1', nodeId: 'file-1', size: 7, contentType: 'application/pdf', checksum: 'abc', createdBy: 'account', createdAt: file.updatedAt }],
      loadDescriptions: async () => [],
    }
    render(<Component {...face} surface="cloud-drive" t={b.locale.bind('enterprise')} />)
    expect(await screen.findByText('report.pdf')).toBeTruthy()
    fireEvent.click(screen.getByText('report.pdf', { exact: true }).closest('button')!)
    expect(await screen.findByRole('complementary', { name: '文件详情' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '重命名' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    expect(await screen.findByRole('dialog', { name: '重命名文件' })).toBeTruthy()
    expect(b.calls.filter(call => call.endpoint === 'drive-node-update')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(updateNode).toHaveBeenCalledWith('file-1', { spaceId: 'space-1', name: 'report.pdf', baseVersionId: 'version-1' }) })
    fireEvent.click(screen.getByText('report.pdf', { exact: true }).closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(await screen.findByRole('dialog', { name: '确认删除文件' })).toBeTruthy()
    expect(b.calls.filter(call => call.endpoint === 'drive-node-delete')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })

  it('keeps trigger operations in dialogs and describes the rule text as an Agent prompt', async () => {
    const b = await bench()
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<TriggerFace & {
      surface: 'triggers'
      t: TranslateNS<'enterprise'>
      useSessions: UseSessions
    }>
    const sessionId = 'session-1' as SessionId
    const sessionState: SessionListState = {
      ids: [sessionId],
      byId: {
        [sessionId]: {
          id: sessionId, displayTitle: '目标会话', running: false, blank: false, updatedAt: 1,
        },
      },
      current: sessionId,
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    }
    const useSessions: UseSessions = selector => selector(sessionState)
    const rule: TriggerRule = {
      id: 'rule-1', version: 2, name: '日报', enabled: true, createdBy: 'account-1',
      createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T01:00:00.000Z',
      source: { kind: 'timer', schedule: { kind: 'every', everySeconds: 3600, anchorAt: '2026-09-24T00:00:00.000Z' } },
      delivery: { kind: 'queue-each' },
      target: { kind: 'existing-session', sessionId },
      instructionTemplate: { version: 3, text: '整理本轮事件，并给出下一步。' },
    }
    const face: TriggerFace = {
      loadTriggers: async () => ({ rules: [rule], batches: [], providers: [] }),
      saveTrigger: async () => rule,
      setTriggerEnabled: async () => rule,
      removeTrigger: async () => {},
      retryTrigger: async () => {},
      testTriggerMatch: async () => true,
      loadSpaces: async () => [],
      openSession: async () => {},
    }

    const view = render(<Component {...face} surface="triggers" t={b.locale.bind('enterprise')} useSessions={useSessions} />)
    expect(await screen.findByRole('heading', { name: '触发器' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '执行队列' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '运行历史' }))
    expect(screen.getByRole('tabpanel').textContent).toContain('暂无运行记录')
    fireEvent.keyDown(screen.getByRole('tab', { name: '运行历史' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: '执行队列' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: '执行队列' }))
    expect(screen.getByRole('tabpanel').textContent).toContain('当前没有待处理批次')
    expect(screen.queryByLabelText('规则名称')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '新建规则' }))
    const editor = await screen.findByRole('dialog', { name: '创建触发器' })
    expect(['触发条件', '执行目标', '执行指令'].map(name => within(editor).getByRole('group', { name }).querySelector('legend')!.textContent)).toMatchSnapshot()
    const variables = within(editor).getByText('可用变量', { exact: true }).closest('details')!
    expect(variables.open).toBe(false)
    fireEvent.click(within(editor).getByText('可用变量', { exact: true }))
    expect(variables.open).toBe(true)
    expect(screen.getByText('发送给 Agent 的提示词')).toBeTruthy()
    expect(screen.getByText(/新的用户消息/)).toBeTruthy()
    expect(screen.getByLabelText<HTMLTextAreaElement>('发送给 Agent 的提示词').value).toContain('处理这次触发事件')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '创建触发器' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(await screen.findByRole('dialog', { name: '编辑触发器' })).toBeTruthy()
    expect(screen.getByLabelText<HTMLTextAreaElement>('发送给 Agent 的提示词').value).toBe('整理本轮事件，并给出下一步。')

    face.loadTriggers = async () => ({ rules: [], batches: [], providers: [] })
    view.unmount()
    render(<Component {...face} surface="triggers" t={b.locale.bind('enterprise')} useSessions={useSessions} />)
    expect(await screen.findByText('暂无触发器规则。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '创建第一条规则' }))
    expect(await screen.findByRole('dialog', { name: '创建触发器' })).toBeTruthy()
    await b.ctx.fiber.dispose()
  })

  it('runs trigger rule, match, queue, history, and recovery actions', async () => {
    const b = await bench()
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<TriggerFace & {
      surface: 'triggers'
      t: TranslateNS<'enterprise'>
      useSessions: UseSessions
    }>
    const sessionId = 'session-1' as SessionId
    const sessionState: SessionListState = {
      ids: [sessionId], byId: { [sessionId]: { id: sessionId, displayTitle: '目标会话', running: false, blank: false, updatedAt: 1 } },
      current: sessionId, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }
    const useSessions: UseSessions = selector => selector(sessionState)
    const rule: TriggerRule = {
      id: 'rule-1', version: 2, name: '日报', enabled: true, createdBy: 'account-1',
      createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T01:00:00.000Z',
      source: { kind: 'timer', schedule: { kind: 'every', everySeconds: 3600, anchorAt: '2026-09-24T00:00:00.000Z' } },
      delivery: { kind: 'queue-each' }, target: { kind: 'existing-session', sessionId },
      instructionTemplate: { version: 3, text: '整理本轮事件，并给出下一步。' },
    }
    const failedBatch: TriggerSnapshot['batches'][number] = {
      id: 'batch-failed', ruleId: rule.id, ruleVersion: rule.version, eventIds: ['event-failed'], ruleSnapshot: rule,
      resources: [{ resourceId: 'resource-1', displayName: 'report.txt', operation: 'updated', version: 'v1', mergedVersions: ['v1'], metadata: {} }],
      createdAt: '2026-09-24T02:00:00.000Z', state: 'failed', sessionId, error: 'temporary failure',
    }
    const queuedBatch: TriggerSnapshot['batches'][number] = {
      id: 'batch-queued', ruleId: rule.id, ruleVersion: rule.version, eventIds: ['event-queued'], ruleSnapshot: rule,
      resources: [{ resourceId: 'resource-2', displayName: 'notes.md', operation: 'created', version: 'v2', mergedVersions: ['v2'], metadata: {} }],
      createdAt: '2026-09-24T03:00:00.000Z', state: 'queued', sessionId,
    }
    let snapshot: TriggerSnapshot = { rules: [rule], batches: [failedBatch, queuedBatch], providers: [] }
    const saveTrigger = vi.fn(async () => rule)
    const setTriggerEnabled = vi.fn(async (ruleId: string, enabled: boolean) => {
      snapshot = { ...snapshot, rules: snapshot.rules.map(item => item.id === ruleId ? { ...item, enabled } : item) }
      return snapshot.rules[0]!
    })
    const removeTrigger = vi.fn(async (ruleId: string) => {
      snapshot = { ...snapshot, rules: snapshot.rules.filter(item => item.id !== ruleId) }
    })
    const retryTrigger = vi.fn(async () => undefined)
    const testTriggerMatch = vi.fn(async () => true)
    const openSession = vi.fn(async () => undefined)
    const face: TriggerFace = {
      loadTriggers: async () => snapshot, saveTrigger, setTriggerEnabled, removeTrigger, retryTrigger, testTriggerMatch,
      loadSpaces: async () => [], openSession,
    }

    render(<Component {...face} surface="triggers" t={b.locale.bind('enterprise')} useSessions={useSessions} />)
    expect((await screen.findAllByText('日报')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '停用' }))
    await waitFor(() => { expect(setTriggerEnabled).toHaveBeenCalledWith('rule-1', false) })
    expect(screen.getByText('规则已停用')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('事件来源'), { target: { value: 'local-file' } })
    fireEvent.change(screen.getByLabelText('授权目录'), { target: { value: '/tmp/watch' } })
    fireEvent.change(screen.getByLabelText('输入相对路径测试筛选'), { target: { value: 'report.txt' } })
    fireEvent.click(screen.getByRole('button', { name: '立即测试匹配' }))
    await waitFor(() => { expect(testTriggerMatch).toHaveBeenCalledWith('report.txt', ['**/*'], []) })
    expect(screen.getByText('匹配')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    fireEvent.click(screen.getByRole('tab', { name: '运行历史' }))
    fireEvent.click(screen.getByRole('button', { name: '打开会话' }))
    expect(openSession).toHaveBeenCalledWith(sessionId)
    fireEvent.click(screen.getByRole('button', { name: '重新投递' }))
    await waitFor(() => { expect(retryTrigger).toHaveBeenCalledWith('batch-failed') })

    fireEvent.click(screen.getByRole('tab', { name: '执行队列' }))
    fireEvent.click(screen.getByRole('button', { name: '打开会话' }))
    expect(openSession).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    await waitFor(() => { expect(setTriggerEnabled).toHaveBeenCalledWith('rule-1', true) })
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(removeTrigger).toHaveBeenCalledWith('rule-1') })
    await b.ctx.fiber.dispose()
  })

  it('registers enterprise pages inside the existing settings shell and removes them on unload', async () => {
    const b = await bench()
    const entries = b.slots.entries('settings.section')
    expect(inject).toEqual(['slots', 'locale', 'connection', 'mainNavigation', 'modules'])
    expect(entries.map(entry => entry.options.id)).toEqual(['enterprise', 'enterprise-models', 'enterprise-directory', 'enterprise-billing', 'plugins'])
    expect(entries.map(entry => resolveSlotLabel(entry.options.label))).toEqual(['企业账户', '模型', '通讯录', '账单', '企业插件'])

    await b.fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })

  it('uses the shared plugin icon and reflects marketplace navigation in the sidebar action', async () => {
    const b = await bench()
    const entry = b.slots.entries('sidebar.rail.item')[0]!
    const Component = entry.component as ComponentType<MarketActionFace & { wide: boolean; t: TranslateNS<'enterprise'> }>
    const face = (entry.inject as () => MarketActionFace)()
    render(<Component {...face} wide t={b.locale.bind('enterprise')} />)

    const action = screen.getByRole('button', { name: '插件市场' })
    expect(action.querySelector('svg')).toBeTruthy()
    expect(action.textContent).toBe('插件市场')
    expect(action.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(action)
    await waitFor(() => { expect(action.getAttribute('aria-pressed')).toBe('true') })
    await b.ctx.fiber.dispose()
  })

  it('opens the standard package picker and uploads the selected ZIP without a native file control', async () => {
    const b = await bench()
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = marketFace(entry.inject)
    render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)

    expect(await screen.findByRole('heading', { name: '插件市场' })).toBeTruthy()
    expect(b.calls.some(call => call.endpoint === 'plugin-upload')).toBe(false)
    const readsBeforeRefresh = b.calls.filter(call => call.endpoint === 'plugins').length
    fireEvent.click(screen.getByRole('button', { name: '刷新插件目录' }))
    await waitFor(() => { expect(b.calls.filter(call => call.endpoint === 'plugins').length).toBeGreaterThan(readsBeforeRefresh) })
    const uploader = within(screen.getByRole('region', { name: '上传插件包' }))
    expect(uploader.getByRole('combobox', { name: '可见范围' })).toBeTruthy()
    expect(uploader.getByRole('button', { name: '选择插件包' })).toBeTruthy()
    const input = uploader.getByLabelText('插件包文件') as HTMLInputElement
    expect(input.className).toContain('dse-file-input')
    expect(input.accept).toBe('.zip,application/zip')
    const click = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: '选择插件包' }))
    expect(click).toHaveBeenCalledOnce()

    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'manual-demo.dsh-plugin.zip', { type: 'application/zip' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByText('manual-demo.dsh-plugin.zip')).toBeTruthy()
    expect(await screen.findByText('插件已上传，可直接安装。')).toBeTruthy()
    expect(b.calls.find(call => call.endpoint === 'plugin-upload')?.payload).toEqual({ args: {
      visibility: 'private', bytes: [0x50, 0x4b, 0x03, 0x04],
    } })
    await b.ctx.fiber.dispose()
  })

  it('explains package validation failures in the upload panel', async () => {
    const b = await bench({ uploadError: 'Invalid plugin package: missing target entry client/entry.js' })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = marketFace(entry.inject)
    render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)

    await screen.findByRole('heading', { name: '插件市场' })
    const input = screen.getByLabelText('插件包文件')
    const file = new File([new Uint8Array([0x50, 0x4b])], 'broken.dsh-plugin.zip', { type: 'application/zip' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([0x50, 0x4b]).buffer })
    fireEvent.change(input, { target: { files: [file] } })
    expect((await screen.findByRole('alert')).textContent).toBe('插件包校验失败，请确认文件由标准构建器生成且未被修改。')
    await b.ctx.fiber.dispose()
  })

  it('merges immutable releases into one card and upgrades the existing installation', async () => {
    const versions: EnterprisePluginCatalog = [
      { ...catalog[0]!, id: 'release-v1', version: '1.1.0' },
      { ...catalog[0]!, id: 'release-v2', version: '1.2.0' },
    ]
    const b = await bench({
      catalog: versions,
      installations: [{
        id: 'installation', releaseId: 'release-v1', pluginId: 'document-review', version: '1.1.0',
        ownerKind: 'personal', dataSpaceId: 'space', enabled: false, desiredState: 'disabled', observedState: 'disabled',
        permissionRevision: 1, lastError: 'Client bundle failed to execute', config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
      }],
    })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = marketFace(entry.inject)
    render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)

    expect(await screen.findByRole('heading', { name: 'document-review' })).toBeTruthy()
    expect(screen.getByText('1 个插件')).toBeTruthy()
    expect(screen.getByText('版本 1.2.0')).toBeTruthy()
    expect(screen.getByRole('article').textContent).toMatchSnapshot()
    expect(screen.getByRole('alert').textContent).toBe('激活错误: Client bundle failed to execute')
    const upgrade = screen.getByRole('button', { name: '确认权限并升级' })
    const reconcilesBeforeUpgrade = b.calls.filter(call => call.endpoint === 'plugin-runtime-targets').length
    fireEvent.click(upgrade)
    await waitFor(() => { expect(b.calls.some(call => call.endpoint === 'plugin-upgrade')).toBe(true) })
    expect(b.calls.find(call => call.endpoint === 'plugin-upgrade')?.payload).toEqual({ args: {
      installationId: 'installation', releaseId: 'release-v2', confirmPermissions: true,
    } })
    await waitFor(() => {
      expect(b.calls.filter(call => call.endpoint === 'plugin-runtime-targets').length).toBeGreaterThan(reconcilesBeforeUpgrade)
    })
    await b.ctx.fiber.dispose()
  })

  it.each(['tool', 'skill', 'mcp', 'diagnostics', 'host'] as const)('does not claim Agent readiness when %s evidence fails', async (failure) => {
    const installation: EnterprisePluginInstallations[number] = {
      id: 'installation', releaseId: 'release', pluginId: 'document-review', version: '1.2.0',
      ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'active',
      permissionRevision: 1, config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
    }
    const diagnostic = {
      installationId: 'installation', pluginId: 'document-review', version: '1.2.0', targetKind: 'host' as const,
      activationId: '00000000-0000-4000-8000-000000000001', state: failure === 'diagnostics' || failure === 'host' ? 'active' as const : 'stale' as const,
      tools: { names: ['review'], present: failure === 'tool' ? [] : ['review'] },
      skills: { names: ['review-guide'], present: failure === 'skill' ? [] : ['review-guide'] },
      mcpTools: { names: [], present: [] },
      mcpServers: [{ serverName: 'review-server', state: failure === 'mcp' ? 'failed' as const : 'connected' as const,
        discoveredTools: [], reconnectAttempts: 0, ...(failure === 'mcp' ? { lastError: 'connection refused' } : {}) }],
      presets: [], clientSlots: [], clientWindows: [],
    }
    const b = await bench({ installations: [installation], diagnostics: [diagnostic],
      ...(failure === 'diagnostics' ? { diagnosticsError: 'Host unreachable' } : {}),
      ...(failure === 'host' ? { deviceTargets: [
        { installationId: 'installation', pluginId: 'document-review', releaseId: 'release', version: '1.2.0',
          targetKind: 'client' as const, desiredState: 'enabled' as const, observedState: 'active' as const, permissionRevision: 1, cleanupState: 'none' as const },
        { installationId: 'installation', pluginId: 'document-review', releaseId: 'release', version: '1.2.0',
          targetKind: 'host' as const, desiredState: 'enabled' as const, observedState: 'failed' as const, permissionRevision: 1, cleanupState: 'none' as const, lastError: 'Host load failed' },
      ] } : {}),
    })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    render(<Component {...marketFace(entry.inject)} surface="plugin-market" t={b.locale.bind('enterprise')} />)
    const heading = await screen.findByRole('heading', { name: 'document-review' })
    const card = within(heading.closest('article')!)
    expect(card.getByText(failure === 'diagnostics' ? '未知' : '失败', { exact: true })).toBeTruthy()
    expect(card.queryByText('运行中', { exact: true })).toBeNull()
    if (failure === 'diagnostics') {
      expect(screen.getByRole('alert').textContent).toContain('运行时能力状态暂时不可用')
      expect(screen.getByRole('alert').textContent).toContain('Host unreachable')
    }
    else {
      const details = card.getByText('运行详情', { exact: true }).closest('details')!
      expect(details.open).toBe(false)
      fireEvent.click(card.getByText('运行详情', { exact: true }))
      expect(details.open).toBe(true)
      expect(card.getByText(/工具: /)).toBeTruthy()
      expect(card.getByRole('alert').textContent).toContain(failure === 'tool' ? '能力未注册：review' : failure === 'skill' ? '能力未注册：review-guide' : failure === 'mcp' ? 'connection refused' : 'Host load failed')
    }
    await b.ctx.fiber.dispose()
  })

  it('configures an ordinary plugin with typed fields and retains saved secrets on blank input', async () => {
    const b = await bench({ catalog: [{ ...catalog[0]!, pluginId: 'weknora', setupKind: 'configuration' }], installations: [{
      id: 'installation', releaseId: 'release', pluginId: 'weknora', version: '1.2.0',
      ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'failed',
      permissionRevision: 1, lastError: 'plugin/not-configured: Server URL', config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
    }] })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const saved = vi.fn(async () => {})
    const view = render(<Component {...{
      ...marketFace(entry.inject), configurePluginSettings: saved,
      loadPluginSettings: async () => ({ installationId: 'installation', specification: { fields: [
        { name: 'baseUrl', label: 'Server URL', type: 'url' as const, required: true },
        { name: 'limit', label: 'Limit', type: 'number' as const, required: false, integer: true },
        { name: 'secure', label: 'TLS', type: 'boolean' as const, required: false },
        { name: 'roster', label: 'Roster', type: 'string-list' as const, required: false },
      ] }, config: { baseUrl: 'https://knowledge.example', limit: 10, secure: true, roster: ['Alice'] },
      credentials: [{ name: 'api-key', label: 'API Key', configured: true }] }),
    }} surface="plugin-market" t={b.locale.bind('enterprise')} />)
    try {
      expect(await screen.findByText('待配置', { exact: true })).toBeTruthy()
      expect(screen.queryByText('待连接／授权')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: '配置插件' }))
      let dialog = await screen.findByRole('dialog')
      const url = await within(dialog).findByLabelText<HTMLInputElement>('Server URL')
      expect(url.value).toBe('https://knowledge.example')
      expect(within(dialog).getByLabelText<HTMLInputElement>('API Key').value).toBe('')
      expect(within(dialog).getByLabelText<HTMLInputElement>('API Key').type).toBe('password')
      fireEvent.change(within(dialog).getByLabelText('Limit'), { target: { value: '20' } })
      fireEvent.click(within(dialog).getByLabelText('TLS'))
      fireEvent.change(within(dialog).getByLabelText('Roster'), { target: { value: 'Alice\nBob\n' } })
      expect(dialog.textContent).toMatchSnapshot()
      fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
      await waitFor(() => { expect(saved).toHaveBeenCalledWith({ installationId: 'installation', config: { baseUrl: 'https://knowledge.example', limit: 20, secure: false, roster: ['Alice', 'Bob'] }, credentials: {} }) })
      await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
      fireEvent.click(screen.getByRole('button', { name: '配置插件' }))
      dialog = await screen.findByRole('dialog')
      fireEvent.change(await within(dialog).findByLabelText('API Key'), { target: { value: 'PRIVATE_NEW_KEY' } })
      fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
      await waitFor(() => { expect(saved).toHaveBeenLastCalledWith(expect.objectContaining({ credentials: { 'api-key': 'PRIVATE_NEW_KEY' } })) })
    } finally { view.unmount(); await b.ctx.fiber.dispose() }
  })

  it.each(['oauth', 'token', 'none'] as const)('offers %s connection inputs and keeps missing authorization out of Loader diagnostics', async (auth) => {
    const b = await bench({ catalog: [{ ...catalog[0]!, pluginId: 'qcc', setupKind: 'mcp' }], installations: [{
      id: 'installation', releaseId: 'release', pluginId: 'qcc', version: '1.2.0',
      ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'failed',
      permissionRevision: 1, lastError: 'failed to apply loader entry file:///private/path: plugin/not-configured: credential api-key is required',
      config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
    }] })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const configured = vi.fn(async () => {})
    const authorized = vi.fn(async () => ({ url: 'https://fixture.example/login' }))
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const openExternal = vi.fn(async () => true)
    Object.defineProperty(window, '__dshNative', { configurable: true, value: {
      runtimeStorageIdentity: 'test-runtime', openExternal,
      switchOrganization: vi.fn(async () => {}), logout: vi.fn(async () => {}),
    } })
    const pending = new Promise<{ complete: boolean }>(() => {})
    render(<Component {...{
      ...marketFace(entry.inject),
      loadConnectionSettings: async () => ({ installationId: 'installation', connection: { auth, ...(auth === 'none' ? {} : { url: 'https://fixture.example/mcp' }), ...(auth === 'token' ? { credentialUrl: 'https://fixture.example/credentials' } : {}) }, configured: false, ...(auth === 'none' ? { customUrl: 'https://custom.example/mcp' } : {}) }),
      configureConnection: configured, authorizeConnection: authorized,
      authorizationStatus: async (_id: string, cancel?: boolean) => cancel ? { complete: false } : pending,
    }} surface="plugin-market" t={b.locale.bind('enterprise')} />)
    expect(await screen.findByText('待连接／授权')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '连接服务' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => { expect(within(dialog).getByRole('button', { name: auth === 'oauth' ? '登录并授权' : '保存' })).toBeTruthy() })
    if (auth === 'token') {
      const link = within(dialog).getByRole('link', { name: '打开服务商官网' })
      expect(fireEvent.click(link)).toBe(false)
      await waitFor(() => { expect(openExternal).toHaveBeenCalledWith({ url: 'https://fixture.example/credentials' }) })
      expect(open).not.toHaveBeenCalled()
      expect(authorized).not.toHaveBeenCalled()
      delete (window as Window & { __dshNative?: unknown }).__dshNative
      expect(fireEvent.click(link)).toBe(true)
      expect((link as HTMLAnchorElement).target).toBe('_blank')
      fireEvent.change(within(dialog).getByLabelText('服务商 Token'), { target: { value: 'PRIVATE_INPUT' } })
    }
    if (auth === 'none') expect(within(dialog).getByLabelText<HTMLInputElement>('MCP 服务地址').value).toBe('https://custom.example/mcp')
    else expect(within(dialog).queryByRole('textbox', { name: 'MCP 服务地址' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: auth === 'oauth' ? '登录并授权' : '保存' }))
    if (auth === 'oauth') {
      await waitFor(() => { expect(openExternal).toHaveBeenCalledWith({ url: 'https://fixture.example/login' }) })
      expect(open).not.toHaveBeenCalled()
      expect(configured).not.toHaveBeenCalled()
      fireEvent.click(within(dialog).getByText('取消', { exact: true }))
    } else await waitFor(() => { expect(configured).toHaveBeenCalledWith(auth === 'none' ? { installationId: 'installation', url: 'https://custom.example/mcp' } : { installationId: 'installation', token: 'PRIVATE_INPUT' }) })
    open.mockRestore()
    delete (window as Window & { __dshNative?: unknown }).__dshNative
    await b.ctx.fiber.dispose()
  })

  it.each([
    { code: 'discovery-failed', message: '无法读取服务的授权信息，请检查网络或联系服务提供方。' },
    { code: 'registration-failed', message: '服务拒绝注册登录客户端，请联系服务提供方。' },
    { code: 'exchange-failed', message: '授权码换取凭据失败，请重新登录授权。' },
    { code: 'denied', message: '服务未批准此次授权，请重新登录并确认权限。' },
    { code: 'cancelled', message: '授权已取消或超时，可以重新登录。' },
  ])('explains OAuth $code from both preparation and browser status', async ({ code, message }) => {
    const b = await bench({ catalog: [{ ...catalog[0]!, pluginId: 'fixture-mcp', setupKind: 'mcp' }], installations: [{
      id: 'installation', releaseId: 'release', pluginId: 'fixture-mcp', version: '1.2.0',
      ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'failed',
      permissionRevision: 1, lastError: 'plugin/not-configured: authorization is required',
      config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
    }] })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const failure = `plugin/authorization-${code}`
    const authorized = vi.fn(async () => ({ url: 'https://fixture.example/login' }))
      .mockRejectedValueOnce(new Error(failure))
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const view = render(<Component {...{
      ...marketFace(entry.inject),
      loadConnectionSettings: async () => ({ installationId: 'installation', connection: { auth: 'oauth' as const, url: 'https://fixture.example/mcp' }, configured: false }),
      configureConnection: async () => {}, authorizeConnection: authorized,
      authorizationStatus: async () => ({ complete: false, error: failure }),
    }} surface="plugin-market" t={b.locale.bind('enterprise')} />)
    try {
      fireEvent.click(await screen.findByRole('button', { name: '连接服务' }))
      const dialog = await screen.findByRole('dialog')
      const login = await within(dialog).findByRole('button', { name: '登录并授权' })
      await waitFor(() => { expect((login as HTMLButtonElement).disabled).toBe(false) })
      fireEvent.click(login)
      expect((await within(dialog).findByRole('alert')).textContent).toBe(message)
      expect(open).not.toHaveBeenCalled()
      fireEvent.click(login)
      await waitFor(() => { expect(authorized).toHaveBeenCalledTimes(2) })
      await waitFor(() => { expect(open).toHaveBeenCalledWith('https://fixture.example/login', '_blank', 'noopener,noreferrer') })
      await waitFor(() => { expect(within(dialog).getByRole('alert').textContent).toBe(message) })
      expect(dialog.textContent).toMatchSnapshot()
    } finally { view.unmount(); open.mockRestore(); await b.ctx.fiber.dispose() }
  })

  it.each([
    { firstState: 'completed', next: 'second-mcp' },
    { firstState: 'cancelled', next: 'second-mcp' },
    { firstState: 'pending', next: 'second-mcp' },
    { firstState: 'pending', next: 'first-mcp' },
  ] as const)('opens $next after the first authorization is $firstState', async ({ firstState, next }) => {
    const services = ['first-mcp', 'second-mcp']
    const b = await bench({ catalog: services.map(id => ({ ...catalog[0]!, id, pluginId: id, setupKind: 'mcp' as const })), installations: services.map(id => ({
      id, releaseId: id, pluginId: id, version: '1.2.0', ownerKind: 'personal', dataSpaceId: 'space',
      enabled: true, desiredState: 'enabled', observedState: 'failed', permissionRevision: 1,
      lastError: 'plugin/not-configured: authorization is required', config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
    })) })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const descriptor = Object.getOwnPropertyDescriptor(window, '__dshNative')
    const openExternal = vi.fn(async () => true)
    Object.defineProperty(window, '__dshNative', { configurable: true, value: { openExternal } })
    let deliverFirst!: (value: { url: string }) => void
    const firstAuthorization = new Promise<{ url: string }>((resolve) => { deliverFirst = resolve })
    let deliverStatus!: (value: { complete: boolean }) => void
    const firstStatus = new Promise<{ complete: boolean }>((resolve) => { deliverStatus = resolve })
    let finishCancellation!: (value: { complete: boolean }) => void
    const cancellation = new Promise<{ complete: boolean }>((resolve) => { finishCancellation = resolve })
    const authorized = vi.fn<(id: string) => Promise<{ url: string }>>()
      .mockResolvedValue({ url: 'https://second.example/login' }).mockImplementationOnce(async () => firstAuthorization)
    const status = vi.fn(async (id: string, cancel?: boolean) => cancel
      ? next === services[0] ? cancellation : { complete: false }
      : id === services[0] ? firstStatus : { complete: false })
    const view = render(<Component {...{
      ...marketFace(entry.inject),
      loadConnectionSettings: async (id: string) => ({ installationId: id, connection: { auth: 'oauth' as const, url: `https://${id}.example/mcp` }, configured: false }),
      configureConnection: async () => {}, authorizeConnection: authorized, authorizationStatus: status,
    }} surface="plugin-market" t={b.locale.bind('enterprise')} />)
    const connect = async (id: string): Promise<HTMLElement> => {
      const heading = await screen.findByRole('heading', { name: id })
      fireEvent.click(within(heading.closest('article')!).getByRole('button', { name: '连接服务' }))
      const dialog = await screen.findByRole('dialog')
      await waitFor(() => { expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: '登录并授权' }).disabled).toBe(false) })
      return dialog
    }
    try {
      const first = await connect(services[0]!)
      fireEvent.click(within(first).getByRole('button', { name: '登录并授权' }))
      await waitFor(() => { expect(authorized).toHaveBeenCalledWith(services[0]) })
      if (firstState !== 'pending') {
        await act(async () => { deliverFirst({ url: 'https://first.example/login' }) })
        expect(openExternal).toHaveBeenCalledWith({ url: 'https://first.example/login' })
        await waitFor(() => { expect(status).toHaveBeenCalledWith(services[0]) })
      }
      if (firstState === 'completed') {
        await act(async () => { deliverStatus({ complete: true }) })
        await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
      } else fireEvent.click(within(first).getByText('取消', { exact: true }))
      const second = await connect(next)
      if (firstState === 'pending') {
        await act(async () => { deliverFirst({ url: 'https://first.example/login' }) })
        expect(openExternal).not.toHaveBeenCalled()
        await waitFor(() => { expect(status).toHaveBeenCalledWith(services[0], true) })
      } else if (firstState === 'cancelled') await act(async () => { deliverStatus({ complete: true }) })
      expect(within(second).getByRole<HTMLButtonElement>('button', { name: '登录并授权' }).disabled).toBe(false)
      if (firstState === 'pending' && next === 'second-mcp') expect(second.textContent).toMatchSnapshot()
      fireEvent.click(within(second).getByRole('button', { name: '登录并授权' }))
      if (next === services[0]) {
        expect(authorized).toHaveBeenCalledTimes(1)
        await act(async () => { finishCancellation({ complete: false }) })
      }
      await waitFor(() => { expect(openExternal).toHaveBeenCalledWith({ url: 'https://second.example/login' }) })
      expect(authorized).toHaveBeenLastCalledWith(next)
      expect(within(second).getByRole('link', { name: '登录并授权' }).getAttribute('href')).toBe('https://second.example/login')
    } finally {
      view.unmount()
      await act(async () => { deliverFirst({ url: 'https://first.example/login' }); deliverStatus({ complete: false }); finishCancellation({ complete: false }) })
      if (descriptor) Object.defineProperty(window, '__dshNative', descriptor)
      else delete (window as Window & { __dshNative?: unknown }).__dshNative
      await b.ctx.fiber.dispose()
    }
  })

  it.each(['resolve', 'reject'] as const)('ignores an authorization %s after leaving the marketplace', async (outcome) => {
    const b = await bench({ catalog: [{ ...catalog[0]!, pluginId: 'fixture-mcp', setupKind: 'mcp' }], installations: [{
      id: 'installation', releaseId: 'release', pluginId: 'fixture-mcp', version: '1.2.0',
      ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'failed',
      permissionRevision: 1, lastError: 'plugin/not-configured: authorization is required',
      config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
    }] })
    const descriptor = Object.getOwnPropertyDescriptor(window, '__dshNative')
    const openExternal = vi.fn(async () => true)
    const cancelled = vi.fn(async () => ({ complete: false }))
    let resolveAuthorization!: (value: { url: string }) => void
    let rejectAuthorization!: (error: Error) => void
    const authorization = new Promise<{ url: string }>((resolve, reject) => { resolveAuthorization = resolve
      rejectAuthorization = reject })
    const authorized = vi.fn(async () => authorization)
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    let view: ReturnType<typeof render> | undefined
    try {
      Object.defineProperty(window, '__dshNative', { configurable: true, value: { openExternal } })
      view = render(<Component {...{
        ...marketFace(entry.inject),
        loadConnectionSettings: async () => ({ installationId: 'installation', connection: { auth: 'oauth' as const, url: 'https://fixture.example/mcp' }, configured: false }),
        configureConnection: async () => {}, authorizeConnection: authorized, authorizationStatus: cancelled,
      }} surface="plugin-market" t={b.locale.bind('enterprise')} />)
      fireEvent.click(await screen.findByRole('button', { name: '连接服务' }))
      const dialog = await screen.findByRole('dialog')
      await waitFor(() => { expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: '登录并授权' }).disabled).toBe(false) })
      fireEvent.click(within(dialog).getByRole('button', { name: '登录并授权' }))
      await waitFor(() => { expect(authorized).toHaveBeenCalledTimes(1) })
      view.unmount()
      await act(async () => {
        if (outcome === 'resolve') resolveAuthorization({ url: 'https://fixture.example/login' })
        else rejectAuthorization(new Error('discovery failed'))
      })
      expect(openExternal).not.toHaveBeenCalled()
      if (outcome === 'resolve') expect(cancelled).toHaveBeenCalledExactlyOnceWith('installation', true)
      else expect(cancelled).not.toHaveBeenCalled()
    } finally {
      view?.unmount()
      await act(async () => { resolveAuthorization({ url: 'https://fixture.example/login' }) })
      if (descriptor) Object.defineProperty(window, '__dshNative', descriptor)
      else delete (window as Window & { __dshNative?: unknown }).__dshNative
      await b.ctx.fiber.dispose()
    }
  })

  it('filters the compact marketplace list by search, type, and status', async () => {
    const b = await bench({ catalog: [
      { ...catalog[0]!, id: 'feishu-release', pluginId: 'feishu-daily-report', name: '飞书日报汇总', description: '汇总团队日报', publishedAt: '2026-09-19T12:00:00Z' },
      { ...catalog[0]!, id: 'notion-release', pluginId: 'notion-mcp', setupKind: 'mcp', category: 'mcp', name: 'Notion', description: '连接 Notion 工作区', publishedAt: '2026-09-20T12:00:00Z' },
    ] })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = marketFace(entry.inject)
    render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)

    expect(await screen.findByRole('heading', { name: 'Notion' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '飞书日报汇总' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索插件名称或用途' }), { target: { value: 'Notion' } })
    expect(screen.getByRole('heading', { name: 'Notion' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '飞书日报汇总' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'MCP 服务' }))
    expect(screen.getByRole('heading', { name: 'Notion' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '可更新' }))
    expect(screen.getByText('暂无可用的企业插件。')).toBeTruthy()
    await b.ctx.fiber.dispose()
  })

  it('reconciles Client targets immediately after installing a release', async () => {
    const b = await bench()
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = marketFace(entry.inject)
    render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)

    expect(await screen.findByRole('heading', { name: 'document-review' })).toBeTruthy()
    await waitFor(() => { expect(b.calls.filter(call => call.endpoint === 'plugin-runtime-targets').length).toBeGreaterThan(0) })
    const beforeInstall = b.calls.filter(call => call.endpoint === 'plugin-runtime-targets').length
    fireEvent.click(screen.getByRole('button', { name: '安装' }))
    await waitFor(() => { expect(b.calls.some(call => call.endpoint === 'plugin-install')).toBe(true) })
    await waitFor(() => { expect(b.calls.filter(call => call.endpoint === 'plugin-runtime-targets').length).toBeGreaterThan(beforeInstall) })
    await b.ctx.fiber.dispose()
  })

  it.each(['active', 'failed'] as const)('refreshes preparing to %s after reconciliation without a manual refresh', async (finalState) => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const options = {
      generationReady: false,
      runtimeReconcile: () => pending,
      installations: [{
        id: 'installation', releaseId: 'release', pluginId: 'document-review', version: '1.2.0',
        ownerKind: 'personal' as const, dataSpaceId: 'space', enabled: true,
        desiredState: 'enabled' as const, observedState: 'preparing' as const,
        permissionRevision: 1, config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
      }] as EnterprisePluginInstallations,
    }
    const b = await bench(options)
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = marketFace(entry.inject)
    const view = render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)
    try {
      await screen.findByText('准备中')
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '停用' }).disabled).toBe(false)
      fireEvent.click(screen.getByText('更多操作', { exact: true }))
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '卸载并保留数据' }).disabled).toBe(false)
      b.connect()
      await waitFor(() => { expect(b.calls.some(call => call.endpoint === 'plugin-runtime-targets')).toBe(true) })
      options.installations = [{ ...options.installations[0]!, observedState: finalState,
        ...(finalState === 'failed' ? { lastError: 'activation fixture failure' } : {}),
      }]
      finish()
      await screen.findByText(finalState === 'active' ? '运行中' : '失败')
      expect(screen.queryByText('准备中')).toBeNull()
      if (finalState === 'failed') expect(screen.getByRole('alert').textContent).toContain('activation fixture failure')
      const reads = b.calls.filter(call => call.endpoint === 'plugin-installations').length
      view.unmount()
      await b.ctx.fiber.dispose()
      b.connect()
      expect(b.calls.filter(call => call.endpoint === 'plugin-installations')).toHaveLength(reads)
    } finally {
      finish()
      view.unmount()
      await b.ctx.fiber.dispose()
    }
  })

  it('keeps a completed activation when an older preparation read arrives late', async () => {
    let finishRead!: (items: EnterprisePluginInstallations) => void
    const oldRead = new Promise<EnterprisePluginInstallations>((resolve) => { finishRead = resolve })
    const installation: EnterprisePluginInstallations[number] = {
      id: 'installation', releaseId: 'release', pluginId: 'document-review', version: '1.2.0',
      ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'active',
      permissionRevision: 1, config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
    }
    const b = await bench({ generationReady: false, installations: [installation] })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = marketFace(entry.inject)
    const loadLatest = face.loadPluginInstallations
    let reads = 0
    face.loadPluginInstallations = () => ++reads === 1 ? oldRead : loadLatest()
    const view = render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)
    try {
      await waitFor(() => { expect(reads).toBe(1) })
      b.connect()
      await screen.findByText('运行中')
      finishRead([{ ...installation, observedState: 'preparing' }])
      await oldRead
      await waitFor(() => { expect(screen.queryByText('准备中')).toBeNull() })
      expect(screen.getByText('运行中')).toBeTruthy()
    } finally {
      finishRead([])
      view.unmount()
      await b.ctx.fiber.dispose()
    }
  })

  it('keeps an active installation actionable when a target reports stale preparation', async () => {
    const versions: EnterprisePluginCatalog = [
      { ...catalog[0]!, id: 'release-v1', version: '1.1.0' },
      { ...catalog[0]!, id: 'release-v2', version: '1.2.0' },
    ]
    const b = await bench({
      catalog: versions,
      installations: [{
        id: 'installation', releaseId: 'release-v1', pluginId: 'document-review', version: '1.1.0',
        ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'active',
        permissionRevision: 1, config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
      }],
      deviceTargets: [
        { installationId: 'installation', pluginId: 'document-review', releaseId: 'release-v1', version: '1.1.0', targetKind: 'host', desiredState: 'enabled', observedState: 'active', permissionRevision: 1, cleanupState: 'none' },
        { installationId: 'installation', pluginId: 'document-review', releaseId: 'release-v1', version: '1.1.0', targetKind: 'client', desiredState: 'enabled', observedState: 'preparing', permissionRevision: 1, cleanupState: 'none' },
      ] satisfies EnterprisePluginDeviceTargets,
    })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = marketFace(entry.inject)
    render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)

    const card = await screen.findByRole('article')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '确认权限并升级' }).disabled).toBe(false)
    expect(card.querySelector('button[disabled]')).toBeNull()
    expect(screen.getByText('更多操作', { exact: true }).closest('details')!.open).toBe(false)
    fireEvent.click(screen.getByText('更多操作', { exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '强制中断并清除所有版本' }))
    const dialog = screen.getByRole('dialog', { name: '强制中断并清除所有版本' })
    expect(b.calls.filter(call => call.endpoint === 'plugin-force-remove')).toHaveLength(0)
    const reconcilesBeforeForceRemove = b.calls.filter(call => call.endpoint === 'plugin-runtime-targets').length
    fireEvent.click(within(dialog).getByRole('button', { name: '强制中断并清除所有版本' }))
    await waitFor(() => { expect(b.calls.filter(call => call.endpoint === 'plugin-force-remove')).toHaveLength(1) })
    await waitFor(() => { expect(b.calls.filter(call => call.endpoint === 'plugin-runtime-targets').length).toBeGreaterThan(reconcilesBeforeForceRemove) })
    expect(await screen.findByText('插件已强制中断，所有版本已撤销。')).toBeTruthy()
    await b.ctx.fiber.dispose()
  })

  it('reports the force-remove error message returned by the bridge', async () => {
    const b = await bench({
      forceRemoveError: 'plugin/operation-in-progress',
      installations: [{
        id: 'installation', releaseId: 'release', pluginId: 'document-review', version: '1.2.0',
        ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'active',
        permissionRevision: 1, config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
      }],
    })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = marketFace(entry.inject)
    render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)
    await screen.findByRole('heading', { name: 'document-review' })
    expect(screen.getByText('更多操作', { exact: true }).closest('details')!.open).toBe(false)
    fireEvent.click(screen.getByText('更多操作', { exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '强制中断并清除所有版本' }))
    const dialog = screen.getByRole('dialog', { name: '强制中断并清除所有版本' })
    fireEvent.click(within(dialog).getByRole('button', { name: '强制中断并清除所有版本' }))
    expect(await screen.findByText('操作失败，请重试。 plugin/operation-in-progress')).toBeTruthy()
    await b.ctx.fiber.dispose()
  })

  it('does not offer organization plugin mutations to a member', async () => {
    const b = await bench({
      role: 'member',
      installations: [{
        id: 'organization-installation', releaseId: 'release', pluginId: 'document-review', version: '1.2.0',
        ownerKind: 'organization', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'active',
        permissionRevision: 3, config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
      }],
    })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = marketFace(entry.inject)
    render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)

    await screen.findByRole('heading', { name: 'document-review' })
    expect(screen.getByText('当前账号没有管理此组织插件的权限。')).toBeTruthy()
    fireEvent.click(screen.getByText('更多操作', { exact: true }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '强制中断并清除所有版本' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '停用' }).disabled).toBe(true)
    expect(b.calls.filter(call => call.endpoint === 'plugin-force-remove')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })

  it('keeps force removal successful when local runtime reconciliation fails', async () => {
    const b = await bench({
      runtimeReconcileError: 'local runtime is unavailable',
      installations: [{
        id: 'installation', releaseId: 'release', pluginId: 'document-review', version: '1.2.0',
        ownerKind: 'personal', dataSpaceId: 'space', enabled: true, desiredState: 'enabled', observedState: 'active',
        permissionRevision: 1, config: {}, targetState: {}, updatedAt: '2026-09-18T00:00:00.000Z',
      }],
    })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = marketFace(entry.inject)
    render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)
    await screen.findByRole('heading', { name: 'document-review' })
    expect(screen.getByText('更多操作', { exact: true }).closest('details')!.open).toBe(false)
    fireEvent.click(screen.getByText('更多操作', { exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '强制中断并清除所有版本' }))
    const dialog = screen.getByRole('dialog', { name: '强制中断并清除所有版本' })
    fireEvent.click(within(dialog).getByRole('button', { name: '强制中断并清除所有版本' }))
    expect(await screen.findByText('插件已强制中断，所有版本已撤销。')).toBeTruthy()
    expect(b.calls.filter(call => call.endpoint === 'plugin-force-remove')).toHaveLength(1)
    await b.ctx.fiber.dispose()
  })

  it('keeps another plugin actionable while one installation is pending', async () => {
    const b = await bench({ catalog: [
      { ...catalog[0]!, id: 'release-a', pluginId: 'plugin-a' },
      { ...catalog[0]!, id: 'release-b', pluginId: 'plugin-b' },
    ] })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = marketFace(entry.inject)
    let releaseFirst: (() => void) | undefined
    const firstInstall = new Promise<void>((resolve) => { releaseFirst = resolve })
    const installPlugin = vi.fn(async (releaseId: string) => {
      if (releaseId === 'release-a') await firstInstall
    })
    render(<Component {...face} installPlugin={installPlugin} surface="plugin-market" t={b.locale.bind('enterprise')} />)

    expect(await screen.findByRole('heading', { name: 'plugin-a' })).toBeTruthy()
    const cards = screen.getAllByRole('article')
    const firstCard = cards.find(card => card.textContent?.includes('plugin-a'))!
    const secondCard = cards.find(card => card.textContent?.includes('plugin-b'))!
    fireEvent.click(firstCard.querySelector('button')!)
    fireEvent.click(secondCard.querySelector('button')!)
    await waitFor(() => { expect(installPlugin).toHaveBeenCalledWith('release-b') })
    releaseFirst?.()
    await b.ctx.fiber.dispose()
  })

  it('allows selecting only an available platform model', async () => {
    const b = await bench()
    const entry = b.slots.entries('settings.section').find(item => item.options.id === 'enterprise-models')!
    const { Component, face } = section(entry)
    render(<Component {...face} t={b.locale.bind('enterprise')} />)
    expect(await screen.findByRole('heading', { name: '模型' })).toBeTruthy()
    expect(screen.getByText('Enterprise Chat')).toBeTruthy()
    expect(screen.getByText('65,536')).toBeTruthy()
    expect(screen.getByText(/视频同时理解音轨/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '可用模型' }).parentElement?.textContent).toMatchSnapshot()
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'model' } })
    await waitFor(() => { expect(b.calls.some(call => call.endpoint === 'set-model')).toBe(true) })
  })

  it('keeps account settings focused on identity and devices and confirms revocation', async () => {
    const b = await bench()
    const entry = b.slots.entries('settings.section').find(item => item.options.id === 'enterprise')!
    const { Component, face } = section(entry)
    const t = b.locale.bind('enterprise')
    render(<Component {...face} t={t} />)

    expect(await screen.findByRole('heading', { name: 'Acme Research' })).toBeTruthy()
    expect(screen.queryByText('Enterprise Chat')).toBeNull()
    expect(screen.queryByRole('heading', { name: '我的近期用量' })).toBeNull()
    expect(screen.getByRole('heading', { name: '套餐' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '设备' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '企业账户' }).parentElement?.parentElement?.textContent).toMatchSnapshot()
    const revoke = screen.getByRole('button', { name: '撤销' })
    fireEvent.click(revoke)
    expect(b.calls.filter(call => call.endpoint === 'revoke-runtime')).toHaveLength(0)
    await waitFor(() => { expect(screen.getByRole('button', { name: '再次点击以撤销此设备' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '再次点击以撤销此设备' }))
    await waitFor(() => { expect(b.calls.filter(call => call.endpoint === 'revoke-runtime')).toHaveLength(1) })
    expect(b.calls.find(call => call.endpoint === 'revoke-runtime')?.payload).toEqual({ args: { runtimeId: 'runtime' } })
    await b.ctx.fiber.dispose()
  })

  it('opens the plugin market and closes settings without fetching a duplicate catalog', async () => {
    const b = await bench()
    const entry = b.slots.entries('settings.section').find(item => item.options.id === 'plugins')!
    const { Component, face } = section(entry)
    const close = vi.fn()
    render(<Component {...face} close={close} t={b.locale.bind('enterprise')} />)

    expect(screen.queryByText('document-review')).toBeNull()
    expect(b.calls.filter(call => call.endpoint === 'plugins')).toHaveLength(0)
    expect(screen.getByRole('heading', { name: '企业插件' }).parentElement?.parentElement?.textContent).toMatchSnapshot()
    fireEvent.click(screen.getByRole('button', { name: '打开插件市场' }))
    expect(close).toHaveBeenCalledOnce()
    expect(b.ctx.mainNavigation.get()).toBe('plugin-market')
    await b.ctx.fiber.dispose()
  })

  it('shows an empty model catalog without offering a stale default', async () => {
    const b = await bench()
    const { Component, face } = section(b.slots.entries('settings.section').find(item => item.options.id === 'enterprise-models')!)
    render(<Component {...face} loadDashboard={async () => ({ ...dashboard, models: [] })} t={b.locale.bind('enterprise')} />)
    expect(await screen.findByText('当前组织暂无可用模型，请联系管理员。')).toBeTruthy()
    expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('option', { name: /Enterprise Chat/ })).toBeNull()
    await b.ctx.fiber.dispose()
  })

  it('lets every member view and redeem the shared wallet without loading team management data', async () => {
    const b = await bench()
    const entry = b.slots.entries('settings.section').find(item => item.options.id === 'enterprise-billing')!
    const { Component, face } = section(entry)
    render(<Component {...face} t={b.locale.bind('enterprise')} />)

    expect(await screen.findByText('¥12.50')).toBeTruthy()
    expect(screen.getByText('兑换入账')).toBeTruthy()
    expect(screen.getByText('4 调用')).toBeTruthy()
    expect(screen.getByText(/1,500 Token/)).toBeTruthy()
    expect(screen.getByText(/¥0\.125081 已结算费用（人民币）/)).toBeTruthy()
    expect(screen.getByText('1 笔历史调用未按人民币计价')).toBeTruthy()
    expect(screen.queryByText('我的本月用量')).toBeNull()
    expect(b.calls.filter(call => call.endpoint === 'own-usage')).toHaveLength(0)
    expect(screen.getByRole('heading', { name: '我的近期用量' }).parentElement?.textContent).toMatchSnapshot()

    expect(screen.queryByRole('heading', { name: '邀请成员' })).toBeNull()
    expect(b.calls.filter(call => call.endpoint === 'team')).toHaveLength(0)
    expect(b.calls.filter(call => call.endpoint === 'member-usage')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('兑换码'), { target: { value: 'REDEEM-CODE-1234567890' } })
    fireEvent.click(screen.getByRole('button', { name: '兑换' }))
    await waitFor(() => {
      expect(b.calls.find(call => call.endpoint === 'redeem')?.payload).toEqual({ args: { code: 'REDEEM-CODE-1234567890' } })
    })
    await b.ctx.fiber.dispose()
  })

  it('shows member access limits on the directory without requesting billing or team details', async () => {
    const b = await bench()
    const entry = b.slots.entries('settings.section').find(item => item.options.id === 'enterprise-directory')!
    const { Component, face } = section(entry)
    render(<Component {...face} t={b.locale.bind('enterprise')} />)

    expect(await screen.findByText('当前账号没有查看通讯录的权限。')).toBeTruthy()
    expect(b.calls.filter(call => ['team', 'wallet', 'wallet-ledger', 'own-usage'].includes(call.endpoint))).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: '邀请成员' })).toBeNull()
    await b.ctx.fiber.dispose()
  })

  it('lets an owner invite administrators, inspect paged member usage, filter dates, and revoke invitations', async () => {
    const b = await bench({ role: 'owner' })
    const entry = b.slots.entries('settings.section').find(item => item.options.id === 'enterprise-directory')!
    const { Component, face } = section(entry)
    render(<Component {...face} t={b.locale.bind('enterprise')} />)

    expect(await screen.findByRole('heading', { name: '成员及本月用量' })).toBeTruthy()
    expect(b.calls.filter(call => ['wallet', 'wallet-ledger', 'own-usage'].includes(call.endpoint))).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: '团队人民币余额' })).toBeNull()
    expect(screen.getByRole('option', { name: '管理员' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('成员邮箱'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('成员角色'), { target: { value: 'administrator' } })
    fireEvent.click(screen.getByRole('button', { name: '发送邀请' }))
    await waitFor(() => {
      expect(b.calls.find(call => call.endpoint === 'invite-member')?.payload).toEqual({
        args: { email: 'new@example.com', role: 'administrator' },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: /Alice/ }))
    expect(await screen.findByText('usage-member-1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(await screen.findByText('usage-member-2')).toBeTruthy()
    expect(screen.getByText('usage-member-1')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-10' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-09-12' } })
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    await waitFor(() => {
      expect(b.calls.filter(call => call.endpoint === 'team').at(-1)?.payload).toEqual({ args: {
        from: '2026-09-09T16:00:00.000Z',
        to: '2026-09-12T16:00:00.000Z',
      } })
    })

    fireEvent.click(screen.getByRole('button', { name: '撤销邀请' }))
    await waitFor(() => {
      expect(b.calls.find(call => call.endpoint === 'revoke-invitation')?.payload).toEqual({ args: { invitationId: 'invitation-1' } })
    })
    await b.ctx.fiber.dispose()
  })

  it('does not offer the administrator role to an administrator', async () => {
    const b = await bench({ role: 'administrator' })
    const entry = b.slots.entries('settings.section').find(item => item.options.id === 'enterprise-directory')!
    const { Component, face } = section(entry)
    render(<Component {...face} t={b.locale.bind('enterprise')} />)

    expect(await screen.findByRole('heading', { name: '邀请成员' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: '管理员' })).toBeNull()
    await b.ctx.fiber.dispose()
  })
})
