# 企业插件 SDK 参考

[English](sdk.md) | 中文

开发包在 `../sdk/` 下包含三个离线安装包。它们来自同一平台发行版，必须配套使用：

| 包 | 本开发包版本 | 外部插件用途 |
| --- | --- | --- |
| `@deepseek-ai/dsh-plugin-protocol` | `0.1.3-alpha.5` | manifest、权限、target、能力、Skill 和 MCP 类型，以及 `pluginManifest` 校验。 |
| `@deepseek-ai/dsh-plugin-sdk` | `0.1.3-alpha.5` | 安装作用域 `PluginSdk` 门面和 HTTP transport。 |
| `@deepseek-ai/dsh-plugin-runtime` | `0.1.3-alpha.1` | 可选的本地 fixture 和 Cordis 生命周期辅助；生产环境的装载和激活由平台负责。 |

SDK 使用 activation 作用域 transport。平台完成 ZIP 和 activation lease 校验后创建 transport，再把 `pluginSdk` 注入 Host 或 Client target。target 必须把 `exec.signal` 或等价的 `AbortSignal` 传给所有长调用，不得在 Cordis fiber 释放后继续保留 SDK。

## 能力矩阵

| 门面 | 方法 | manifest 权限 |
| --- | --- | --- |
| `identity` | `current(signal?)` | `identity.read` |
| `models` | `list`、`text`、`textStream`、`previewTask`、`uploadAsset`、`assetAccess`、`createTask`、`queryTask`、`cancelTask`、`retryTaskSave`、`listTasks`、`listTaskPage` | `models.text` 或 `models.media` |
| `objects` | `put`、`read`、`listVersions`、`delete` | `objects.read`、`objects.write` |
| `database` | `query`、`transaction` | `database.query`、`database.transaction` |
| `cache` | `get`、`set`、`delete`、`increment` | `cache.read`、`cache.write` |
| `network` | `request` | `network.http` 和 `network.allowedHosts` |
| `credentials` | `get`、`set`、`delete`、`list` | `credentials.read`、`credentials.write` |
| `authorization` | `begin`、`complete` | `authorization.oauth` 或 `authorization.api-key` |
| `mcp` | `connect`、`disconnect`、`listTools`、`call` | `mcp.connect` |
| `skills` | `register`、`unregister`、`list` | `skills.register` |
| `config` | `get`、`set`、`delete` | `config.read`、`config.write` |

## Host 使用

平台把 SDK 作为 Cordis service 注入。Host 可以同时使用 SDK 和 Agent 注册表：

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

`ctx.tools.register()` 返回 disposer。请从 target fiber 注册，或者通过 `ctx.effect()` 返回它，让禁用、升级和卸载能够移除 Tool。Skill 和 MCP client 使用相同的所有权规则。`manifest.json` 里的 Tool 声明不会自动注册 Tool。

## 授权和提供方凭据

`authorization.begin()` 启动 OAuth、API Key 或设备码流程。Host 会得到 authorization id，以及可选的浏览器 URL 或用户码。平台负责回调并保存最终凭据。用户完成流程后调用 `authorization.complete()`。只有 Host 可以调用 `credentials.get()`，返回的 secret 不得复制进 Client bundle、日志、Skill 内容、Tool 结果或模型提示词。

## MCP

MCP server URL 应是产品默认值或管理员配置值；只有产品明确开放的字段才要求终端用户输入。标准流程如下：

1. 从 `config` 读取非敏感的 URL 或提供方选择。
2. 服务器需要 OAuth 或 API Key 时调用 `authorization.begin()`。
3. 使用配置好的 URL 调用 `mcp.connect()`。
4. 调用 `mcp.listTools()`，用带 server 限定名的名称注册发现到的工具。
5. 释放时调用 `mcp.disconnect()`，并释放所有已注册 Tool。

MCP URL 本身不代表授权。manifest 权限、配置的 host allowlist、授权状态、activation lease 和服务器响应都必须有效。

## 错误和生命周期规则

activation 过期、撤销、权限修订变化、target 禁用或 fiber 释放后，SDK 调用都会拒绝。将稳定的 `plugin/*` 错误码作为产品状态处理。同一个操作的重试才复用幂等键。HTTP 响应有超时和响应大小限制，提供方 token 不会进入 Client 代码。
