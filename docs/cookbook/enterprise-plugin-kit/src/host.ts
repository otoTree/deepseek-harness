import type { Context } from '@deepseek-ai/cordis'
import type { PluginSdk, PluginSkill } from '@deepseek-ai/dsh-plugin-sdk'

interface ToolRegistry {
  register(tool: Record<string, unknown>): () => void
}

interface HostContext extends Context {
  pluginSdk: PluginSdk
  tools: ToolRegistry
}

export const name = 'acme-enterprise-report-host'
export const inject = ['pluginSdk', 'tools']

const skill: PluginSkill = {
  id: 'acme_report',
  name: 'Acme report workflow',
  description: 'Explain how to retrieve an Acme report through the installed Tool.',
  content: 'Use acme_report for the current organization. Cite the returned organization id.',
  version: '1.0.0',
}

/** Register the sample Tool and Skill; the platform owns the target fiber. */
export function apply(ctx: HostContext): void {
  const disposeTool = ctx.tools.register({
    name: 'acme_report',
    description: 'Read the current Acme report for the active organization.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['organizationId'], properties: { organizationId: { type: 'string' } } },
      render: (_args: unknown, value: { organizationId: string }) => [{ type: 'text', text: value.organizationId }],
    },
    async execute(_args: unknown, exec: { signal: AbortSignal }): Promise<{ organizationId: string }> {
      const identity = await ctx.pluginSdk.identity.current(exec.signal)
      return { organizationId: identity.organizationId }
    },
  })
  ctx.effect(() => disposeTool)

  const skills = ctx.pluginSdk.skills
  if (skills === undefined) throw new Error('skills.register permission is required')
  let registered = false
  let disposed = false
  const controller = new AbortController()
  void skills.register(skill, controller.signal).then(() => {
    if (disposed) void skills.unregister(skill.id).catch(() => {})
    else registered = true
  }).catch(() => {})
  ctx.effect(() => () => {
    disposed = true
    controller.abort('plugin/not-active')
    if (registered) void skills.unregister(skill.id).catch(() => {})
  })
}

/** Discover an optional configured MCP server and expose qualified tools. */
export async function connectConfiguredMcp(ctx: HostContext, url: string, signal?: AbortSignal): Promise<() => Promise<void>> {
  const mcp = ctx.pluginSdk.mcp
  if (mcp === undefined) throw new Error('mcp.connect permission is required')
  const server = await mcp.connect({ id: 'acme', url, transport: 'streamable-http' }, signal)
  const discovered = await mcp.listTools(server.id, signal)
  const disposers = discovered.map(tool => ctx.tools.register({
    name: tool.qualifiedName,
    description: tool.description ?? `MCP tool ${tool.name}`,
    parameters: tool.inputSchema,
    output: { schema: { type: 'object' }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => mcp.call({ serverId: server.id, tool: tool.name, arguments: args }, exec.signal),
  }))
  return async () => {
    for (const dispose of disposers) dispose()
    await mcp.disconnect(server.id)
  }
}
