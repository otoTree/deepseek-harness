import { describe, expect, it, vi } from 'vitest'
import type {
  ChatConversationViewNode, ChatNodeSource,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ChatSnapshotBuilder } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

const timeline: ConversationTimelineSnapshot = { turnOrder: [], turns: new Map() }

function userNode(index: number, text = `message ${String(index)}`): ChatConversationViewNode {
  return {
    key: `user:${String(index)}`,
    id: String(index),
    target: 'chat',
    kind: 'user',
    anchorSeq: index,
    location: { kind: 'session' },
    visibility: 'visible',
    data: {
      kind: 'user',
      messageId: `message-${String(index)}`,
      seq: index,
      time: index,
      content: [{ type: 'text', text }],
      source: null,
    },
  }
}

describe('Chat Node keyed sources', () => {
  it('keeps navigation positions current across missing turns, prepends, and unchanged bounded previews', () => {
    const fixture = chatSnapshotFixture({ turnTimings: new Map([
      [1, { startTime: 1 }], [2, { startTime: 2 }], [3, { startTime: 3 }],
    ]) })
    const inTurn = (turn: number, text: string): ChatConversationViewNode => ({
      ...userNode(turn, text),
      location: { kind: 'turn', turn: fixture.timeline.turns.get(turn)! },
    })
    const builder = new ChatSnapshotBuilder()
    const initial = builder.replace({ nodes: [inTurn(3, 'latest')], timeline: fixture.timeline })
    expect(initial.navigation.items().map(item => item.turn)).toEqual([3])
    const prepended = builder.apply({ upserts: [inTurn(1, 'older')], timeline: fixture.timeline })
    const items = prepended.navigation.items()
    expect(items.map(item => item.turn)).toEqual([1, 3])
    const changed = builder.apply({ upserts: [inTurn(3, 'x'.repeat(200))], timeline: fixture.timeline })
    const changedItems = changed.navigation.items()
    expect(changedItems[0]).toBe(items[0])
    expect(changedItems[1]?.prompt).toBe(`${'x'.repeat(49)}…`)
    const unchanged = builder.apply({ upserts: [inTurn(3, 'x'.repeat(300))], timeline: fixture.timeline })
    expect(unchanged.navigation.items()).toBe(changedItems)
  })

  it('notifies only the updated key among 4,000 mounted sources', () => {
    const builder = new ChatSnapshotBuilder()
    const nodes = Array.from({ length: 4_000 }, (_, index) => userNode(index + 1))
    const initial = builder.replace({ nodes, timeline })
    const listeners = nodes.map(() => vi.fn())
    const sources: ChatNodeSource[] = nodes.map((node, index) => {
      const source = initial.nodes.source(node.key)
      source.subscribe(listeners[index]!)
      return source
    })

    const target = 2_347
    const changed = userNode(target + 1, 'streamed update')
    const next = builder.apply({ upserts: [changed], timeline })

    expect(listeners[target]).toHaveBeenCalledOnce()
    expect(listeners.reduce((count, listener) => count + listener.mock.calls.length, 0)).toBe(1)
    expect(next.nodes.source(changed.key)).toBe(sources[target])
    expect(next.nodes.get(changed.key)).toBe(changed)
  })
})
