// @vitest-environment jsdom
/** Exercises Chat selection through the real SlotRegistry store axis. */
import { describe, expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { createChatStore } from '../src/client/stores.ts'

const sid = (value: string): SessionId => value as SessionId

type ChatInstance = ReturnType<ReturnType<typeof createChatStore>['create']>

async function createBench() {
  const runtime = await SlotTestRuntime.create()
  const chat = createChatStore()
  const detailsChat = createChatStore()
  await runtime.root.declare({
    'conversation.view': { kind: 'list', scope: 'session' },
    'details': { kind: 'single', scope: 'session-maybe' },
  }, (_props: PropsRenderSlots<'conversation.view' | 'details'>) => null)
  runtime.slots.register({ name: 'conversation.view', id: 'chat', store: chat }, () => null)
  // Optional details has a different scope contract, so it owns a separate
  // store seat instead of sharing the strict conversation-view handle.
  runtime.slots.register({ name: 'details', store: detailsChat }, () => null)
  runtime.renderRoot()
  return { runtime }
}

function storeFor(
  current: Awaited<ReturnType<typeof createBench>>,
  slot: 'conversation.view' | 'details',
  sessionId: SessionId,
): ChatInstance {
  return current.runtime.storeOf(slot, sessionId) as ChatInstance
}

describe('Chat selection survives on its store seat', () => {
  it('keeps optional details state separate from the strict Chat View seat', async () => {
    const b = await createBench()
    await b.runtime.sessions.add({ id: 's1' })
    const chat = storeFor(b, 'conversation.view', sid('s1'))
    const details = storeFor(b, 'details', sid('s1'))
    chat.actions.select({ turnSeq: 3, callId: 'c1' })

    expect(details).not.toBe(chat)
    expect(details.store.getSnapshot().selection).toBeNull()
    await b.runtime.dispose()
  })

  it('isolates Session instances and preserves identity across list projection updates', async () => {
    const b = await createBench()
    const oneId = sid('s1')
    await b.runtime.sessions.add({ id: 's1' })
    await b.runtime.sessions.add({ id: 's2' })
    const one = storeFor(b, 'conversation.view', oneId)
    const two = storeFor(b, 'conversation.view', sid('s2'))
    one.actions.select({ turnSeq: 1, callId: 'a' })
    two.actions.select({ turnSeq: 9, callId: 'z' })

    await b.runtime.sessions.updateSummary(oneId, { displayTitle: 'projected' })

    expect(storeFor(b, 'conversation.view', oneId)).toBe(one)
    expect(one.store.getSnapshot().selection).toEqual({ turnSeq: 1, callId: 'a' })
    expect(two.store.getSnapshot().selection).toEqual({ turnSeq: 9, callId: 'z' })
    await b.runtime.dispose()
  })

  it('buries selection with the Session scope', async () => {
    const b = await createBench()
    await b.runtime.sessions.add({ id: 's1' })
    const doomed = storeFor(b, 'conversation.view', sid('s1'))
    doomed.actions.select({ turnSeq: 1 })

    await b.runtime.sessions.remove('s1')

    await b.runtime.sessions.add({ id: 's1' })
    const reborn = storeFor(b, 'conversation.view', sid('s1'))
    expect(reborn).not.toBe(doomed)
    expect(reborn.store.getSnapshot()).toEqual({ selection: null, turnProcesses: [] })
    await b.runtime.dispose()
  })
})
