/** Project catalogs retain native account authority across live online discovery. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { ArivoFolderHost } from '../src/distribution/arivo-shell/host/project-folders.ts'
import { projectSessionCatalog } from '../src/distribution/arivo-shell/host/session-catalog.ts'

function fixture() {
  const cloud = { cloudWorkspaceId: randomUUID(), cloudProjectId: randomUUID() }
  const model = `${cloud.cloudWorkspaceId}/${cloud.cloudProjectId}/${randomUUID()}`
  const folder = { projectId: randomUUID(), title: 'Film', path: '/projects/Film' }
  const state = { disposed: 0, bound: true, changed: false, selected: { provider: 'arivo' as const, model } as { provider: 'arivo'; model: string } | null }
  const host: ArivoFolderHost = { async projectFolderSession() {
    return { protocolVersion: 1, async resolve(path) { assert.equal(path, folder.path); return state.bound ? folder : null },
      async get() { if (state.changed) throw new Error('LOCAL_SCOPE_CHANGED'); return folder },
      async bind() { throw new Error('discovery must never bind') }, async cloud() { return cloud },
      async conversationModel() { return state.selected }, dispose() { state.disposed++ } }
  } }
  const models = [{ provider: 'arivo', id: model, name: 'DeepSeek Flash', inputModalities: ['text' as const] }]
  return { host, state, models, folder, model, cloud }
}

void test('recovered project catalog supplies the original model name and exact scoped choices without changing defaults', async () => {
  const f = fixture()
  let online = false, reads = 0
  const read = async (model: string) => { assert.equal(model, f.model); reads++; if (!online) throw new Error('cloud unavailable'); return f.models }
  await assert.rejects(projectSessionCatalog(f.host, f.folder.path, read, AbortSignal.timeout(5000)), /cloud unavailable/)
  online = true
  const catalog = await projectSessionCatalog(f.host, f.folder.path, read, AbortSignal.timeout(5000))
  assert.equal(catalog?.default.model, f.model)
  assert.deepEqual(catalog?.groups[0]?.models, [{ id: f.model, name: 'DeepSeek Flash', inputModalities: ['text'] }])
  assert.equal(reads, 2); assert.equal(f.state.disposed, 2)
  f.state.bound = false
  assert.equal(await projectSessionCatalog(f.host, f.folder.path, async () => { throw new Error('unbound path must use original discovery') }, AbortSignal.timeout(5000)), null)
  assert.equal(f.state.disposed, 3)
})

void test('scope mismatch, missing selection and foreign catalog entries refuse instead of adopting another billing project', async () => {
  const f = fixture(), signal = AbortSignal.timeout(5000)
  const read = async () => { throw new Error('invalid route must never query cloud') }
  f.state.selected = null
  await assert.rejects(projectSessionCatalog(f.host, f.folder.path, read, signal), /PROJECT_MODEL_REQUIRED/)
  f.state.selected = { provider: 'arivo', model: `${randomUUID()}/${randomUUID()}/${randomUUID()}` }
  await assert.rejects(projectSessionCatalog(f.host, f.folder.path, read, signal), /PROJECT_MODEL_SCOPE_MISMATCH/)
  f.state.selected = { provider: 'arivo', model: f.model }
  await assert.rejects(projectSessionCatalog(f.host, f.folder.path,
    async () => [...f.models, { ...f.models[0]!, id: `${randomUUID()}/${randomUUID()}/${randomUUID()}` }], signal), /PROJECT_MODEL_SCOPE_MISMATCH/)
  await assert.rejects(projectSessionCatalog(f.host, f.folder.path, async () => [], signal), /PROJECT_MODEL_UNAVAILABLE/)
  assert.equal(f.state.disposed, 4)
})

void test('account replacement and cancellation during discovery suppress late metadata and release native handles', async () => {
  const f = fixture()
  await assert.rejects(projectSessionCatalog(f.host, f.folder.path, async () => {
    f.state.changed = true; return f.models
  }, AbortSignal.timeout(5000)), /LOCAL_SCOPE_CHANGED/)
  f.state.changed = false
  const controller = new AbortController()
  await assert.rejects(projectSessionCatalog(f.host, f.folder.path, async () => {
    controller.abort(); return f.models
  }, controller.signal), error => error instanceof Error && error.name === 'AbortError')
  assert.equal(f.state.disposed, 2)
  await assert.rejects(projectSessionCatalog(f.host, f.folder.path, async () => f.models, controller.signal))
  assert.equal(f.state.disposed, 2)
})
