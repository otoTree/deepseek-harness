import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'

async function harness() {
  const ctx = new Context()
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  const workbench = {}
  const sessions = {
    list: { getSnapshot: () => ({ current: undefined }), subscribe: () => () => {} },
    create: vi.fn(async () => SessionId('created-session')),
    open: vi.fn(),
  }
  ctx.provide('connection', { generation: { getSnapshot: () => undefined, subscribe: () => () => {} }, reconnect: vi.fn() } as never)
  ctx.provide('layout', layout as never)
  ctx.provide('mainNavigation', { transition: (change: () => void) => { change() } } as never)
  ctx.provide('sessions', sessions as never)
  ctx.provide('remote', { workbench } as never)
  ctx.provide('remote.workbench', workbench as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  const root = ctx.slots.register({
    name: 'root',
    children: {
      details: { kind: 'single', scope: 'session-maybe' },
    },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, root, sessions }
}

describe('ui-workbench apply lifecycle', () => {
  it('owns details, declares panel slots, and removes every contribution on disposal', async () => {
    const { ctx, fiber, root } = await harness()
    expect(ctx.slots.entries('details')).toHaveLength(1)
    expect(ctx.slots.spec('workbench.panel')).toMatchObject({ kind: 'keyed', scope: 'session' })

    await fiber.dispose()
    expect(ctx.slots.entries('details')).toHaveLength(0)
    expect(ctx.slots.spec('workbench.panel')).toBeUndefined()
    root()
    await ctx.fiber.dispose()
  })

  it('creates and selects one chat Session for concurrent blank Workbench opens', async () => {
    const { ctx, fiber, root, sessions } = await harness()
    const entry = ctx.slots.entries('details')[0]
    const injected = entry?.inject?.({} as never) as { ensureSession: () => Promise<SessionId> } | undefined
    if (injected === undefined) throw new Error('Workbench details injection is missing')

    await expect(Promise.all([injected.ensureSession(), injected.ensureSession()]))
      .resolves.toEqual([SessionId('created-session'), SessionId('created-session')])
    expect(sessions.create).toHaveBeenCalledOnce()
    expect(sessions.open).toHaveBeenCalledExactlyOnceWith(SessionId('created-session'))

    await fiber.dispose()
    root()
    await ctx.fiber.dispose()
  })
})
