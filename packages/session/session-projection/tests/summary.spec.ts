/** Summary selection leaves full Session projections and checkpoints intact. */
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import Registry from '../src/index.ts'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { 'test/summary': number; 'test/detail': number }
  interface SessionProjectionMap { 'test/summary': number; 'test/detail': number }
}

describe('summary key selection', () => {
  it('skips excluded views in cached and checkpoint reads and invalidates keys on final disposal', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(Registry)
      const registry = ctx.sessionProjections
      const empty = registry.summaryKeys()
      const summary = registry.register({
        key: 'test/summary', stateSchema: z.number(), stateVersion: 1,
        init: () => 1, apply: state => state,
        wire: { viewSchema: z.number(), view: state => state },
      })
      const detailView = vi.fn((state: number) => state)
      const detailParse = vi.fn((value: number) => value)
      registry.register({
        key: 'test/detail', stateSchema: z.number(), stateVersion: 1,
        init: () => 2, apply: state => state,
        wire: { summary: false, viewSchema: z.number().transform(detailParse), view: detailView },
      })
      const keys = registry.summaryKeys()
      expect(keys).not.toBe(empty)
      expect([...keys]).toEqual(['test/summary'])
      expect(registry.summaryKeys()).toBe(keys)
      const session = Session.create(SessionId('summary-selection'))
      expect(registry.cachedSnapshot(session, keys)).toBeUndefined()
      expect(registry.snapshot(session).values).toEqual({ 'test/summary': 1, 'test/detail': 2 })
      const checkpoint = registry.checkpoint(session)
      detailView.mockClear()
      detailParse.mockClear()
      expect(registry.cachedSnapshot(session, keys)?.values).toEqual({ 'test/summary': 1 })
      expect(registry.viewCheckpoint(checkpoint, keys)).toEqual({ 'test/summary': 1 })
      expect(detailView).not.toHaveBeenCalled()
      expect(detailParse).not.toHaveBeenCalled()
      expect(registry.snapshot(session).values).toHaveProperty('test/detail', 2)
      summary()
      expect(registry.summaryKeys()).not.toBe(keys)
      expect([...registry.summaryKeys()]).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
