// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { apply, inject } from '../src/client/index.ts'
import { driveFilePage } from '../src/wire.ts'
import type {
  EnterpriseDashboard,
  EnterprisePluginCatalog,
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

const dashboard: EnterpriseDashboard = {
  organization: { id: 'organization', name: 'Acme Research', kind: 'team', status: 'active', policyRevision: 7 },
  subscription: { plan: 'Enterprise', seats: 20, runtimes: 6 },
  roles: [{ role: 'member', unitId: null }],
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

async function bench(options: { role?: 'member' | 'administrator' | 'owner'; uploadError?: string; catalog?: EnterprisePluginCatalog; installations?: EnterprisePluginInstallations; generationReady?: boolean } = {}) {
  const calls: Array<{ endpoint: string; payload: unknown }> = []
  const dashboardValue = {
    ...dashboard,
    roles: [{ role: options.role ?? 'member', unitId: null }],
  }
  const ctx = new Context()
  ctx.reflect.provide('modules', {
    invalidate() {},
    async import(): Promise<never> { throw new Error('Unexpected dynamic Client module import') },
  } as never)
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
        if (endpoint === 'plugin-runtime-targets') return { ok: true as const, value: { targets: [], activationTimeoutMs: 30_000, cleanupTimeoutMs: 10_000 } }
        if (endpoint === 'plugin-upload') {
          if (options.uploadError !== undefined) return { ok: false as const, error: { code: 'upload-failed', message: options.uploadError, details: {} } }
          return { ok: true as const, value: { id: 'uploaded-release' } }
        }
        if (endpoint === 'plugin-upgrade') return { ok: true as const, value: payload }
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
  loadPlugins(): Promise<EnterprisePluginCatalog>
  loadPluginInstallations(): Promise<EnterprisePluginInstallations>
  uploadPlugin(visibility: 'private' | 'organization' | 'platform', bytes: Uint8Array): Promise<unknown>
  installPlugin(releaseId: string): Promise<unknown>
  upgradePlugin(installationId: string, releaseId: string): Promise<unknown>
  setPluginEnabled(installationId: string, enabled: boolean): Promise<unknown>
  openConversation(): void
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

    render(<Component {...face} surface="triggers" t={b.locale.bind('enterprise')} useSessions={useSessions} />)
    expect(await screen.findByRole('heading', { name: '触发器' })).toBeTruthy()
    expect(screen.queryByLabelText('规则名称')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '新建规则' }))
    expect(await screen.findByRole('dialog', { name: '创建触发器' })).toBeTruthy()
    expect(screen.getByText('发送给 Agent 的提示词')).toBeTruthy()
    expect(screen.getByText(/新的用户消息/)).toBeTruthy()
    expect((screen.getByLabelText('发送给 Agent 的提示词') as HTMLTextAreaElement).value).toContain('处理这次触发事件')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '创建触发器' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(await screen.findByRole('dialog', { name: '编辑触发器' })).toBeTruthy()
    expect((screen.getByLabelText('发送给 Agent 的提示词') as HTMLTextAreaElement).value).toBe('整理本轮事件，并给出下一步。')
    await b.ctx.fiber.dispose()
  })

  it('registers enterprise pages inside the existing settings shell and removes them on unload', async () => {
    const b = await bench()
    const entries = b.slots.entries('settings.section')
    expect(inject).toEqual(['slots', 'locale', 'connection', 'mainNavigation', 'modules'])
    expect(entries.map(entry => entry.options.id)).toEqual(['enterprise', 'enterprise-models', 'enterprise-team', 'plugins'])
    expect(entries.map(entry => resolveSlotLabel(entry.options.label))).toEqual(['企业账户', '模型', '团队', '企业插件'])

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
    const face = (entry.inject as () => MarketFace)()
    render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)

    expect(await screen.findByRole('heading', { name: '插件市场' })).toBeTruthy()
    const input = screen.getByLabelText('插件包文件') as HTMLInputElement
    expect(input.className).toContain('dse-file-input')
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
    const face = (entry.inject as () => MarketFace)()
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
    const face = (entry.inject as () => MarketFace)()
    render(<Component {...face} surface="plugin-market" t={b.locale.bind('enterprise')} />)

    expect(await screen.findByRole('heading', { name: 'document-review' })).toBeTruthy()
    expect(screen.getByText('1 个插件')).toBeTruthy()
    expect(screen.getByText('版本 1.2.0')).toBeTruthy()
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

  it('keeps another plugin actionable while one installation is pending', async () => {
    const b = await bench({ catalog: [
      { ...catalog[0]!, id: 'release-a', pluginId: 'plugin-a' },
      { ...catalog[0]!, id: 'release-b', pluginId: 'plugin-b' },
    ] })
    const entry = b.slots.entries('main.surface')[0]!
    const Component = entry.component as ComponentType<MarketFace & { surface: 'plugin-market'; t: TranslateNS<'enterprise'> }>
    const face = (entry.inject as () => MarketFace)()
    let releaseFirst: (() => void) | undefined
    const firstInstall = new Promise<void>(resolve => { releaseFirst = resolve })
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
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'model' } })
    await waitFor(() => { expect(b.calls.some(call => call.endpoint === 'set-model')).toBe(true) })
  })

  it('renders governed models and personal usage and requires a second click to revoke a device', async () => {
    const b = await bench()
    const entry = b.slots.entries('settings.section').find(item => item.options.id === 'enterprise')!
    const { Component, face } = section(entry)
    const t = b.locale.bind('enterprise')
    render(<Component {...face} t={t} />)

    expect(await screen.findByRole('heading', { name: 'Acme Research' })).toBeTruthy()
    expect(screen.getByText('Enterprise Chat')).toBeTruthy()
    expect(screen.getByText(/视频同时理解音轨/)).toBeTruthy()
    expect(screen.getByText('4 调用')).toBeTruthy()
    expect(screen.getByText(/1,500 Token/)).toBeTruthy()
    expect(screen.getByText(/¥0\.125081 已结算费用（人民币）/)).toBeTruthy()
    expect(screen.getByText('1 笔历史调用未按人民币计价')).toBeTruthy()
    expect(screen.queryByText(/US\$/)).toBeNull()
    expect(screen.queryByRole('heading', { name: '组织预算' })).toBeNull()
    expect(screen.getByRole('heading', { name: '我的用量（最近 200 次调用）' }).parentElement).toMatchSnapshot()
    const revoke = screen.getByRole('button', { name: '撤销' })
    fireEvent.click(revoke)
    expect(b.calls.filter(call => call.endpoint === 'revoke-runtime')).toHaveLength(0)
    await waitFor(() => { expect(screen.getByRole('button', { name: '再次点击以撤销此设备' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '再次点击以撤销此设备' }))
    await waitFor(() => { expect(b.calls.filter(call => call.endpoint === 'revoke-runtime')).toHaveLength(1) })
    expect(b.calls.find(call => call.endpoint === 'revoke-runtime')?.payload).toEqual({ args: { runtimeId: 'runtime' } })
    await b.ctx.fiber.dispose()
  })

  it('shows only the approved enterprise catalog fields returned by the local Host bridge', async () => {
    const b = await bench()
    const entry = b.slots.entries('settings.section').find(item => item.options.id === 'plugins')!
    const { Component, face } = section(entry)
    render(<Component {...face} t={b.locale.bind('enterprise')} />)

    expect(await screen.findByRole('heading', { name: 'document-review' })).toBeTruthy()
    expect(screen.getByText('版本 1.2.0')).toBeTruthy()
    expect(screen.getByText('桌面端')).toBeTruthy()
    expect(screen.getByText(/workspace\.read/)).toBeTruthy()
    expect(b.calls.map(call => call.endpoint).filter(endpoint => endpoint !== 'plugin-runtime-targets')).toEqual(['plugins'])
    await b.ctx.fiber.dispose()
  })

  it('lets every member view and redeem the shared wallet without loading team management data', async () => {
    const b = await bench()
    const entry = b.slots.entries('settings.section').find(item => item.options.id === 'enterprise-team')!
    const { Component, face } = section(entry)
    render(<Component {...face} t={b.locale.bind('enterprise')} />)

    expect(await screen.findByText('¥12.50')).toBeTruthy()
    expect(screen.getByText('兑换入账')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '邀请成员' })).toBeNull()
    expect(b.calls.filter(call => call.endpoint === 'team')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('兑换码'), { target: { value: 'REDEEM-CODE-1234567890' } })
    fireEvent.click(screen.getByRole('button', { name: '兑换' }))
    await waitFor(() => {
      expect(b.calls.find(call => call.endpoint === 'redeem')?.payload).toEqual({ args: { code: 'REDEEM-CODE-1234567890' } })
    })
    await b.ctx.fiber.dispose()
  })

  it('lets an owner invite administrators, inspect paged member usage, filter dates, and revoke invitations', async () => {
    const b = await bench({ role: 'owner' })
    const entry = b.slots.entries('settings.section').find(item => item.options.id === 'enterprise-team')!
    const { Component, face } = section(entry)
    render(<Component {...face} t={b.locale.bind('enterprise')} />)

    expect(await screen.findByRole('heading', { name: '团队通讯录与本月用量' })).toBeTruthy()
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
    const entry = b.slots.entries('settings.section').find(item => item.options.id === 'enterprise-team')!
    const { Component, face } = section(entry)
    render(<Component {...face} t={b.locale.bind('enterprise')} />)

    expect(await screen.findByRole('heading', { name: '邀请成员' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: '管理员' })).toBeNull()
    await b.ctx.fiber.dispose()
  })
})
