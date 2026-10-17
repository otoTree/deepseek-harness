// src/host.ts
var name = "acme-enterprise-report-host";
var inject = ["pluginSdk", "tools"];
var skill = {
  id: "acme_report",
  name: "Acme report workflow",
  description: "Explain how to retrieve an Acme report through the installed Tool.",
  content: "Use acme_report for the current organization. Cite the returned organization id.",
  version: "1.0.0"
};
function apply(ctx) {
  const disposeTool = ctx.tools.register({
    name: "acme_report",
    description: "Read the current Acme report for the active organization.",
    parameters: {},
    output: {
      schema: { type: "object", additionalProperties: false, required: ["organizationId"], properties: { organizationId: { type: "string" } } },
      render: (_args, value) => [{ type: "text", text: value.organizationId }]
    },
    async execute(_args, exec) {
      const identity = await ctx.pluginSdk.identity.current(exec.signal);
      return { organizationId: identity.organizationId };
    }
  });
  ctx.effect(() => disposeTool);
  const skills = ctx.pluginSdk.skills;
  if (skills === void 0) throw new Error("skills.register permission is required");
  let registered = false;
  let disposed = false;
  const controller = new AbortController();
  void skills.register(skill, controller.signal).then(() => {
    if (disposed) void skills.unregister(skill.id).catch(() => {
    });
    else registered = true;
  }).catch(() => {
  });
  ctx.effect(() => () => {
    disposed = true;
    controller.abort("plugin/not-active");
    if (registered) void skills.unregister(skill.id).catch(() => {
    });
  });
}
async function connectConfiguredMcp(ctx, url, signal) {
  const mcp = ctx.pluginSdk.mcp;
  if (mcp === void 0) throw new Error("mcp.connect permission is required");
  const server = await mcp.connect({ id: "acme", url, transport: "streamable-http" }, signal);
  const discovered = await mcp.listTools(server.id, signal);
  const disposers = discovered.map((tool) => ctx.tools.register({
    name: tool.qualifiedName,
    description: tool.description ?? `MCP tool ${tool.name}`,
    parameters: tool.inputSchema,
    output: { schema: { type: "object" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
    execute: (args, exec) => mcp.call({ serverId: server.id, tool: tool.name, arguments: args }, exec.signal)
  }));
  return async () => {
    for (const dispose of disposers) dispose();
    await mcp.disconnect(server.id);
  };
}
export {
  apply,
  connectConfiguredMcp,
  inject,
  name
};
