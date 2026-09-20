import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'

async function harness() {
  const ctx = new Context()
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  const workbench = {}
  ctx.provide('layout', layout as never)
  ctx.provide('remote', { workbench } as never)
  ctx.provide('remote.workbench', workbench as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  const root = ctx.slots.register({
    name: 'root',
    children: {
      details: { kind: 'single', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, root }
}

describe('ui-workbench apply lifecycle', () => {
  it('owns details, declares panel slots, and removes every contribution on disposal', async () => {
    const { ctx, fiber, root } = await harness()
    expect(ctx.slots.entries('details')).toHaveLength(1)
    expect(ctx.slots.entries('conversation.session.header.utilities').map(entry => entry.options.id)).toEqual(['workbench-launcher'])
    expect(ctx.slots.spec('workbench.panel')).toMatchObject({ kind: 'keyed', scope: 'session' })

    expect(ctx.slots.entries('conversation.session.header.utilities')[0]?.inject).toBeDefined()

    await fiber.dispose()
    expect(ctx.slots.entries('details')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    expect(ctx.slots.spec('workbench.panel')).toBeUndefined()
    root()
    await ctx.fiber.dispose()
  })
})
