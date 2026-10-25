import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { registerPluginMarketHost } from '../src/market-host.ts'
void test('product market preserves the original Client slot-report endpoint and closes native ownership once', async () => {
  const ctx = new Context()
  let handler: ConnectionRpcHandler | undefined, disposed = 0
  const controller = new AbortController()
  ctx.provide('connection', { rpc: { handle: (_path: string, callback: ConnectionRpcHandler) => { handler = callback; return () => {} } } } as HostConnectionHandle)
  const fiber = ctx.plugin({ name: 'market-test', apply(context: Context) {
    registerPluginMarketHost(context, '/arivo-market', async () => ({ protocolVersion: 1, scopeId: 'fixture-scope', deviceId: 'fixture_device_001', apiOrigin: 'http://127.0.0.1:3100', signal: controller.signal,
      request: async () => [], bytes: async () => new Uint8Array(), capability: async () => null,
      dispose() { disposed++; controller.abort() },
    }))
  } })
  await fiber.await()
  assert.ok(handler)
  const result = await handler('plugin-client-slot-state', { args: { activationId: randomUUID(), moduleId: '@arivo/test', windowId: 'test', slots: [] } }, AbortSignal.timeout(1000))
  assert.deepEqual(result, { ok: false, error: { code: 'plugin-market/unavailable', message: 'plugin/not-active', details: {} } }, 'the canonical report reaches the original runtime rather than an unknown endpoint')
  controller.abort(); await fiber.dispose(); assert.equal(disposed, 1)
})
