// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel, type TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.tsx'
import type { EnterpriseDashboard, EnterprisePluginCatalog } from '../src/wire.ts'

afterEach(cleanup)

const dashboard: EnterpriseDashboard = {
  organization: { id: 'organization', name: 'Acme Research', kind: 'team', status: 'active', policyRevision: 7 },
  subscription: { plan: 'Enterprise', seats: 20, runtimes: 6, budgetMicros: 10_000_000, spentMicros: 1_200_000, reservedMicros: 50_000 },
  roles: [{ role: 'member', unitId: null }],
  models: [{ id: 'model', name: 'Enterprise Chat', images: false, contextTokens: 65536, maxOutputTokens: 8192 }],
  runtimes: [{ id: 'runtime', name: 'Studio Mac', type: 'desktop', version: '0.1.0', leaseUntil: '2026-09-10T12:00:00Z', revokedAt: null, current: true }],
  usage: { calls: 4, inputTokens: 1200, outputTokens: 300, actualMicros: 100_000, billedMicros: 125_000 },
}

const catalog: EnterprisePluginCatalog = [{
  id: 'release',
  pluginId: 'document-review',
  version: '1.2.0',
  targets: ['desktop'],
  permissions: ['workspace.read'],
  tools: [{ name: 'review', description: 'Review a document' }],
  publishedAt: '2026-09-10T12:00:00Z',
  policyRevision: 7,
}]

async function bench() {
  const calls: Array<{ endpoint: string; payload: unknown }> = []
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('connection', {
    rpc: {
      call: async (_channel: string, endpoint: string, payload: unknown) => {
        calls.push({ endpoint, payload })
        if (endpoint === 'dashboard') return { ok: true as const, value: dashboard }
        if (endpoint === 'model-selection') return { ok: true as const, value: { provider: 'enterprise', model: 'model' } }
        if (endpoint === 'set-model') return { ok: true as const, value: { provider: 'enterprise', model: (payload as { model: string }).model } }
        if (endpoint === 'plugins') return { ok: true as const, value: catalog }
        if (endpoint === 'revoke-runtime') return { ok: true as const, value: payload }
        return { ok: false as const, error: { code: 'not-found', message: 'Not found', details: {} } }
      },
    },
  } as ConnectionHandle)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
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
  switchOrganization(): void
  logout(): void
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
    expect(inject).toEqual(['slots', 'locale', 'connection'])
    expect(entries.map(entry => entry.options.id)).toEqual(['enterprise', 'enterprise-models', 'plugins'])
    expect(entries.map(entry => resolveSlotLabel(entry.options.label))).toEqual(['企业账户', '模型', '企业插件'])
    expect(document.querySelector('style[data-enterprise-client]')).not.toBeNull()

    await b.fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(document.querySelector('style[data-enterprise-client]')).toBeNull()
    await b.ctx.fiber.dispose()
  })

  it('allows selecting only an authorized enterprise model', async () => {
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
    expect(screen.getByText('4 调用')).toBeTruthy()
    expect(screen.getByText(/1,500 Token/)).toBeTruthy()
    const revoke = screen.getByRole('button', { name: '撤销' })
    fireEvent.click(revoke)
    expect(b.calls.filter(call => call.endpoint === 'revoke-runtime')).toHaveLength(0)
    await waitFor(() => { expect(screen.getByRole('button', { name: '再次点击以撤销此设备' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '再次点击以撤销此设备' }))
    await waitFor(() => { expect(b.calls.filter(call => call.endpoint === 'revoke-runtime')).toHaveLength(1) })
    expect(b.calls.find(call => call.endpoint === 'revoke-runtime')?.payload).toEqual({ runtimeId: 'runtime' })
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
    expect(b.calls.map(call => call.endpoint)).toEqual(['plugins'])
    await b.ctx.fiber.dispose()
  })
})
