# Enterprise plugin SDK reference

English | [中文](sdk.zh.md)

The kit includes three offline package archives under `../sdk/`. They are built from one platform release and must be used together:

| Package | Version in this kit | Use in an external plugin |
| --- | --- | --- |
| `@deepseek-ai/dsh-plugin-protocol` | `0.1.3-alpha.5` | Manifest, permission, target, capability, Skill, and MCP types plus `pluginManifest` validation. |
| `@deepseek-ai/dsh-plugin-sdk` | `0.1.3-alpha.5` | The installation-scoped `PluginSdk` facade and HTTP transport. |
| `@deepseek-ai/dsh-plugin-runtime` | `0.1.3-alpha.1` | Optional local fixture and Cordis lifecycle helpers; the platform owns loading and activation in production. |

The SDK uses an activation-scoped transport. The platform creates the transport after it verifies the ZIP and activation lease, then injects `pluginSdk` into the Host or Client target. A target must pass `exec.signal` or an equivalent `AbortSignal` to every long-running call and must not retain the SDK after its Cordis fiber is disposed.

## Capability matrix

| Facade | Methods | Manifest permissions |
| --- | --- | --- |
| `identity` | `current(signal?)` | `identity.read` |
| `models` | `list`, `text`, `textStream`, `previewTask`, `uploadAsset`, `assetAccess`, `createTask`, `queryTask`, `cancelTask`, `retryTaskSave`, `listTasks`, `listTaskPage` | `models.text` or `models.media` |
| `objects` | `put`, `read`, `listVersions`, `delete` | `objects.read`, `objects.write` |
| `database` | `query`, `transaction` | `database.query`, `database.transaction` |
| `cache` | `get`, `set`, `delete`, `increment` | `cache.read`, `cache.write` |
| `network` | `request` | `network.http` plus `network.allowedHosts` |
| `credentials` | `get`, `set`, `delete`, `list` | `credentials.read`, `credentials.write` |
| `authorization` | `begin`, `complete` | `authorization.oauth` or `authorization.api-key` |
| `mcp` | `connect`, `disconnect`, `listTools`, `call` | `mcp.connect` |
| `skills` | `register`, `unregister`, `list` | `skills.register` |
| `config` | `get`, `set`, `delete` | `config.read`, `config.write` |

## Host usage

The platform injects the SDK as a Cordis service. Host code can use the SDK and the Agent registries together:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { PluginSdk } from '@deepseek-ai/dsh-plugin-sdk'

export const inject = ['pluginSdk', 'tools']

export function apply(ctx: Context & { pluginSdk: PluginSdk }): void {
  const dispose = ctx.tools.register({
    name: 'acme_report',
    description: 'Read the current report.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(_args, exec) {
      const identity = await ctx.pluginSdk.identity.current(exec.signal)
      return identity.organizationId
    },
  })
  ctx.effect(() => dispose)
}
```

`ctx.tools.register()` returns a disposer. Register it from the target fiber or return it through `ctx.effect()` so disable, upgrade, and uninstall remove the Tool. Skills and MCP clients follow the same ownership rule. A Tool declaration in `manifest.json` does not register a Tool by itself.

## Authorization and provider credentials

`authorization.begin()` starts an OAuth, API key, or device-code flow. The Host receives an authorization id and an optional browser URL or user code. The platform owns the redirect and stores the resulting credential. Call `authorization.complete()` after the user finishes the flow. Use `credentials.get()` only on the Host and never copy a returned secret into a Client bundle, log, Skill content, Tool result, or model prompt.

## MCP

An MCP server URL is a product default or an administrator-managed configuration value; an end user should enter only values that the product deliberately exposes. A normal flow is:

1. Read a non-secret URL or provider choice from `config`.
2. Call `authorization.begin()` when the server requires OAuth or API key authorization.
3. Call `mcp.connect()` with the server id and configured URL.
4. Call `mcp.listTools()` and register each discovered tool with a server-qualified name.
5. On disposal, call `mcp.disconnect()` and dispose every registered Tool.

The MCP URL does not grant access. The manifest permission, configured host allowlist, authorization state, activation lease, and server response all remain required.

## Error and lifecycle rules

The SDK rejects calls after activation expiry, revocation, permission revision changes, target disablement, or fiber disposal. Handle stable `plugin/*` error codes as product states. Retries reuse an idempotency key only for the same operation. HTTP responses have timeout and response-size limits; provider tokens never cross into Client code.
