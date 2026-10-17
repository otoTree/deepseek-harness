# 实操手册：开发企业级组合插件

[English](developing-an-enterprise-composition-plugin.md) | 中文

本指南说明如何为可信企业插件编写作者流程，使一个已发布版本组合 Host 和 Client 贡献。内容包括 manifest、target 边界、安装作用域 SDK、包归档、生命周期、测试和索引维护。先阅读[企业插件模型](../enterprise-plugins.zh.md)、[安装生命周期](../developer/plugin-installation-lifecycle.zh.md)和[插件数据 SDK](../developer/plugin-data-sdk.zh.md)；[`plugin/acceptance` fixture](../../packages/plugin/acceptance/README.zh.md)是平台维护者参考样例。

## 目录

- [从独立工作区开始](#start-in-a-standalone-workspace)
- [定义企业组合](#define-the-enterprise-composition)
- [选择 Host 和 Client target](#choose-host-and-client-targets)
- [设计贡献和权限](#design-contributions-and-permissions)
- [构建包归档](#build-the-package-archive)
- [使用安装作用域 SDK](#use-the-installation-scoped-sdk)
- [处理激活和生命周期](#handle-activation-and-lifecycle)
- [测试完整版本](#test-the-complete-release)
- [记录插件并更新索引](#document-and-index-the-plugin)
- [校验](#verification)

-----

<a id="start-in-a-standalone-workspace"></a>
## 0. 从独立工作区开始

在你自己管理的代码仓库中开发插件。企业插件不把 Harness 仓库作为构建依赖。你的工作区需要受支持的 Node.js 22 或更高版本、包管理器、TypeScript 或 JavaScript、打包器、与平台兼容的版本化插件公共包，以及 ZIP 和哈希实现。平台在安装后提供运行时、授权、凭据、Agent 注册表、Client 插槽和发行校验。

使用与平台兼容范围匹配的 `@deepseek-ai/dsh-plugin-protocol` 和 `@deepseek-ai/dsh-plugin-sdk` 版本化公共产物。平台 SDK 分发通过配置的 registry 或发行归档提供这些产物。需要类型化工具辅助函数时，可以选用 `@deepseek-ai/dsh-tools`。`@deepseek-ai/dsh-plugin-runtime` 是平台维护的 loader 和 fixture 包；本地测试可以选用，发布入口不需要依赖它。如果部署没有提供公共分发，向平台管理员索取版本化 SDK bundle；不要复制 Harness 源码目录。将 `@deepseek-ai/cordis` 作为 peer runtime 约定。不要导入 `apps/`、`packages/`、`.artifacts/`、平台数据库、桌面源码或 `/Users/hjr/Desktop/plugins`；这些路径属于 Harness checkout，不是外部作者约定的一部分。

独立工作区可以采用以下布局：

```text
my-plugin/
  package.json
  manifest.json
  packages/core/package.json
  src/host.ts                 # omit for a Client-only release
  src/client.ts               # omit for a Host-only release
  scripts/build.mjs
  scripts/package.mjs
  scripts/verify.mjs
  dist/my-plugin-1.0.0.dsh-plugin.zip
```

Host 入口导出 Cordis function plugin，并通过声明的注入接收安装作用域 SDK。Client 入口导出 Cordis function plugin，并通过声明的注入接收 Client SDK 和 slot 服务。插件可以只有一个入口，也可以同时包含两个入口；一个产品 manifest 可以表达多个 Cordis package 和多个 Client 入口。入口不导入 Harness 应用，也不启动 Agent loop：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { PluginSdk } from '@deepseek-ai/dsh-plugin-sdk'

export const name = 'acme-report-host'
export const inject = ['pluginSdk', 'tools']

export function apply(ctx: Context & { pluginSdk: PluginSdk }): void {
  const dispose = ctx.tools.register({
    name: 'acme_report',
    description: 'Read the current Acme report.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(_args, exec) {
      const identity = await ctx.pluginSdk.identity.current(exec.signal)
      return `Report for ${identity.organizationId}`
    },
  })
  ctx.effect(() => dispose)
}
```

平台加载入口时注入 `pluginSdk` 和共享 `tools` 注册表。请从 `apply` 注册工具、Skill、MCP client 和其他服务，Cordis 负责它们的 effect 生命周期。需要更严格类型时，使用公共 `@deepseek-ai/dsh-tools` 类型或直接使用 JSON Schema。Client 入口使用同样的模式，并注入公共 Client slot 服务。平台维护的 `@deepseek-ai/dsh-plugin-runtime` 用于 loader 和 fixture harness；发布入口通常不调用 `mountPluginTarget` 或 `bindPluginSdk`。

独立开发边界必须保持清晰：发送给平台的唯一产品输入是 ZIP，平台服务的唯一来源是安装后的运行时。本地 mock 可以实现公共 SDK transport 供测试使用，但不能把它当作平台实现。

需要直接复制的文档和代码混合工作区时，使用[企业插件开发包](enterprise-plugin-kit/README.zh.md)。它包含版本化 SDK 归档、当前 Client Slot 目录、Host/Client/Skill/MCP 标准样例、Agent preset 和包校验脚本。同一目录还提供[可下载的开发包 ZIP](enterprise-plugin-kit/dist/enterprise-plugin-kit-0.1.0.zip)以及样例插件归档。

<a id="define-the-enterprise-composition"></a>
## 1. 定义企业组合

编写 target 代码前，先说明插件的产品责任和发布身份。公开企业 release 有稳定的 `pluginId`、语义化 `version`、manifest、一个或两个可执行 target 以及一个不可变归档。私有开发上传可以替换相同 plugin ID 和版本；发布前应使用新的语义化版本。release 作为整体安装和撤销，而每个 target 可以在设备上独立启用和激活。

企业组合与普通工作区包分开。工作区包由仓库 loader 和 aggregate TypeScript 构建解析；企业插件作为经过校验的 `.dsh-plugin.zip` 交付，由企业 API 和桌面运行时加载。包可以复用共享的 protocol、SDK 和 runtime 库，但不能假设能够访问宿主仓库的私有服务。

使用 acceptance fixture 作为最小完整示例：它的 Host target 注册一个面向模型的工具，Client target 提供一个设置面板，两个 target 都调用安装作用域 SDK，两个 manifest 则验证升级和迁移行为。

<a id="choose-host-and-client-targets"></a>
## 2. 选择 Host 和 Client target

只声明真正拥有对应能力的 target。Host target 在 WebView 外运行，使用受限 SDK，并在企业策略下执行业务操作。Client target 在 Web profile 中运行，通过 Client slot、locale 和 Connection 约定贡献 UI。Client 代码不能读取 runtime token、Keychain 数据、提供方凭据或任意本地文件。

| Target | 入口 | 允许的责任 | 禁止的假设 |
| --- | --- | --- | --- |
| `host` | manifest 或 Cordis package 声明的 `entry`，通常位于 `packages/<package-id>/host/`。 | Host 服务、面向模型的工具、通过 SDK 进行的特权编排以及 Host 生命周期。 | 浏览器状态、Client UI 对象或未列出的平台凭据。 |
| `client` | manifest 或 Cordis package 声明的 `entry`，通常位于 `packages/<package-id>/client/`。 | slot 或 window 贡献、locale 注册、用户交互以及通过注入 SDK 或 Host bridge 发起的调用。 | 直接文件系统访问、提供方凭据、Keychain 访问或可信 Host 状态。 |

关联插件可以同时声明两个 target，但 target 入口仍保持分离，平台会在激活前分别校验每个 target。当前 manifest parser 和桌面市场不支持 Cloud target。不要把 `cloud` target 作为未来兼容的快捷方式编码进去。

<a id="design-contributions-and-permissions"></a>
## 3. 设计贡献和权限

把 manifest 视为可供审核的可执行行为声明。代码请求的每项能力都必须有对应的权限、resource 声明、target 贡献和测试。运行时会在每次 SDK 调用时再次检查权限和 resource；声明 resource 本身不会授予权限。

新产品使用 schema version 3。schema version 2 是带顶层 target 的兼容格式；平台接受两种格式，但不会为缺少的 package metadata 自动推断值。

manifest 包含以下字段：

| 字段 | 编写规则 |
| --- | --- |
| `schemaVersion`、`pluginId`、`name`、`version` | 使用 schema `3`、稳定的小写 plugin id、面向用户的名称，并为每个公开不可变 release 使用新的语义化版本。私有开发期间可以重复上传同一版本来替换私有 release。 |
| `packages` | 在 schema `3` 中声明每个 Cordis package 的元数据、依赖、target 和可选 preset 文件。一个产品可以包含多个 Host 和 Client package。 |
| `targets` | 在 schema `2` 中声明一个或两个顶层 `client`/`host` 描述，带有 `entry`、`compatibility` 和 target 专属贡献；schema `3` 将这些描述放在 `packages` 下。 |
| `permissions` | 只申请代码需要的 `identity.read`、`models.text`、`models.media`、`objects.*`、`database.*` 和 `cache.*` 权限。 |
| `resources` | `objects`、`database` 和 `cache` 每种最多声明一次；需要有界存储时提供正的字节配额。 |
| `sdk` | 当插件依赖特定能力版本时，固定支持的 SDK 版本范围。 |
| `migrations` | 使用严格递增的正数版本，并使用属于插件数据空间的无参数语句。 |
| `dependencies` | 记录 target bundle 所需的运行时包依赖。 |
| `build` | 记录构建运行时和生成归档时使用的 lockfile SHA-256 摘要。 |

最小的 schema v3 manifest 如下：

```json
{
  "schemaVersion": 3,
  "pluginId": "acme-report",
  "name": "Acme report",
  "version": "1.0.0",
  "permissions": ["identity.read"],
  "resources": [],
  "packages": [{
    "id": "core",
    "name": "@acme/acme-report-core",
    "version": "1.0.0",
    "dependencies": {},
    "targets": [{
      "kind": "host",
      "entry": "packages/core/host/index.js",
      "compatibility": "dsh-host>=1",
      "contributions": ["tool:acme_report"]
    }]
  }],
  "build": {
    "runtime": "node22",
    "lockfileDigest": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

上面的全零摘要只是示例占位符。打包脚本必须把它替换成构建所用 lockfile 的 SHA-256 摘要。对应归档还必须包含以下文件：

```json
{
  "name": "@acme/acme-report-core",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {}
}
```

Client contribution 必须使用唯一 id，并选择带 `one` 或 `many` multiplicity 的 `slot`，或者带 surface、title key、shell、multiplicity 和可选有界默认尺寸的 `window`。贡献 id 属于已安装 target 的约定；修改它需要有意识的 release 和 UI 迁移决策。

不要用 manifest contribution 偷渡未声明的 RPC 或特权操作。服务端代码负责数据访问和特权动作。Host/Client 连接必须使用已认证且有大小限制的 RPC 或已声明的 Connection 约定，Client 只接收所需的投影。

<a id="build-the-package-archive"></a>
## 4. 构建包归档

schema v2 的标准归档根目录包含 `manifest.json`、`integrity.json`、声明的 `client/<file>.js` 和 `host/<file>.js` 入口，以及声明的 asset。schema v3 的入口和 package metadata 位于 `packages/<package-id>/` 下；根目录仍包含 `manifest.json` 和 `integrity.json`。API 会拒绝不安全路径、重复条目、缺少完整性记录、摘要不匹配、未知 target 和未在完整性映射中表示的归档文件。

从源代码构建 Host 和 Client bundle，然后在打包前把当前 lockfile 摘要写入 manifest。对除 `integrity.json` 外的每个归档条目计算 hash，把 hash 写入 `integrity.json`，再生成不可变的 `.dsh-plugin.zip`。Host 激活前，桌面 verifier 会将下载的归档、manifest 摘要、权限摘要、plugin id 和版本与已发布 release 比较。

在你自己的工作区构建归档。打包脚本必须在不导入 Harness 源码的情况下完成以下步骤：

1. 使用生产依赖构建每个声明的 Host 和 Client 入口。平台提供 Harness 原生包作为运行时服务时，将它们保持为 external。
2. 将准确的 target 路径和 package metadata 写入 manifest。schema `3` 必须为每个 Cordis package 包含一个 `packages/<package-id>/package.json`，并使其名称、版本、依赖和 target 与 manifest 一致。
3. 在 ZIP 根目录放入 `manifest.json`、每个声明的入口、每个 preset 或 asset，以及 `integrity.json`。
4. 对 `integrity.json` 以外的每个条目计算 hash，将 hash 写入 `integrity.json`，并计算发行记录使用的归档摘要。
5. 从 `dist/` 重新打开 ZIP，校验路径和 hash；声明入口缺失或存在未声明文件时必须让构建失败。

[`packages/plugin/acceptance`](../../packages/plugin/acceptance) 中的 fixture 只供平台维护者参考这些校验，不是外部插件依赖；外部插件的 package manifest 不应引用它的 workspace 脚本。

<a id="use-the-installation-scoped-sdk"></a>
## 5. 使用安装作用域 SDK

导入 `@deepseek-ai/dsh-plugin-sdk`，消费 target runtime 注入的 `PluginSdk`。SDK transport 不携带平台、数据库、对象存储或提供方凭据。每次调用都绑定创建 SDK 的 activation；撤销、权限修订变化、过期、配额失败或 target 不匹配后，调用会被拒绝。

有目的地使用 SDK 能力：

- `identity.current()` 读取当前用户和组织上下文；不能通过传入 id 读取其他用户。
- `models.list()`、`models.text()`、`models.textStream()` 和模型 task 方法使用已启用的模型目录，并要求对应的模型权限。
- `objects` 提供安装作用域的版本化内容；不会生成绕过撤销的公开 URL。
- `database` 在安装 schema 中接受参数化 SQL 和有界事务批次；不能访问平台数据库。
- `cache` 提供命名空间、支持 TTL 的临时状态，不是授权、计费或业务数据唯一存储。

在所有支持的调用中传递 `AbortSignal`。新操作使用新的幂等键；只有重试同一个幂等操作时才复用原键。把稳定的 `plugin/*` 错误作为产品状态处理，不要依赖提供方专属字符串。不要把 secret 放入 Client bundle、manifest、对象键或模型可见的工具结果。

<a id="handle-activation-and-lifecycle"></a>
## 6. 处理激活和生命周期

把发布、安装、target 启用、激活、升级、禁用和卸载视为独立状态。发布使 release 进入目录候选；安装创建稳定数据空间但不启用 target；设备启用记录期望状态；激活返回短期凭据；运行时请求重新检查 activation、installation、release、设备 target、成员资格和权限修订。

Target runtime 必须：

1. 在导入代码前校验不可变 release 和 target 入口。
2. 通过由 target fiber 所有的 effect 注册所有 Cordis 贡献。
3. 在禁用、撤销、升级、断开或卸载开始时停止接受新工作。
4. 等待 disposer 并报告清理失败；不得留下未跟踪的 listener、window、tool 或 worker。
5. 把新的 activation 或权限修订视为新的能力上下文；不要无限期缓存旧 SDK 凭据。

升级通过维护窗口执行。旧 activation 先撤销，迁移在安装数据空间事务中应用，只有验证完成后新 release 才会激活。迁移失败时安装保留在旧 release。卸载会撤销 activation，但数据空间由平台独立的数据删除操作保留。

<a id="test-the-complete-release"></a>
## 7. 测试完整版本

同时测试归档和两个 target。最低验收矩阵包括：

1. Manifest 接受和拒绝：缺少文件、不安全路径、重复条目、未知 target、重复权限或 resource、非递增迁移、缺少完整性条目和摘要不匹配。
2. Host 行为：SDK 权限检查、模型和数据调用、工具注册、取消、稳定错误投影以及 target 卸载后的释放。
3. Client 行为：模块表加载、贡献注册、locale 或 slot 输出、凭据不存在，以及 Client target 释放后的移除。
4. 生命周期行为：未启用的安装、激活 lease 过期、撤销、权限修订不匹配、升级确认、迁移回滚和卸载保留。
5. 产品行为：通过企业 runtime 的真实 Host/Client 组合、通过 Session 事件产生的模型可见工具输出，以及通过已声明 Client slot 或 window 产生的 UI 输出。

把包校验测试放在归档边界，把运行时测试放在 target 边界。只有当外部模型或存储服务不属于验收约定时才模拟它们。直接加载函数的测试不能证明归档校验、target 绑定或生命周期清理。

<a id="document-and-index-the-plugin"></a>
## 8. 记录插件并更新索引

插件 README 记录 target 矩阵、manifest 权限和 resource、SDK 调用、模型和 UI 影响、迁移、生命周期限制以及 release 验证。说明外部工作区的前置条件和准确构建命令。链接[企业模型](../enterprise-plugins.zh.md)、[生命周期参考](../developer/plugin-installation-lifecycle.zh.md)和[SDK 参考](../developer/plugin-data-sdk.zh.md)，不要复制它们的完整约定。

完成 ZIP 后，通过平台管理员的上传和审批流程提交。平台会在发布前校验 manifest、完整性映射、package 依赖、target 入口、权限和兼容性。安装用户只需要已发布的 release，不需要你的源码仓库、构建工具链或 Harness checkout。

插件新增包、target 入口、Client contribution、SDK 能力、构建脚本、验收 fixture 或发布路径时，在同一变更中更新[开发索引](../development-index.zh.md)。将插件加入企业组合行，链接源代码包和验证脚本；只有插件同时引入通用 Cordis 能力时才更新普通独立插件行。条目一致后重新记录英文/中文索引配对。

<a id="verification"></a>
## 校验

先运行独立工作区自己定义的脚本，再运行覆盖已发布归档的检查：

```sh
pnpm run build
pnpm test
pnpm run verify:package
```

`verify:package` 是作者工作区负责的脚本，必须重新打开生成的 ZIP，并校验 manifest、package metadata、入口、路径和完整性映射。改动影响发布、激活、包校验、Host 加载、Client 加载或生命周期状态时，由平台管理员或 CI 负责人运行企业 API 和桌面验收套件。包解析成功不代表 target 能够激活、使用其 SDK 权限或干净卸载。

只有当归档、target 边界、声明能力、激活生命周期、清理行为、测试、包约定和开发索引条目彼此一致时，企业级组合插件才算完成。
