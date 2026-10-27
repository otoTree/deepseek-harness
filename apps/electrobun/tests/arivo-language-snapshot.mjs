/** Recorded chunks cross the real Arivo adapter; the shipped OS executes its ordinary local tools. */
import assert from 'node:assert/strict'
import { loadReplayScript } from '@deepseek-ai/dsh-llm-replay'
import { registerStudioTools } from '../src/distribution/arivo-shell/host/studio-tools.ts'
import { assertProjectModelRoute } from '../src/distribution/arivo-shell/host/project-folders.ts'
import { arivoModelRoute } from '../src/distribution/arivo-shell/host/language-mapping.ts'
import { ArivoLanguageAdapter } from '../src/distribution/arivo-shell/host/language-adapter.ts'
import { projectSessionCatalog } from '../src/distribution/arivo-shell/host/session-catalog.ts'

export const inject = ['llm', 'sessions', 'tools', 'agentDefaultModel']

/** Register an account-owned native bridge fixture; no llm/stream middleware bypasses the adapter. */
export async function apply(ctx) {
  registerStudioTools(ctx, { async studioSession() { throw new Error('This recorded task only writes its local file') } })
  const entries = loadReplayScript({ file: process.env.DSH_SNAPSHOT_FILE })
  const commands = new Set()
  const route = process.env.DSH_SNAPSHOT_MODEL.split('/')
  let consumed = 0, closed = 0, opened = 0, scopeChecks = 0, folderClosed = 0
  const folderHost = { async projectFolderSession() {
    return { protocolVersion: 1, async get() { return { projectId: route[1], title: 'Recorded project', path: '/recorded' } }, async bind() { throw new Error('Unexpected folder bind') },
      async resolve(path) { return { projectId: route[1], title: 'Recorded project', path } },
      async cloud() { return { cloudWorkspaceId: route[0], cloudProjectId: route[1] } },
      async conversationModel() { return { provider: 'arivo', model: route.join('/') } },
      dispose() { folderClosed++ } }
  } }
  await assert.rejects(assertProjectModelRoute(folderHost, '/recorded', { cloudWorkspaceId: route[0], cloudProjectId: 'foreign' }), /PROJECT_MODEL_SCOPE_MISMATCH/)
  ctx.on('agent/request', async (payload, next) => {
    const request = await next()
    assert.equal(request.provider, 'arivo')
    await assertProjectModelRoute(folderHost, payload.agent.session.header.cwd, arivoModelRoute(request.model))
    scopeChecks++
    return request
  })
  const host = { async languageSession() {
    opened++
    let disposed = false
    return { protocolVersion: 1, dispose() { if (!disposed) { disposed = true; closed++ } }, session: {
      async models(scope) {
        assert.deepEqual(scope, { cloudWorkspaceId: route[0], cloudProjectId: route[1], adapterId: route[2] })
        return { items: [{ id: route[2], displayName: 'Arivo recorded language', protocolVersion: 1, tools: true, maxOutputTokens: 4096 }], nextCursor: null }
      },
      async *run(step, signal) {
        signal.throwIfAborted()
        assert.equal(commands.has(step.commandId), false)
        commands.add(step.commandId)
        const entry = entries[consumed++]
        assert.equal(entry?.kind, 'chunks')
        if (consumed > 1) assert.ok(step.input.messages.some(message => message.role === 'tool'))
        let sequence = 0
        const toolIds = new Map()
        const providerId = id => {
          if (!toolIds.has(id)) toolIds.set(id, 'recorded-tool-' + (toolIds.size + 1))
          return toolIds.get(id)
        }
        for (const chunk of entry.chunks) {
          let event
          switch (chunk.type) {
            case 'block-start': event = { type: chunk.type, index: chunk.index, kind: chunk.blockType }; break
            case 'text-delta': case 'reasoning-delta': case 'usage': event = chunk; break
            case 'block-end': event = { ...chunk, block: chunk.block.type === 'tool-call' ? { ...chunk.block, id: providerId(chunk.block.id) } : chunk.block }; break
            case 'tool-call-delta': event = { type: chunk.type, index: chunk.index, id: providerId(chunk.id), name: chunk.name, arguments: chunk.argumentsDelta }; break
            case 'finish': event = { type: chunk.type, reason: chunk.reason.kind }; break
            default: throw new Error('Unsupported recorded Arivo event: ' + chunk.type)
          }
          yield { protocolVersion: 1, callId: 'recorded-call-' + consumed, attemptId: 'recorded-attempt-' + consumed, sequence: ++sequence, event }
        }
      },
      async stop() { throw new Error('Completed snapshot must not cancel a call') },
    } }
  } }
  const adapter = new ArivoLanguageAdapter(host, ctx.sessions,
    { defaultMaxOutputTokens: 4096, catalogTimeoutMs: 10000, maxCatalogPages: 3 },
    () => { throw new Error('Unexpected native stop failure') })
  ctx.llm.registerAdapter(['arivo'], adapter)
  const globalSelection = ctx.agentDefaultModel.currentSelection()
  const catalog = await projectSessionCatalog(folderHost, '/recorded',
    (model, signal) => adapter.projectModels('arivo', model, signal), AbortSignal.timeout(10000))
  assert.equal(catalog.groups[0].models[0].name, 'Arivo recorded language')
  assert.equal(catalog.default.model, route.join('/'))
  assert.deepEqual(ctx.agentDefaultModel.currentSelection(), globalSelection, 'Project discovery must preserve the deployment default')
  ctx.effect(() => async () => {
    await adapter.close()
    assert.deepEqual(ctx.agentDefaultModel.currentSelection(), globalSelection, 'Project requests must preserve the deployment default')
    assert.equal(scopeChecks, consumed, 'Every new recorded request checks its project billing scope')
    assert.equal(folderClosed, scopeChecks + 2, 'Every project-scope and catalog handle must close')
    assert.equal(consumed, entries.length, 'Every recorded model call must cross the native adapter')
    assert.equal(closed, opened, 'Native handles must close')
  })
}
