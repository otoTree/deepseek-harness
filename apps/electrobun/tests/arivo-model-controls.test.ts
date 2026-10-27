/** Native catalog authorization, original model directory projection and explicit default selection. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ArivoLanguageAdapter } from '../src/distribution/arivo-shell/host/language-adapter.ts'
import { ArivoModelControls } from '../src/distribution/arivo-shell/host/model-controls.ts'
import type { ArivoLanguageHandle, ArivoLanguageHost } from '../src/distribution/arivo-shell/host/language-wire.ts'

const config = { defaultMaxOutputTokens: 64, catalogTimeoutMs: 10000, maxCatalogPages: 3 }
const workspace = randomUUID(), project = randomUUID(), model = randomUUID(), textOnly = randomUUID()
const route = `${workspace}/${project}/${model}`
async function fixture(t: { after(fn: () => Promise<void>): void }, alter?: (handle: ArivoLanguageHandle) => void) {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  let selection = { provider: 'unconfigured', model: '' }
  const state = { opened: 0, closed: 0, saved: 0, changed: 0, queries: [] as unknown[], repeatedCursor: false }
  const host: ArivoLanguageHost = { async languageSession() {
    state.opened++
    let closed = false
    const handle: ArivoLanguageHandle = { protocolVersion: 1,
      dispose() { if (!closed) { closed = true; state.closed++ } },
      catalog: { protocolVersion: 1,
        async workspaces() { return { items: [{ id: workspace, name: 'Studio' }], nextCursor: null } },
        async projects(value) { assert.equal(value, workspace); return { items: [{ id: project, name: 'Film' }], nextCursor: null } },
      }, session: {
        async models(scope, signal, cursor) {
          signal.throwIfAborted(); state.queries.push({ ...scope, cursor })
          if (!cursor) return { items: [{ id: textOnly, displayName: 'Text only', protocolVersion: 1, tools: false, maxOutputTokens: 128 }],
            nextCursor: 'second' }
          return { items: [{ id: model, displayName: 'Tool-capable model', protocolVersion: 1, tools: true, maxOutputTokens: 128 }],
            nextCursor: state.repeatedCursor ? 'second' : null }
        },
        async *run() { throw new Error('Browsing models must not generate') },
        async stop() { throw new Error('Browsing models must not cancel') },
      } }
    alter?.(handle)
    return handle
  } }
  const adapter = new ArivoLanguageAdapter(host, ctx.sessions, config, () => {},
    () => selection.provider === 'arivo' ? selection.model : undefined)
  const controls = new ArivoModelControls(host, adapter, {
    currentSelection: () => ({ ...selection }),
    async saveSelection(value) { selection = value; state.saved++ },
  }, config, () => { state.changed++ })
  ctx.llm.registerAdapter(['arivo'], adapter)
  t.after(async () => { await controls.close(); await adapter.close() })
  return { state, adapter, controls, selection: () => ({ ...selection }) }
}
void test('catalog browsing requires valid operations and stays side-effect free until authorized selection', async (t) => {
  const { state, controls, adapter, selection } = await fixture(t)
  assert.deepEqual(await controls.request({ version: 1, type: 'state' }), { type: 'state', configured: false })
  assert.deepEqual(await adapter.listModels('arivo'), []); assert.equal(state.opened, 0)
  await assert.rejects(controls.request({ version: 1, type: 'projects', cloudWorkspaceId: '../foreign' }))
  await assert.rejects(controls.request({ version: 1, type: 'state', account: 'foreign' }))
  assert.equal(state.opened, 0)
  assert.deepEqual(await controls.request({ version: 1, type: 'workspaces' }),
    { type: 'workspaces', items: [{ id: workspace, name: 'Studio' }], nextCursor: null })
  assert.deepEqual(await controls.request({ version: 1, type: 'projects', cloudWorkspaceId: workspace }),
    { type: 'projects', items: [{ id: project, name: 'Film' }], nextCursor: null })
  assert.deepEqual(await controls.request({ version: 1, type: 'models', cloudWorkspaceId: workspace, cloudProjectId: project }),
    { type: 'models', items: [], nextCursor: 'second' })
  assert.equal(state.saved, 0)
  await assert.rejects(controls.request({ version: 1, type: 'select', cloudWorkspaceId: workspace,
    cloudProjectId: project, adapterId: textOnly }), { code: 'ARIVO_TOOLS_REQUIRED' })
  assert.equal(state.saved, 0)
  await controls.request({ version: 1, type: 'select', cloudWorkspaceId: workspace, cloudProjectId: project, adapterId: model })
  assert.deepEqual(selection(), { provider: 'arivo', model: route }); assert.equal(state.saved, 1); assert.equal(state.changed, 1)
  const directory = await adapter.listModels('arivo')
  assert.deepEqual(directory, [{ provider: 'arivo', id: route, name: 'Tool-capable model', inputModalities: ['text'] }])
  assert.equal(state.opened, state.closed)
})
void test('missing catalog capability fails explicitly; repeated native cursors cannot loop the OS model directory', async (t) => {
  const first = await fixture(t, (handle) => { delete handle.catalog })
  await assert.rejects(first.controls.request({ version: 1, type: 'workspaces' }), { code: 'ARIVO_CATALOG_UNAVAILABLE' })
  assert.equal(first.state.opened, first.state.closed)
  const second = await fixture(t)
  await second.controls.request({ version: 1, type: 'select', cloudWorkspaceId: workspace, cloudProjectId: project, adapterId: model })
  second.state.repeatedCursor = true
  await assert.rejects(second.adapter.listModels('arivo'), { code: 'ARIVO_PROTOCOL_UNAVAILABLE' })
  assert.equal(second.state.opened, second.state.closed)
})
void test('disposing controls drains the interrupted native lookup and never saves an unconfirmed selection', async (t) => {
  const entered = Promise.withResolvers<undefined>()
  const { controls, state } = await fixture(t, (handle) => {
    handle.session.models = async (_scope, signal) => {
      entered.resolve(undefined)
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      signal.throwIfAborted()
      throw new Error('unreachable')
    }
  })
  const pending = controls.request({ version: 1, type: 'select', cloudWorkspaceId: workspace, cloudProjectId: project, adapterId: model })
  const rejected = assert.rejects(pending)
  await entered.promise; await controls.close(); await rejected
  assert.equal(state.saved, 0); assert.equal(state.opened, state.closed)
})
