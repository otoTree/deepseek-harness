// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel, type TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import type {
  EnterpriseDashboard,
  EnterprisePluginCatalog,
  EnterprisePluginInstallations,
  EnterpriseTeam,
  EnterpriseUsagePage,
  EnterpriseWallet,
  EnterpriseWalletLedger,
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

async function bench(options: { role?: 'member' | 'administrator' | 'owner'; uploadError?: string } = {}) {
  const calls: Array<{ endpoint: string; payload: unknown }> = []
  const dashboardValue = {
    ...dashboard,
    roles: [{ role: options.role ?? 'member', unitId: null }],
  }
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('connection', {
    rpc: {
      call: async (_channel: string, endpoint: string, payload: unknown) => {
        calls.push({ endpoint, payload })
        if (endpoint === 'dashboard') return { ok: true as const, value: dashboardValue }
        if (endpoint === 'model-selection') return { ok: true as const, value: { provider: 'enterprise', model: 'model' } }
        if (endpoint === 'set-model') return { ok: true as const, value: { provider: 'enterprise', model: (payload as { model: string }).model } }
        if (endpoint === 'plugins') return { ok: true as const, value: catalog }
        if (endpoint === 'plugin-installations') return { ok: true as const, value: [] }
        if (endpoint === 'plugin-runtime-targets') return { ok: true as const, value: [] }
        if (endpoint === 'plugin-upload') {
          if (options.uploadError !== undefined) return { ok: false as const, error: { code: 'upload-failed', message: options.uploadError, details: {} } }
          return { ok: true as const, value: { id: 'uploaded-release' } }
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
  let surface: 'conversation' | 'plugin-market' = 'conversation'
  const listeners = new Set<() => void>()
  const setSurface = (value: typeof surface): void => {
    surface = value
    for (const listener of listeners) listener()
  }
  ctx.provide('mainNavigation', {
    get: () => surface,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    openPluginMarket: () => { setSurface('plugin-market') },
    openConversation: () => { setSurface('conversation') },
  })
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'main.surface': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, locale, calls, fiber }
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
  setPluginEnabled(installationId: string, enabled: boolean): Promise<unknown>
  openConversation(): void
}

type MarketActionFace = {
  navigation: {
    get(): 'conversation' | 'plugin-market'
    subscribe(listener: () => void): () => void
  }
  open(): void
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
  it('registers enterprise pages inside the existing settings shell and removes them on unload', async () => {
    const b = await bench()
    const entries = b.slots.entries('settings.section')
    expect(inject).toEqual(['slots', 'locale', 'connection', 'mainNavigation'])
    expect(entries.map(entry => entry.options.id)).toEqual(['enterprise', 'enterprise-models', 'enterprise-team', 'plugins'])
    expect(entries.map(entry => resolveSlotLabel(entry.options.label))).toEqual(['企业账户', '模型', '团队', '企业插件'])

    await b.fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })

  it('uses the shared plugin icon and reflects marketplace navigation in the sidebar action', async () => {
    const b = await bench()
    const entry = b.slots.entries('sidebar.footer.action')[0]!
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
