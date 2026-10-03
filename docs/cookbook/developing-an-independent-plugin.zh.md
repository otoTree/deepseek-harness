# 实操手册：开发独立插件

[English](developing-an-independent-plugin.md) | 中文

本指南说明如何设计、实现、组合、测试、记录并编入索引一个 Cordis 插件，使其可以在不修改 agent loop 的情况下挂载、替换或省略。它适用于产品能力、提供方、消费者、钩子、UI 贡献或集成插件。先阅读[插件分类](../plugin-classification.zh.md)和[工作区包清单](adding-a-package.zh.md)；本指南把这些参考资料串成一条开发路径。

## 目录

- [定义独立责任](#define-the-independent-responsibility)
- [选择包结构](#choose-the-package-topology)
- [设计公共约定](#design-the-public-contract)
- [创建包和入口](#create-the-package-and-entry-point)
- [通过真实组合挂载插件](#mount-the-plugin-through-a-real-composition)
- [测试独立生命周期和行为](#test-independent-lifecycle-and-behavior)
- [编写包约定](#write-the-package-contract)
- [更新开发索引](#update-the-development-index)
- [校验](#verification)

-----

<a id="define-the-independent-responsibility"></a>
## 1. 定义独立责任

用一句话说明插件当前的参与者、输入、输出和所有者。当插件的生命周期和约定有明确所有者、贡献可以随 Cordis fiber 一起释放，并且其他组合可以通过已记录的扩展点省略或替换它时，插件才是独立的。

在选择包名之前确定运行时分类：

- 内置运行时插件属于执行主干，但仍通过服务约定提供可替换能力。
- 产品能力插件在主干仍可运行时增加面向用户或模型的行为。
- 组合或应用插件负责组装或承载其他插件；它加载某项能力并不会因此成为该能力的所有者。
- 插件系统基础设施包负责发现、加载、观察或集成插件。

如果一个包访问另一个包的私有状态、依赖某个特定的兄弟实现，或者因为不存在扩展点而修改 agent loop，就不要称它为独立插件。把缺失的行为放到已记录的扩展点，或者在实现前记录架构决策。

<a id="choose-the-package-topology"></a>
## 2. 选择包结构

当定义、实现和消费者由同一个所有者负责，且不需要独立发布或替换时，保留一个包。当 Service Definition、Service Provider 和 Consumer 角色需要独立演进时，将它们拆分到不同包；shell 包族是参考结构。[能力 seam 参考](../capability-seams.zh.md)负责角色约定，[添加包手册](adding-a-package.zh.md)负责包命名和编译器注册。

使用以下边界：

| 角色 | 负责 | 不负责 |
| --- | --- | --- |
| Service Definition | 与提供方无关的类型、事件、生命周期义务和服务键。 | 工具 schema、UI 传输或某个提供方的协议。 |
| Service Provider | 一个实现、它的配置、资源生命周期和外部协议适配。 | 消费者专用呈现或另一个提供方的策略。 |
| Consumer | 使用服务的工具、命令、提示词、API、UI 或 workflow 贡献。 | 属于服务所有者或提供方目录的提供方选择规则。 |

为每个包设置一个稳定的 `ctx` 键。可选服务使用 `ctx.get(name)`，必需服务使用声明式注入。每个 effect 都通过 `ctx.effect()` 或 `ctx.on()` 注册，并让 `register()` 返回注册表 disposer，使 HMR 和插件释放能够移除贡献。

<a id="design-the-public-contract"></a>
## 3. 设计公共约定

编写服务类型前，阅读[架构](../architecture.zh.md)、所有者子系统页和所有当前消费者。保持定义与提供方无关，并针对所有当前消费者设计它。跨边界不透明 id 使用 `Branded<B>`，可扩展事件表使用 declaration merging，封闭联合类型的 switch 以 `assertNever` 收尾。

让默认值显式存在。所有者实现负责解析 `resolve(request): Spec`；`run()` 接收已解析的 spec，不要在其中用 `?? default` 隐藏部署选择。在加载时校验配置，在模型/工具 JSON 以及持久化或协议数据的边界校验数据，并让 TypeScript 约束类型化的同进程值。

如果插件改变模型可见的任何内容，必须能从会话日志重建该输入，并添加所需的会话事件。不要把 UI 呈现放入模型结果。使用所有者 presenter、持久化结果 metadata 或相关子系统页定义的 client 派生呈现路径。

公共 JSDoc 必须记录失败、取消、所有权、时序、释放和持久性。带非 void 返回值的服务方法必须有 `@returns`；每个参数必须有 `@param`。Typert 和 export-JSDoc 检查会消费这些约定。

<a id="create-the-package-and-entry-point"></a>
## 4. 创建包和入口

按照[工作区包清单](adding-a-package.zh.md)完成 manifest、TypeScript 项目、aggregate 注册、README 和包测试。包位于现有包组下一层，使用 `@deepseek-ai/dsh-<name>` 作用域，并保持 ESM 导入显式。

插件导出形式只能选择一种：

- 服务包默认导出服务类。
- 函数插件命名导出 `name`、`inject`、必要时的 `Config` 和 `apply`，且不提供默认导出。

`src/types.ts` 只能放类型。保持实现模块职责单一：协议解析、服务状态、提供方 I/O 和消费者呈现不应堆在一个无法测试的文件中。只有独立观察可能发生分歧时才添加 `./invariant` 入口；否则省略它，并在包 README 记录包级原因。

<a id="mount-the-plugin-through-a-real-composition"></a>
## 5. 通过真实组合挂载插件

只有在服务和消费者约定完成后，才把插件加入所有者的 `cordis.yml`、profile patch 或 bundle。`cordis.yml` resolver manifest 中的裸插件必须出现在该 manifest 的 `dependencies` 中。部署变化的选择属于经过校验的 `Config` 字段；组合通过显式值和 loader 允许的 `!!js` 环境表达式提供它们。

使用受支持的 `dsh` profile 启动应用。不要为插件增加 package bin、demo launcher 或公开 SDK argv 逃逸。bundle 可以通过 `dsh --profile` patch layer 选择插件，但 bundle 负责组合，能力包负责运行时行为。

使用 Loader 和应用入口路径验证挂载结果。手工构造 `ctx.plugin(...)` 的测试不能证明发布组合能够解析包、应用配置、注册消费者并释放 fiber。

<a id="test-independent-lifecycle-and-behavior"></a>
## 6. 测试独立生命周期和行为

先在能够证明约定的最小层级测试插件，再运行真实组合：

1. 对解析、resolve、纯呈现和提供方专属行为做单元测试；不要让每个断言都重新模拟 Cordis 生命周期。
2. 通过包入口测试注册和释放。观察所有者 fiber 释放后，服务、事件监听器、注册表贡献或工具已经移除。
3. 通过 Loader 和应用/进程启动仅用于测试的 `cordis.yml`。只模拟外部服务或非确定性输入，并在真实边界断言模型可见、用户可见、持久化或协议输出。
4. 当改动到达模型请求、改变循环生命周期或改变产品可见的 transcript 输出时，添加记录会话快照。循环或会话约定改变时，同时更新 TypeScript 和 Python SDK 的预期输出。
5. 对 subprocess、worker、端口、文件、时钟和全局状态设置所有者和 teardown。只能单独运行通过的测试没有隔离性。

从[测试策略](../testing.zh.md)、包 README 和[开发索引](../development-index.zh.md)选择针对性的检查。没有实际运行文档中的操作或指定验证所有者时，不要声称提供方或平台行为已经验证。

<a id="write-the-package-contract"></a>
## 7. 编写包约定

在实现改动的同一变更中更新包 README 和 JSDoc。README 说明消费者可以做什么、配置、运行时语义、失败行为、扩展点、模型和 token 影响、KV-cache 影响以及持久化限制。链接生成目录，不要复制事件或工具表。公共类型或服务约定改变时，同时更新所有者子系统页。

新增非平凡责任、拓扑、生命周期规则、持久化格式或测试决策时，添加 Agent Note。该 note 记录问题、已发布的决策、替代方案、后果和验证；它不替代包 README 或本手册。

<a id="update-the-development-index"></a>
## 8. 更新开发索引

插件新增或移动包、入口、运行时路径、测试所有者、生成产物或真源文档时，在同一变更中更新[开发索引](../development-index.zh.md)。在包组行加入包；插件引入新的工作类型时加入运行时路径行；链接包 README、子系统页、实操手册和相关生成目录。

逐项检查索引中的路径是否存在。删除陈旧路径，不要把生成输出列为人工维护源。英文和中文索引内容一致后，运行 `pnpm run verify-translation-pairing --write docs/development-index.md` 重新记录两侧文件。

<a id="verification"></a>
## 校验

先运行包检查，再运行覆盖改动范围的文档检查：

```sh
pnpm run constraints
pnpm run typecheck
pnpm run lint
pnpm run test:docs
pnpm run doc-sync
git diff --check
```

当包发布运行时产物，或文档路径消费 `lib/` 时，运行 `pnpm run build` 和构建入口冒烟测试。只有需要外部凭据的提供方才运行真实 API e2e；无 key 的套件必须按照[测试策略](../testing.zh.md)自行跳过。

独立意味着可以通过已记录的约定替换，可以通过所有者观察，并且移除后不会留下未解释的注册、持久化记录或模型可见状态。插件扩展时始终保持这三个条件。
