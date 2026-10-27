/** Native chooser and registry acknowledgement retain their original owners. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { assertProjectModelRoute, projectForWorkspace, projectFolderRequest, type ArivoFolderHost } from '../src/distribution/arivo-shell/host/project-folders.ts'

void test('native selection binds before registry publication, reconnect recovers and cancellation writes nothing', async () => {
  const projectId = randomUUID(), scope = 's'.repeat(43)
  const state = { bound: false, disposed: 0, choices: 0, registrations: 0, failRegistry: true }
  const folder = { projectId, title: 'Film', path: '/projects/Film' }
  const host: ArivoFolderHost = { async projectFolderSession(received) {
    assert.equal(received, scope)
    return { protocolVersion: 1, async resolve() { return state.bound ? folder : null }, async get() { return state.bound ? folder : null },
      async bind(id, path) { assert.equal(id, projectId); assert.equal(path, folder.path); state.bound = true; return folder },
      dispose() { state.disposed++ } }
  } }
  const request = { version: 1, operation: 'bind', projectId, scope }
  const choose = async () => { state.choices++; return folder.path }
  const register = async () => { state.registrations++; if (state.failRegistry) throw new Error('registry write failed'); return { id: randomUUID() } }
  await assert.rejects(projectFolderRequest(request, host, choose, register, AbortSignal.timeout(5000)), /registry write failed/)
  state.failRegistry = false
  assert.deepEqual(await projectFolderRequest(request, host, choose, register, AbortSignal.timeout(5000)),
    { cancelled: false, folder: { projectId, name: 'Film' } })
  assert.equal(state.choices, 1); assert.equal(state.registrations, 2); assert.equal(state.disposed, 2)
  state.bound = false
  assert.deepEqual(await projectFolderRequest(request, host, async () => null, register, AbortSignal.timeout(5000)),
    { cancelled: true, folder: null })
  assert.equal(state.registrations, 2); assert.equal(state.disposed, 3)
  await assert.rejects(projectFolderRequest({ ...request, path: '/model-supplied' }, host, choose, register, AbortSignal.timeout(5000)))
  assert.equal(state.choices, 1)
})

void test('account captured before chooser cannot be rebound after account replacement', async () => {
  const projectId = randomUUID(), scope = 's'.repeat(43)
  let changed = false, registrations = 0, disposed = false
  const host: ArivoFolderHost = { async projectFolderSession() {
    return { protocolVersion: 1, async resolve() { return null }, async get() { return null }, async bind() {
      assert.equal(changed, true); throw new Error('LOCAL_SCOPE_CHANGED')
    }, dispose() { disposed = true } }
  } }
  await assert.rejects(projectFolderRequest({ version: 1, operation: 'bind', projectId, scope }, host,
    async () => { changed = true; return '/projects/new-account' }, async () => { registrations++; return { id: randomUUID() } }, AbortSignal.timeout(5000)), /LOCAL_SCOPE_CHANGED/)
  assert.equal(registrations, 0); assert.equal(disposed, true)
})

void test('unified creation registers its exact folder and repairs registry failure without selecting again', async () => {
  const projectId = randomUUID(), scope = 's'.repeat(43), commandId = randomUUID()
  const creation = { commandId, title: 'Film', synopsis: '', cloudWorkspaceId: randomUUID(), folderMode: 'new' }
  const folder = { projectId, title: 'Film', path: '/projects/Film' }, project = { id: projectId }
  let selections = 0, registrations = 0, disposed = 0, fail = true
  const host: ArivoFolderHost = { async projectFolderSession() {
    return { protocolVersion: 1, async resolve() { return null }, async get() { return null }, async bind() { throw new Error('unexpected bind') },
      async create(input, path) { assert.equal(input.commandId, commandId); assert.equal(path, '/projects'); return { cancelled: false, folder, project } },
      async recover(id) { assert.equal(id, commandId); return { cancelled: false, folder, project } }, dispose() { disposed++ } }
  } }
  const select = async () => { selections++; return '/projects' }
  const register = async (path: string) => { registrations++; assert.equal(path, folder.path); if (fail) throw new Error('registry unavailable'); return { id: randomUUID() } }
  await assert.rejects(projectFolderRequest({ version: 1, operation: 'create', scope, creation }, host, select, register, AbortSignal.timeout(5000)), /registry unavailable/)
  fail = false
  assert.deepEqual(await projectFolderRequest({ version: 1, operation: 'recover', scope, commandId }, host, select, register, AbortSignal.timeout(5000)),
    { cancelled: false, folder: { projectId, name: 'Film' }, project })
  assert.equal(selections, 1); assert.equal(registrations, 2); assert.equal(disposed, 2)
  await assert.rejects(projectFolderRequest({ version: 1, operation: 'create', scope, creation: { ...creation, path: '/untrusted' } }, host, select, register, AbortSignal.timeout(5000)))
  assert.equal(selections, 1)
})

void test('unified creation cancellation passes no path and never registers a workspace', async () => {
  const scope = 's'.repeat(43), creation = { commandId: randomUUID(), title: 'Film', synopsis: '', cloudWorkspaceId: randomUUID(), folderMode: 'existing' }
  const host: ArivoFolderHost = { async projectFolderSession() {
    return { protocolVersion: 1, async resolve() { return null }, async get() { return null }, async bind() { throw new Error('unexpected bind') },
      async create(_input, path) { assert.equal(path, null); return { cancelled: true, folder: null, project: null } },
      async recover() { throw new Error('unexpected recovery') }, dispose() {} }
  } }
  assert.deepEqual(await projectFolderRequest({ version: 1, operation: 'create', scope, creation }, host, async () => null,
    async () => { throw new Error('unexpected registration') }, AbortSignal.timeout(5000)), { cancelled: true, folder: null, project: null })
})

void test('Workbench resolves only its native workspace binding and always releases account authority', async () => {
  const projectId = randomUUID()
  let disposed = 0, bound = true
  const host: ArivoFolderHost = { async projectFolderSession() {
    return { protocolVersion: 1, async get() { return null }, async bind() { throw new Error('unexpected bind') },
      async resolve(path) { assert.equal(path, '/projects/Film'); return bound ? { projectId, title: 'Film', path } : null },
      dispose() { disposed++ } }
  } }
  assert.equal(await projectForWorkspace(host, '/projects/Film'), projectId)
  bound = false
  await assert.rejects(projectForWorkspace(host, '/projects/Film'), /PROJECT_FOLDER_REQUIRED/)
  assert.equal(disposed, 2)
})

void test('project conversation returns only the original registry identity and never picks another folder', async () => {
  const projectId = randomUUID(), workspaceId = randomUUID(), scope = 's'.repeat(43)
  let bound = true
  const folder = { projectId, title: 'Film', path: '/projects/Film' }
  const host: ArivoFolderHost = { async projectFolderSession() {
    return { protocolVersion: 1, async get() { return bound ? folder : null }, async resolve() { return null },
      async bind() { throw new Error('unexpected bind') }, dispose() {} }
  } }
  const model = { provider: 'arivo' as const, model: `${randomUUID()}/${randomUUID()}/${randomUUID()}` }
  const original = host.projectFolderSession.bind(host)
  host.projectFolderSession = async () => ({ ...await original(), async conversationModel() { return model } })
  const request = { version: 1, operation: 'conversation', projectId, scope, conversationId: randomUUID() }
  const choose = async () => { throw new Error('unexpected chooser') }
  const register = async (path: string) => { assert.equal(path, folder.path); return { id: workspaceId } }
  assert.deepEqual(await projectFolderRequest(request, host, choose, register, AbortSignal.timeout(5000)),
    { cancelled: false, folder: { projectId, name: 'Film', workspaceId, model } })
  bound = false
  await assert.rejects(projectFolderRequest(request, host, choose, register, AbortSignal.timeout(5000)), /PROJECT_FOLDER_REQUIRED/)
})

void test('project Agents refuse foreign or missing cloud billing routes without changing request models', async () => {
  const projectId = randomUUID(), route = { cloudWorkspaceId: randomUUID(), cloudProjectId: randomUUID() }
  let bound = true, cloud: typeof route | null = route, disposed = 0
  const host: ArivoFolderHost = { async projectFolderSession() {
    return { protocolVersion: 1, async get() { return null }, async bind() { throw new Error('unexpected bind') },
      async resolve() { return bound ? { projectId, title: 'Film', path: '/film' } : null },
      async cloud() { return cloud }, dispose() { disposed++ } }
  } }
  await assertProjectModelRoute(host, '/film', route)
  await assert.rejects(assertProjectModelRoute(host, '/film', { ...route, cloudProjectId: randomUUID() }), /PROJECT_MODEL_SCOPE_MISMATCH/)
  cloud = null
  await assert.rejects(assertProjectModelRoute(host, '/film', route), /PROJECT_MODEL_SCOPE_MISMATCH/)
  bound = false
  await assertProjectModelRoute(host, '/film', route)
  assert.equal(disposed, 4)
})
