/** Installed ZIP capabilities exercised through the Host Loader and a keyless Agent turn. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import type { Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate'
import { startHttpMcpFixture } from '../../../mcp/mcp-client/tests/http-fixture.ts'
import { EnterprisePluginRuntime } from '../src/plugin-runtime.ts'
import { enterprisePluginCapabilityDiagnostics } from '../src/wire.ts'

const presetId = 'market-acceptance-core-assistant-' + createHash('sha256').update(JSON.stringify(['market.acceptance', 'core', 'assistant'])).digest('hex').slice(0, 16)

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

class Adapter extends LlmAdapter {
  constructor(private readonly calls = [
    { name: 'market_echo', arguments: '{}' },
    { name: 'skill', arguments: '{"name":"market-guide"}' },
    { name: 'mcp__market_fixture__ping', arguments: '{}' },
  ]) { super() }
  readonly requests: GenerateOptions[] = []
  readonly requestCuts: number[] = []
  sessionCut: () => number = () => 0
  override async resolveModel(provider: string, model: string): Promise<{ provider: string; id: string; name: string }> {
    return { provider, id: model, name: model }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    this.requestCuts.push(this.sessionCut())
    if (this.requests.length === 1) {
      for (const [index, call] of this.calls.entries()) {
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(`market-${index}`), ...call } }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'verified' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function archive(overrides: {
  source?: string
  dependencies?: Record<string, string>
  compatibility?: string
  preset?: string
  exports?: unknown
} = {}): Uint8Array {
  const dependencies = overrides.dependencies ?? { '@deepseek-ai/dsh-mcp-client': '*' }
  const source = overrides.source ?? `
    import * as McpClient from '@deepseek-ai/dsh-mcp-client'
    export const inject = ['tools', 'skills']
    export async function apply(ctx, config) {
      ctx.tools.register({name:'market_echo', description:'Return the configured greeting.', parameters:{type:'object'},
        output:{schema:{type:'string'}, render:(_args,value)=>[{type:'text',text:value}]}, execute:async()=>config.greeting})
      ctx.skills.register({name:'market-guide',description:'Explain the market greeting.',source:'bundled',content:'Read the greeting and preserve its source.'})
      await ctx.plugin(McpClient, {transport:'streamable-http',serverName:'market_fixture',url:config.url,failOnStartupError:true})
    }
  `
  const preset = overrides.preset ?? '- id: greeting\n  name: "@example/market-core/preset"\n'
  const manifest = {
    schemaVersion: 3, pluginId: 'market.acceptance', name: 'Market acceptance', version: '2.0.0',
    packages: [{ id: 'core', name: '@example/market-core', version: '1.0.0', dependencies,
      presets: [{ id: 'assistant', entry: 'packages/core/presets/assistant/agent.cordis.yml' }],
      targets: [{ kind:'host',entry:'packages/core/host/index.js',compatibility:overrides.compatibility ?? 'dsh-host>=1',contributions:['tool:market_echo','skill:market-guide','mcp:tools'] }],
    }], permissions: [], resources: [], migrations: [], build: { runtime:'node22',lockfileDigest:'0'.repeat(64) },
  }
  const entries: Record<string, Uint8Array> = {
    'manifest.json':strToU8(JSON.stringify(manifest)),
    'packages/core/package.json':strToU8(JSON.stringify({ name:'@example/market-core',version:'1.0.0',type:'module',dependencies,exports:overrides.exports ?? { '.':'./host/index.js','./preset':'./host/preset.js' } })),
    'packages/core/host/index.js':strToU8(source),
    'packages/core/host/preset.js':strToU8('export const inject=[\'skills\'];export function apply(ctx){ctx.skills.register({name:\'preset-guide\',description:\'Preset-only instructions.\',source:\'bundled\',content:\'Use the market greeting.\'})}'),
    'packages/core/presets/assistant/agent.cordis.yml':strToU8(preset),
  }
  return zipSync({ ...entries,'integrity.json':strToU8(JSON.stringify(Object.fromEntries(Object.entries(entries).map(([path,bytes])=>[path,digest(bytes)])))) })
}

async function harness(t: test.TestContext): Promise<Context> {
  const home = await mkdtemp(join(tmpdir(), 'market-agent-'))
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(home).href + '/'
  t.after(async () => { await ctx.fiber.dispose(); await rm(home, { recursive:true,force:true }) })
  ;(ctx as Context & { dshHomePath:(...parts:string[])=>string }).dshHomePath = (...parts) => join(home,...parts)
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  ctx.loader.builtins.include = Include
  const plugins = { llm:LlmRuntime, session:SessionStore, persistence:JsonlPersistence, projection:SessionProjectionRegistry,
    prompt:SystemPrompt, tools:ToolRuntime, skills:SkillRegistry, agents:AgentRegistry,
    loop:AgentLoop, toolSkill:ToolSkill, presets:AgentPresets }
  Object.assign(ctx.loader.builtins, plugins)
  const composition = Object.keys(plugins).map(id => ({ id,name:`cordis:${id}`,
    ...(id === 'persistence' ? { config:{ root:join(home,'sessions'),compression:'none' } } : id === 'prompt' ? { config:{ persona:'' } } : id === 'loop' ? { config:{ agents:[] } } : id === 'presets'
      ? { config:{ default:presetId,roots:[{ path:join(home,'.agent-presets'),trust:'user' }],includeShippedRoot:false,includeUserRoot:false } } : {}),
  }))
  await writeFile(join(home,'cordis.yml'),JSON.stringify(composition))
  await ctx.loader.create({ name:'cordis:include',config:{ path:'./cordis.yml' } })
  await ctx.loader.await()
  return ctx
}

function runtimeFor(ctx: Context, bytes: Uint8Array, config: Record<string, unknown>): {
  runtime: EnterprisePluginRuntime
  failures: string[]
  disable: () => void
} {
  let enabled = true
  const manifest = JSON.parse(strFromU8(unzipSync(bytes)['manifest.json']!)) as { pluginId: string; version: string }
  const failures: string[] = []
  const runtime = new EnterprisePluginRuntime({ ctx,apiUrl:'https://platform.example',organizationId:'org',deviceId:async()=>'device',
    request:async(path,_signal,init)=>{
      if(path==='plugins/catalog')return[{ id:'release',pluginId:manifest.pluginId,version:manifest.version,digest:digest(bytes) }]
      if(path==='plugins/installations')return enabled ? [{ id:'installed',releaseId:'release',enabled:true,desiredState:'enabled',permissionRevision:1,config }] : []
      if(path.endsWith('/activate'))return{ activationId:'00000000-0000-4000-8000-000000000001',token:'fixture' }
      if(path.endsWith('/heartbeat')){const body=JSON.parse(init?.body as string) as { observedState:string;error:string };if(body.observedState==='failed')failures.push(body.error)}
      return{}
    },requestBytes:async()=>bytes,
  })
  return { runtime,failures,disable:()=>{enabled=false} }
}

const referenceZip = process.env.DSH_REFERENCE_PLUGIN_ZIP
void test('reference ZIP reports an explicit external MCP failure without substituting its bundled server', {
  timeout: 30_000, skip: referenceZip === undefined ? 'Set DSH_REFERENCE_PLUGIN_ZIP to the independently built acceptance product ZIP' : false,
}, async (t) => {
  const ctx = await harness(t)
  const server = createServer((_request, response) => { response.writeHead(503).end() })
  t.after(async () => {
    const stopped = new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    })
    server.closeAllConnections()
    await stopped
  })
  const listening = once(server, 'listening')
  server.listen(0, '127.0.0.1')
  await listening
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const { runtime, failures } = runtimeFor(ctx, await readFile(referenceZip!), { mcpUrl: `http://127.0.0.1:${address.port}/mcp` })
  t.after(() => runtime.dispose())
  await runtime.reconcile(new AbortController().signal)
  assert.match(failures.join('\n'), /initial connection or tool synchronization failed/u)
  assert.ok(!ctx.tools.schemas().some(tool => tool.name === 'reference_echo' || tool.name.startsWith('mcp__reference_fixture__')))
  assert.ok(!(await ctx.skills.list()).some(skill => skill.name === 'reference-guide'))
  assert.ok(!(await runtime.capabilityDiagnostics()).some(row => row.targetKind === 'host' && row.state === 'active'))
})

void test('published reference ZIP activates with empty configuration and releases its bundled MCP endpoint', {
  timeout: 30_000, skip: referenceZip === undefined ? 'Set DSH_REFERENCE_PLUGIN_ZIP to the independently built acceptance product ZIP' : false,
}, async (t) => {
  const ctx = await harness(t)
  const bytes = await readFile(referenceZip!)
  const adapter = new Adapter([
    { name: 'reference_echo', arguments: '{"text":"acceptance"}' },
    { name: 'skill', arguments: '{"name":"reference-guide"}' },
    { name: 'mcp__reference_fixture__ping', arguments: '{}' },
  ])
  ctx.llm.registerAdapter(['mock'], adapter)
  const { runtime, failures, disable } = runtimeFor(ctx, bytes, {})
  t.after(() => runtime.dispose())
  await runtime.reconcile(new AbortController().signal)
  assert.deepEqual(failures, [])
  const diagnostics = await runtime.capabilityDiagnostics()
  const host = diagnostics.find(row => row.targetKind === 'host')
  assert.equal(host?.state, 'active')
  assert.equal(host?.mcpServers[0]?.state, 'connected')
  assert.ok(host?.tools.present.includes('reference_echo'))
  assert.ok(host?.skills.present.includes('reference-guide'))
  const installedPreset = host?.presets[0]?.id
  assert.ok(installedPreset)
  const mounted = await ctx.agents.create({
    sessionId: SessionId('reference-parent'), agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (scoped) => { await ctx.agentPresets.mount(scoped, installedPreset) },
  })
  t.after(() => mounted.dispose())
  assert.ok((await ctx.skills.list({ scope: mounted.agent })).some(row => row.name === 'reference-preset-guide'))
  const idle = new Promise<void>((resolve) => {
    const off = ctx.on('agent/status', ({ agent, status }) => {
      if (agent === mounted.agent && status === 'idle') { off(); resolve() }
    })
    t.after(off)
  })
  mounted.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Verify the installed reference product.' }], source: { kind: 'user' } }))
  await idle
  assert.equal(adapter.requests.length, 2)
  assert.ok(adapter.requests[0]?.tools?.some(tool => tool.name === 'reference_echo'))
  assert.match(JSON.stringify(adapter.requests), /pong/u)
  const transcript = adapter.requests.map(request => ({
    system: request.system, tools: request.tools,
    messages: request.messages.map(({ id: _messageIdentity, ...message }) => message),
  }))
  const snapshotPath = new URL('./fixtures/reference-agent-transcript.json', import.meta.url)
  const captured = JSON.stringify(transcript, null, 2) + '\n'
  if (process.env.UPDATE_MARKET_SNAPSHOT === '1') await writeFile(snapshotPath, captured)
  assert.equal(captured, await readFile(snapshotPath, 'utf8'))
  const mcpFiber = [...ctx.registry.values()].filter(row => row.name === 'mcp-client')
    .flatMap(row => [...row.fibers]).find(fiber => (fiber.config as McpConfig).serverName === 'reference_fixture')
  const mcpConfig = mcpFiber?.config as McpConfig | undefined
  assert.equal(mcpConfig?.transport, 'streamable-http')
  assert.ok(mcpConfig?.transport === 'streamable-http')
  const endpoint = mcpConfig.url
  await mounted.dispose()
  disable()
  await runtime.reconcile(new AbortController().signal)
  assert.ok(!ctx.tools.schemas().some(tool => tool.name === 'reference_echo' || tool.name.startsWith('mcp__reference_fixture__')))
  assert.ok(!(await ctx.skills.list()).some(skill => skill.name === 'reference-guide'))
  assert.ok(!(await ctx.agentPresets.list()).some(preset => preset.id === installedPreset))
  assert.deepEqual(await runtime.capabilityDiagnostics(), [])
  await assert.rejects(fetch(endpoint))
})

void test('ZIP-installed Tool, Skill, MCP and preset reach an Agent and release with their Cordis composition',{ timeout:15_000 },async(t)=>{
  const ctx = await harness(t)
  const fixture = await startHttpMcpFixture()
  t.after(fixture.close)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'],adapter)
  const { runtime,failures,disable } = runtimeFor(ctx,archive(),{ greeting:'CONFIGURED_GREETING',url:fixture.url })
  t.after(()=>runtime.dispose())
  await runtime.reconcile(new AbortController().signal)
  assert.deepEqual(failures,[])
  const parent = await ctx.agents.create({ sessionId:SessionId('market-parent'),agentOptions:{ provider:'mock',model:'mock' },setup:async (scoped)=>{await ctx.agentPresets.mount(scoped,presetId)} })
  t.after(()=>parent.dispose())
  const child = await ctx.agents.create({ sessionId:SessionId('market-child'),agentOptions:{ provider:'mock',model:'mock' },setup:(scoped)=>{ctx.agentPresets.composeFrom(scoped,parent.agent.ctx)} })
  t.after(()=>child.dispose())
  assert.ok((await ctx.skills.list({ scope:child.agent })).some(row=>row.name==='preset-guide'))
  const agent = parent.agent
  adapter.sessionCut = () => agent.session.seq
  const idle = new Promise<void>((resolve)=>{const off=ctx.on('agent/status',({ agent:subject,status })=>{if(subject===agent&&status==='idle'){off();resolve()}})})
  agent.followup(createUserMessage({ content:[{ type:'text',text:'Check the greeting, instructions and MCP ping.' }],source:{ kind:'user' } }))
  await idle
  assert.equal(adapter.requests.length,2)
  assert.ok(adapter.requests[0]?.tools?.some(tool=>tool.name==='market_echo'))
  const serialized = JSON.stringify(adapter.requests)
  assert.match(serialized,/market-guide/u)
  assert.match(serialized,/CONFIGURED_GREETING/u)
  assert.match(serialized,/Read the greeting and preserve its source/u)
  assert.match(serialized,/pong/u)
  assert.equal(agent.session.snapshotEvents().filter(row=>row.type==='tool\/result').length,3)
  const transcript = adapter.requests.map(request => ({
    system: request.system, tools: request.tools,
    messages: request.messages.map(({ id: _messageIdentity, ...message }) => message),
  }))
  const snapshotPath = new URL('./fixtures/market-agent-transcript.json',import.meta.url)
  const captured = JSON.stringify(transcript,null,2) + '\n'
  if (process.env.UPDATE_MARKET_SNAPSHOT === '1') await writeFile(snapshotPath,captured)
  assert.equal(captured,await readFile(snapshotPath,'utf8'))
  await ctx.sessionPersistence.flush()
  const reader = await ctx.sessionPersistence.open(agent.session.id,'read')
  t.after(()=>reader.close())
  const events = await reader.read()
  for (const [index, request] of adapter.requests.entries()) {
    const restored = Session.fromRestore(
      agent.session.id,events.slice(0,adapter.requestCuts[index]),reader.header,reader.inheritedEventCount,
    )
    assert.deepEqual(restored.deriveMessages(),request.messages)
    assert.deepEqual(restored.requestHeader()?.system,request.system)
    assert.deepEqual(restored.requestHeader()?.tools,request.tools)
  }
  const diagnostics = await runtime.capabilityDiagnostics()
  assert.deepEqual(enterprisePluginCapabilityDiagnostics.parse(diagnostics), diagnostics)
  assert.equal(diagnostics[0]?.state,'active')
  assert.equal(diagnostics[0]?.mcpServers[0]?.state,'connected')
  await child.dispose()
  await parent.dispose()
  disable()
  await runtime.reconcile(new AbortController().signal)
  assert.ok(!ctx.tools.schemas().some(tool=>tool.name==='market_echo'||tool.name.startsWith('mcp__market_fixture')))
  assert.ok(!(await ctx.skills.list()).some(skill=>skill.name==='market-guide'))
  assert.ok(!(await ctx.agentPresets.list()).some(preset=>preset.id===presetId))
  assert.deepEqual(await runtime.capabilityDiagnostics(),[])
})

void test('ZIP MCP cancellation reaches the server and uninstall removes the discovered tools', { timeout:15_000 }, async(t)=>{
  const ctx = await harness(t)
  const started: PromiseWithResolvers<void> = Promise.withResolvers()
  const closed: PromiseWithResolvers<void> = Promise.withResolvers()
  const fixture = await startHttpMcpFixture({ started:started.resolve,closed:closed.resolve })
  t.after(fixture.close)
  const { runtime,failures,disable } = runtimeFor(ctx,archive(),{ greeting:'hello',url:fixture.url })
  t.after(()=>runtime.dispose())
  await runtime.reconcile(new AbortController().signal)
  assert.deepEqual(failures,[])
  const controller = new AbortController()
  t.after(()=>{ controller.abort() })
  const call = ctx.tools.execute({ callId:ToolCallId('cancel-mcp'),name:'mcp__market_fixture__blocked',arguments:{},signal:controller.signal })
  await started.promise
  controller.abort(new Error('user cancelled'))
  const result = await call
  assert.equal(result.isError,true)
  await closed.promise
  disable()
  await runtime.reconcile(new AbortController().signal)
  assert.ok(!ctx.tools.schemas().some(tool=>tool.name.startsWith('mcp__market_fixture__')))
  assert.deepEqual(await runtime.capabilityDiagnostics(),[])
})

for(const [label,overrides,pattern] of [
  ['missing relative import',{ source:"import './missing.js';export function apply(){}" },/missing or escapes/u],
  ['escape import',{ source:"import '../../outside.js';export function apply(){}" },/missing or escapes/u],
  ['nonliteral import',{ source:'export async function apply(){await import(globalThis.moduleName)}' },/non-literal/u],
  ['incompatible dependency',{ dependencies:{ '@deepseek-ai/dsh-mcp-client':'999.0.0' } },/not provided/u],
  ['unsupported target',{ compatibility:'dsh-host>=99' },/Unsupported plugin target/u],
  ['loop replacement',{ preset:'- name: "@deepseek-ai/dsh-agent-loop"\n' },/cannot replace Host runtime/u],
  ['empty declared capabilities',{ source:'export function apply(){}' },/registered no Tool/u],
  ['non-JSON tool schema',{ source:'export const inject=[\'tools\'];export function apply(ctx){ctx.tools.register({name:\'market_echo\',description:\'Invalid schema\',parameters:{type:\'object\',invalid:undefined},output:{schema:{type:\'string\'},render:()=>[]},execute:async()=>\'\'})}' },/lossless JSON/u],
] as const){
  void test(`ZIP rejects ${label} without retaining Agent contributions`,async(t)=>{
    const ctx = await harness(t)
    const { runtime,failures }=runtimeFor(ctx,archive(overrides),{})
    t.after(()=>runtime.dispose())
    await runtime.reconcile(new AbortController().signal)
    if(label==='unsupported target')assert.deepEqual(await runtime.capabilityDiagnostics(),[])
    else assert.match(failures.join('\n'),pattern)
    assert.ok(!ctx.tools.schemas().some(tool=>tool.name==='market_echo'))
  })
}
