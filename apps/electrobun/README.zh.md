---
description: "构建并验证 macOS 与 Windows 企业桌面客户端。"
---

# 企业桌面客户端

[English](README.md) | 中文

## 概述

本包构建原生智域OS桌面，提供随包账号页面与 Agent 工作区。通过 API 登录后，会话和工作文件保存在此电脑。关闭并重新打开应用时，无需云端成功响应即可恢复所选本地账号。云端模型、账单、云盘和插件管理要求有效的云端登录；登录到期或撤销不会关闭本地工作区。

两个桌面发行版通过[共享对话区与 Workbench 主题](../../packages/client/ui-theme/src/styles/workspace.css)提供紧凑控件、面板页签和输入框动作。Arivo 通过语义令牌提供产品色板与字体。

团队切换等待旧运行时关闭，并在选择前清除旧凭据。保存的团队必须重新通过成员资格验证；选择失败保留账号选择页面。[团队管理](../../docs/developer/enterprise-team-governance.zh.md)定义服务端授权与恢复规则。

Arivo 在 Rail、Workbench 与显式会话切换前使用启动插件的[离开协调器](src/distribution/arivo-shell/client/departure.ts)。精确 iframe 确认使输入冻结持续到同步界面提交结束；未确认保存与已编辑的未提交表单保留当前页。Client 的 `leaveTimeoutMs` 限制等待时间，默认 15000，范围 1000–60000。[原生门禁](src/distribution/arivo-native-departure.ts) 也确认菜单退出和用户关闭窗口，并保持冻结直到运行时停止。一次性回执只接受当前 OS 来源与请求，不开放通用原生 RPC。`ARIVO_EDITOR_LEAVE_TIMEOUT_MS` 限定原生确认等待（默认 20000，范围 1000–60000）。账号权威、信号与强制终止不在输入保证内，仍需原生平台验收，见[决策](../../.agents/notes/implemented/architecture/2026-10-24-arivo-editor-departure.zh.md)。

Arivo Workbench 剧本页默认收起版本历史，并省略嵌入的返回操作。剧本与分镜面板在对话下方共用分集列表；分镜新建由创作插件同时创建空剧本及固定来源。启动外壳通过 `sidebar.footer.action` 注册该列表，精确 frame 桥接把新建、选择、改名、删除和分镜来源绑定意图交给原编辑器。正文与持久化仍归创作插件所有。关闭或替换面板会释放侧栏贡献。

Arivo 对话通过原创作工具编写分镜提示词。创建镜头无需先准备剧本；创作插件原子关联空来源，并返回后续每次写入所需的修订。编辑器观察已保存的 Agent 修改，并保留未保存输入。参见[创作决策](../../.agents/notes/implemented/simplification/2026-10-27-arivo-harness-storyboards.zh.md)。

Arivo Rail 与设置中的账号入口共用普通人像轮廓图标。Arivo profile 不挂载内置插件配置与列表设置，用户通过 Arivo 插件市场管理扩展。

Arivo Workbench 画布通过同一个侧栏 slot 在对话下方显示独立的[画布列表](src/distribution/arivo-shell/client/canvas-rail.ts)。精确 frame 桥接把新建/打开/改名/删除意图交给所属编辑器，并保护草稿和未确认保存。编辑器默认打开首张画布、隐藏重复的管理区与返回控件，并负责元数据弹窗及逻辑删除确认。独立创作页保留画布管理区。参见[决策](../../.agents/notes/implemented/feature/2026-10-26-arivo-canvas-sidebar.zh.md)。

## 目录

- [本机 macOS 安装包](#local-macos-installer)
- [本机 Windows 安装包](#local-windows-installer)
- [桌面端更新](#desktop-updates)
- [安装包产物保护](#installer-artifact-protection)
- [集成要求](#integration-requirements)
- [原生模型提供方](#native-model-provider)
- [本地会话存储](#local-session-storage)
- [企业沙箱](#enterprise-sandbox)
- [开发备注](#dev-note)

桌面应用名和 DMG 卷标为「智域OS」，安装包文件名前缀为 `zhiyu-os`。[Web favicon](../web/public/favicon.png)取自[产品原图](../../logo.png)中的银色标志，移除了文字及展示示例。桌面构建将其同步为 Windows PNG 和 macOS 图标集；[Admin 图标](../admin/app/icon.png)使用同一图案。应用标识、更新签名中的标识和历史数据目录保持稳定，以保留已安装客户端的账号与工作区。首次更名安装时，请退出旧应用，把 `智域OS.app` 拖入 Applications，确认新版可用后移除旧的 `deepseek-harness-enterprise.app`；不同文件名不会触发 Finder 替换。旧 Windows 更新器只识别旧包名，需要手动安装品牌版一次；品牌版更新器同时校验新旧包名。参见[品牌与安装身份决策](../../.agents/notes/implemented/architecture/2026-10-21-zhiyu-desktop-brand.zh.md)。

macOS 凭据使用 `com.zhiyu.os.enterprise` 服务和智域OS标签。原生助手在下一次读写时移动匹配的旧服务项，并保留访问控制；退出登录删除该账号两种服务项。Windows 保留加密凭据目录。技术应用标识不代表模型供应商账号。

[发行身份](src/distribution/config.ts) 显式维护企业名称与数据路径。根企业构建/打包命令在子进程环境固定选择智域，并移除 Arivo 服务配置。直接构建企业组合时拒绝其他产品选择器。Arivo 具有独立的版本、安装、数据、凭证与运行时身份。[原生构建器](scripts/build-arivo.ts)通过 `--plugin-release` 接收版本化插件产物；`arivo:build:desktop`、`arivo:package:desktop` 和 `arivo:verify:desktop` 构建并检查本地 macOS 产品，不装配企业账号组合。详见[发行隔离决策](../../.agents/notes/implemented/architecture/2026-10-23-desktop-distribution-isolation.zh.md)。

企业开发和安装包运行时树均包含动态加载的桌面插件已发布依赖及 peer；Arivo 将 CLI 生产依赖与校验过的插件产物暂存到自己的目录。[运行时依赖选择](../../.agents/notes/implemented/bug-fix/2026-10-23-desktop-dynamic-runtime-dependencies.zh.md)解释仅部署 CLI 生产依赖为何不足以提供该闭包。

Arivo macOS [启动程序](native/arivo-bootstrap.c)先创建私有 Electrobun 安装根，再在同一进程中执行随包 launcher。它拒绝链接、其他用户拥有或允许组/其他用户写入的目录组件，使首次启动无需依赖既有 CEF 启动即可登记卸载程序；企业 launcher 保持原样。

原生凭证助手在编译时固定产品身份：默认构建保留智域 Keychain 旧服务迁移与 Windows DPAPI 目录；Arivo 编译输出位于独立目录，使用自己的凭证服务和目录，不读取旧企业服务。LaunchAgent 声明显式接收产品身份，省略时保留企业标签。[随包校验器](src/distribution/bundled-plugin.ts)在加载前检查应用固定的 manifest 摘要、版本、平台、文件清单与逐文件摘要；它拒绝链接和缺失资源，不请求市场租约。[Arivo 监督器](src/distribution/arivo-runtime.ts)在启动独立 DSH profile 前调用加载器。插件拥有带鉴权的 loopback 工作台及[原生目录锁](native/arivo-instance.c)，Host 退出时由内核释放锁；每次启动使用独立 profile 目录。本地 Arivo 产物使用 ad-hoc 签名、没有活动更新源，并加载独立发布的创作插件。Arivo 真实账号验收、Windows 安装和正式发行信任仍需单独验收。

Arivo 保留完整 OS `base` 与 `web-app` 组合。原生窗口打开项目中心并保留原始 Agent 对话；第一方启动插件在同一外壳增加 Arivo 创作 rail 入口与命名空间页面。页面切换保留所选 Session 及其控制器持有的草稿。适配器通过公开 connection RPC 与 Slot 服务嵌入经过校验的创作产物；只有所属 OS 的精确 loopback origin 可以嵌入，启动插件以具有生命周期的 Arivo token 覆写覆盖整个 OS，包括挂载到 body 的弹窗，同时保留已保存的浅色、深色及跟随系统偏好。版本化 rail 入口打开本地项目、备份和同一 Arivo 账号页；账号与运行环境页也注册到设置分区。frame 接收经过校验的页面、语言与色彩模式字段；对话 Workbench 另接收由 Registry 解析的项目 UUID。Arivo profile 不加载 DeepSeek 凭证入门插件；企业 profile 继续保留它。原始工具、预设、子 Agent、Skills/MCP 与设置继续由对应 OS 插件负责。Arivo 市场云端适配需要单独验收。

[Arivo 语言适配器](src/distribution/arivo-shell/host/language-adapter.ts)将原始 Agent 接入已验证插件的原生 v1 模型服务。它保留结构化工具历史，使用稳定 Session/步骤命令，禁用自动付费重试，并区分显式停止和订阅卸载。本发行仅准入 Arivo 路由。输出限制与目录查询预算属于启动插件的 Config。[适配器决策](../../.agents/notes/implemented/architecture/2026-10-23-arivo-language-adapter.zh.md)记录恢复语义与验收限制；外壳不提供全局模型/计费配置页或保存 RPC。新建项目对话沿用项目云归属与已保存的模型偏好，没有偏好时使用第一个可用的工具模型。[Session Controller](../../packages/api/session-controller/README.zh.md)在首次 prompt 前，为没有持久选择的对话记录目录对应的默认模型。已有对话与发现期间用户明确改选的路由均保持；对话模型菜单仍可切换。目录发现不创建生成或积分预留。见[项目默认模型决策](../../.agents/notes/implemented/feature/2026-10-26-arivo-project-model-defaults.zh.md)。私有 `agentToolRoundtrip` 浏览器夹具通过打包 profile 和真实 Arivo HTTP 验证官方模型、本地写入及关联续答；原生窗口与崩溃恢复仍需独立验收。

Arivo 构建器同时要求 `--api-origin` 与 `--web-origin`，将非敏感账号配置嵌入产物。两者必须是 HTTPS 或显式 HTTP IPv4 回环来源；缺少配置会在构建前失败。Arivo 要求联网账号；本地持久化和媒体计算不代表离线创作模式。`--identity-request-timeout-ms` 与 `--identity-login-timeout-ms` 为原生操作设置有界超时。[Arivo 账号配置](src/distribution/arivo-identity.ts)仅传入经过校验的第一方 Host profile，并提供 Arivo 原生凭证助手。Token 不得进入构建参数、环境变量或 profile 文件。独立插件负责浏览器 PKCE、原生凭证、续期和账号隔离项目；该接线不代表真实账号验收通过。

Arivo 启动先在仅包含已验证创作插件的临时 profile 中探测原生身份，再以 `accounts/<origin-and-user-digest>/agent` 下的 `$DSH_HOME` 启动完整 OS；退出状态保留原有设备目录。会话、搜索缓存、设置、托管凭证、自建预设及默认工作区均随该目录隔离。账号变化时清空原生窗口，等待整个旧 Host 退出，再导航到重新鉴权的新 Host，不复用活动 Agent 或界面投影。本地数据保留，续期过期仍保留相同本地归属，设备草稿不导入账号。这些目录隔离同一 OS 用户的应用持久数据，不限制该用户明确访问其他本地文件。真实云账号、原生切换和 Windows 仍需验收。

Arivo [创作工具](src/distribution/arivo-shell/host/studio-tools.ts)通过原 Harness 工具注册器提供已验证插件的限定账号剧本、分镜与[画布](src/distribution/arivo-shell/host/canvas-tools.ts)用例。启动 Client 在对话旁贡献可关闭 Workbench 面板。[目录绑定决策](../../.agents/notes/implemented/architecture/2026-10-25-arivo-project-folder-binding.zh.md)将创作工具和对话 Workbench 绑定到原 Session 目录。统一创建通过已验证插件关联所选文件夹与已授权线上项目，再向原 Workspace Registry 登记目录；恢复沿用同一命令，无须再次选择目录。插件拥有项目文件夹数据路由，Harness 拥有普通对话存储。两个面板读取同一本地记录，云端模型继续鉴权计费。见[决策](../../.agents/notes/implemented/architecture/2026-10-24-arivo-creative-tools.zh.md)。

<a id="local-macos-installer"></a>
## 本机 macOS 安装包

使用已安装 Bun、Xcode Command Line Tools、工作区依赖和桌面开发所需固定版本 Electrobun SDK 投影的 Apple Silicon macOS，再从仓库根目录运行下列命令。它会重新构建工作区库、桌面前端、插件、原生辅助程序和打包运行时，生成 `apps/electrobun/artifacts/local/zhiyu-os-<version>-macos-arm64-local.dmg` 及 SHA-256 校验文件。版本来自本应用的包清单。官方 Node 校验和及运行时归档按产品和 Node 版本缓存；未缓存文件需要访问 nodejs.org。每次解包前均校验官方 SHA-256；未完成的下载不发布到缓存。构建暂存使用独立的 Electrobun 项目，因此正在运行的开发应用不会持有安装包构建锁。

```sh
pnpm run enterprise:package:desktop
pnpm --filter @deepseek-ai/dsh-enterprise-desktop verify:installer
```

验证器以只读方式挂载 DMG，将应用复制到仓库外的私有临时 Applications 目录，检查签名和已保护资源，并通过本地模拟 API 与凭据辅助程序启动包内企业 Web profile。它无需模型密钥，即可覆盖有模型和空模型目录、认证后的 HTML 以及运行时关闭。随后会删除临时安装。交互使用时，打开 DMG，将应用拖入 Applications 后启动。在安装包构建环境中只需设置 `ENTERPRISE_API_URL`，选择 API。构建器校验 HTTPS 来源或明确的 HTTP 回环来源，并将其嵌入主进程，使 Finder 启动时无需终端环境变量即可连接选定部署。省略时使用 `http://127.0.0.1:8787`。源码开发仍读取启动环境。安装包的账号、模型路由和 Session 持久化使用选定 API；任务执行和组织工作区仍在本机。

本机命令使用 ad-hoc 签名。下载后的副本首次启动时，可能需要在 macOS「隐私与安全性」中明确批准。此安装包验证构建机器上的安装，不代表 Gatekeeper 信任、Intel 兼容性或全新机器上的原生模块可移植性。

### macOS 签名发布

通过 Developer ID 分发时，先安装带私钥的 Developer ID Application 证书，并使用 `xcrun notarytool store-credentials` 保存 Apple 公证凭据。在发布终端设置以下环境变量。证书身份与团队使用开发者账号的实际值；配置名指向已有钥匙串条目。`DSH_MACOS_KEYCHAIN` 可选，用于显式指定签名与公证使用的钥匙串。保留下文说明的部署与更新源配置。

~~~sh
export DSH_MACOS_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID1234)"
export DSH_MACOS_TEAM_ID="TEAMID1234"
export DSH_MACOS_NOTARY_PROFILE="your-notary-profile"
export DSH_MACOS_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
pnpm --filter @deepseek-ai/dsh-enterprise-desktop build:installer:release
~~~

发布命令检查钥匙串认证，构建并保护应用，为嵌套原生代码添加 hardened runtime 与安全时间戳签名，验证打包 profile，签名 DMG，并上传一次。它生成 `artifacts/release/zhiyu-os-<version>-macos-arm64.dmg` 及 `.notary.json` 跟踪文件，拒绝已有发布路径。每次构建新版本时递增应用包版本。签名从嵌套组件到外层容器依次执行，不使用 `--deep`。发布权限排除 `get-task-allow`，允许随包 Node/Bun 的 JIT 和原生库运行。

如果 Apple 返回 `In Progress`，命令保存提交 ID 后退出。保留相同配置，稍后再次执行以下命令；它只查询该 ID，绝不上传。Apple 不提供取消已上传提交的命令。上传结果不确定时保留 `submitting` 记录：先通过 `notarytool history` 找回 ID 再继续，不要删除记录重新上传。收尾被中断时可能留下 `.notary-lock`；删除该锁目录前，确认没有公证命令正在运行。

~~~sh
pnpm --filter @deepseek-ai/dsh-enterprise-desktop notarize:installer /absolute/path/to/release.dmg
~~~

Apple 接受后，命令保存审核日志，附加并验证票据，检查 DMG 和复制安装后的应用的 Developer ID 签名与 Gatekeeper 信任，然后用通过校验的最终文件替换 DMG 和 SHA-256 校验文件。跟踪状态为 `verified` 才表示完成。拒绝时保存日志并报错；再次查询不会轮询已结束的提交。DMG 被修改时校验失败。附加票据会改变安装包字节，因此只在完成后签署[更新元数据](#desktop-updates)。脚本不发布文件，也不保证 Apple 处理时间。参见[公证决策](../../.agents/notes/implemented/process/2026-10-21-macos-release-notarization.zh.md)。

<a id="local-windows-installer"></a>
## 本机 Windows 安装包

在 x64 Windows 主机上构建，需要 Node.js 22.19.x 或 24+、pnpm、Bun，以及 Zig 或带 Windows SDK 的 Visual Studio C++ Build Tools。首次准备 Electrobun 和下载未缓存的官方 Node 运行时需要网络。从仓库根目录安装工作区依赖并运行：

~~~sh
pnpm install
pnpm run enterprise:package:desktop
pnpm --filter @deepseek-ai/dsh-enterprise-desktop verify:installer
~~~

构建会生成 `apps/electrobun/artifacts/local/zhiyu-os-<version>-windows-x64-local.zip` 及 SHA-256 校验文件。ZIP 内含 `智域OS-Setup.exe` 和包含元数据、压缩应用载荷的 `.installer/` 目录。请完整解压 ZIP，并从解压目录运行 Setup.exe，以便安装器读取 `.installer/`。验证器检查校验文件、x64 PE 文件头、stable 应用元数据和 Zstandard 载荷。构建会在生成 ZIP 前混淆第一方 JavaScript，并使用本地模拟 API 冒烟测试打包后的 profile。

`verify:installer` 检查归档内容，但不会运行 Setup.exe 界面。请在 x64 Windows 机器上完成一次交互式安装检查。Windows 构建不会添加 Authenticode 签名或发布者身份，因此不代表发布者已受信任，也不代表原生模块可在全新机器上运行。

<a id="desktop-updates"></a>
## 桌面端更新

在 **设置 → 通用设置 → 软件更新** 中选择 **检查更新**，或从原生应用菜单选择 **检查更新…**。两个入口共用同一个原生更新器。签名发布清单会在下载前显示版本及发布者的更新说明。应用流式下载完整安装包，验证精确大小和 SHA-256，并在停止本地任务、打开安装器前再次确认。菜单可以取消传输。推迟安装会删除此次下载，再次检查时重新下载。下载与安装仅在主动请求时运行。

Windows 会完整解压 ZIP，再打开旁边带有载荷的 Setup.exe。macOS 需要将已打开 DMG 中的应用拖入“应用程序”并确认替换。安装后请重新打开应用。账号凭据和组织数据保存在应用包之外。成功交接后会保留私有临时安装目录，供 Setup 或磁盘映像继续访问；临时目录由操作系统清理。两个平台均不提供静默替换、增量更新、自动重启或数据降级。

### 发布者配置

将 Ed25519 私钥保存在仓库和构建输入之外。从本应用目录运行下列命令，指定已存在的安全父目录。命令会输出新建的私有目录，其中包含 `release-private.pem` 和 `release-public.txt`；后续发布保留使用同一个密钥。Windows 继承父目录访问权限，因此请选择仅发布操作者可访问的目录：

~~~sh
pnpm run keygen:update --directory /secure/desktop-releases
~~~

运行安装包构建前，在构建环境中将 `DSH_DESKTOP_UPDATE_URL` 设置为目标平台的 HTTPS 清单地址，将 `DSH_DESKTOP_UPDATE_PUBLIC_KEY` 设置为 `release-public.txt` 的内容。为 `darwin-arm64` 和 `win32-x64` 分别使用独立清单。安装包构建会校验这两个值并嵌入原生可执行文件；已安装构建无法通过环境变量更改清单地址。两者均省略时禁用更新，仅提供一个会导致构建失败。轮换公钥需要安装信任新密钥的构建。

递增本应用包清单中的版本号，在各宿主平台构建并验证安装包，然后签名元数据。从本应用目录运行下列 Windows 发布示例；将路径和 HTTPS 地址替换为已验证产物及公开下载位置。macOS 则选择 `darwin-arm64` 和 DMG：

~~~sh
pnpm run sign:update --artifact /path/to/installer.zip --url https://updates.example.com/installer.zip --target win32-x64 --notes /path/to/release-notes.txt --key /secure/release-private.pem --output /path/to/latest-win32-x64.json
~~~

签名器读取包版本、产物大小及哈希和 UTF-8 更新说明，输出带 Ed25519 签名的 base64 载荷，且拒绝覆盖已有输出。 使用 Admin 发布时，将安装包地址设置为 `ENTERPRISE_API_URL/desktop/updates/<target>/<version>/installer`，将输出保存为 `<installer>.update.json`，并在 `/platform/desktop-releases` 选择这两个文件。客户端构建设置 `DSH_DESKTOP_UPDATE_URL=ENTERPRISE_API_URL/desktop/updates/<target>/latest`，并在 [API 发布配置](../api/README.zh.md#desktop-releases) 中部署同一公钥。首次发布前，更新地址报告没有可用更新。静态托管也可使用：先上传不可变的安装包，再将签名 JSON 发布到构建内固定的清单地址。两个地址及重定向均要求使用不含内嵌凭据或片段的 HTTPS；公开静态托管即可。客户端拒绝无效签名、格式错误的字段、平台不匹配及相同或更低的语义化版本。清单读取超时为 30 秒，传输及解压超时为 30 分钟；取消和退出会等待活动 I/O 结束。每次启动会在后台检查一次，不延迟账号恢复。经过验证的新版会在账号页或工作区显示持续、可关闭的悬浮通知；点击“安装更新”进入同一确认流程。关闭状态在本次启动的页面切换和窗口间保持。已是最新版、缺少配置或启动检查失败时不打扰用户；设置和原生菜单仍可手动检查。

发布签名为已信任固定公钥的客户端验证更新来源，并不建立首次安装信任、Apple 公证或 Windows 发布者信任。原生壳类型检查、签名清单及下载测试和本地对话框预期输出覆盖此流程；Setup 交互安装、DMG 替换及全新机器升级仍需在对应平台验收。参见[更新决策](../../.agents/notes/implemented/architecture/2026-10-20-signed-desktop-updates.zh.md)。

<a id="installer-artifact-protection"></a>
## 安装包产物保护

macOS 和 Windows 安装包会混淆主进程、前端、内置插件及运行时依赖树中的第一方 JavaScript。每个安装包都包含对应构建宿主平台的官方 Node 运行时，并使用 Node 发布的 SHA-256 校验和验证；Node 许可证也随包分发。macOS 启动器会将自身替换为 Node；Windows 启动器会在关闭时终止其 Job Object 中的 Node 运行时。

企业客户端已将 API 数据校验代码编译进产物，因此运行时依赖树不包含 API 服务端。暂存资源会移除 TypeScript、source map、source-map 注释、原生源码文件和 `.env` 文件。第三方 JavaScript 保持可执行，第三方许可证保留在依赖树中。生成的标识符按资源使用独立前缀，以支持 Client 脚本拼接。转义字符串字面量在解析时处理，渲染期间无需执行生成的字符串解码函数。公开导出、属性名和通过反射读取的服务名保持稳定。`protection.json` 记录受保护模块的哈希；验证器拒绝新增、变更或缺失的第一方脚本，以及泄漏的源码和调试文件。这些措施提高逆向成本，但不会加密浏览器代码、隐藏公开协议、保护内嵌密钥，也不能阻止本机管理员检查可执行逻辑。参见[打包决策](../../.agents/notes/implemented/architecture/2026-10-19-local-desktop-installer-protection.zh.md)。

<a id="integration-requirements"></a>
## 集成要求

企业客户端通过自己的 `frontend/` 入口复用共享 Web 客户端包和视觉语言，本地运行时组合 [Web profile](../../packages/bundle/web-app/cordis.patch.yml)。两个桌面覆盖层都禁用继承的 `ui-trajectory` 插件。Electrobun 将该前端打包到自身资源中，不读取 `apps/web/dist`。不能将不受限制的个人 profile 宣称为受治理的企业运行时。仅有后台 API 无法约束本地模型提供方或动态插件 loader。

[原生登录](src/desktop-auth.ts)使用 S256 PKCE 和校验 state 的一次性回环回调。原生账号请求仅使用 API 来源。macOS Keychain 和 Windows DPAPI 辅助程序通过 stdin 接收凭据；令牌和 API cookie 不进入 WebView。[DesktopSession](src/desktop-session.ts)恢复已保存的账号，并在不联系 API 的情况下启动[运行时管理器](src/runtime.ts)。管理器要求绝对可执行路径及已配置的 `enterprise-desktop` profile，清理继承的凭据并等待进程退出。Windows 使用关闭时自动终止的 Job Object 管理 Node。

关闭应用会在系统凭据库中保留凭据及按部署隔离的定位记录。即使云端授权已到期，启动后仍可读取本地历史。退出登录会停止运行时、尝试云端撤销并移除两项凭据记录，同时保留本地文件。账号 cookie 仅保存在原生进程内存中；切换组织可能需要登录。[账号入口](../../packages/client/ui-enterprise-account/README.zh.md#use-this-package)根据部署策略显示 SaaS 团队创建或私有公司入口。

桌面随包提供 CEF Chromium，用于沙箱内的原生浏览器 guest。可信应用壳使用原生 renderer。[`browser-config.ts`](src/browser-config.ts) 配置回环 CDP（默认端口 `9333`，构建及运行环境变量为 `DSH_DESKTOP_CDP_PORT`）；组织 profile 将 Playwright 连接到该端点。[Workbench 浏览器](../../packages/client/ui-workbench/README.zh.md)渲染 Agent 工具控制的同一页面。 [`browser-lifecycle.ts`](src/browser-lifecycle.ts) 在 macOS 上拦截 Electrobun 2.0.1 移除已加载 CEF 客体时额外发出的宿主窗口关闭请求。

原生账号入口服务器接受最大 64 KiB 的请求头，并在 HTML 响应中让旧的 `dsh-auth-*` Cookie 失效。这样，带有旧 Runtime 端口 Cookie 的桌面窗口仍能打开登录页，并在加载认证 Web UI 前完成清理。

[LaunchAgent 辅助程序](src/launch-agent.ts)仅替换应用自有注册。[EnterpriseRuntimeController](src/runtime-controller.ts)串行启动与停止，在登录启动配置中传入账号隔离的 `DSH_HOME`，并清理失败的注册。账号身份由部署来源、账号 ID 和组织 ID 共同确定；更换登录令牌仍使用同一工作区及 Workbench 分区。设备授权没有限额或心跳。云端请求检查成员资格、撤销和服务端到期时间，并在需要时续期有效授权。

`typecheck:runtime` 检查 Node 辅助模块和测试；`typecheck` 使用固定 SDK 检查原生壳。原生 Keychain 测试需要 `build:native` 和 `ENTERPRISE_TEST_KEYCHAIN=1`。Electrobun 将 DSH 可执行文件、原生辅助程序、前端和插件产物放入应用。共享 Cordis 和 MCP runtime package 保持外部依赖并放在同一依赖树，保留 service 身份。`verify:build` 使用隔离的原生 Node 解析导入 Host 入口，并拒绝应用外依赖。全新机器上的原生模块可移植性仍属于发布验收。

原生退出保护在窗口、账户服务和所管理 runtime 停止前，通过 Electrobun 的同步 `before-quit` 事件阻止退出；清理失败后可以重试退出。

Arivo [真实图片验收](../web/tests/arivo-images.e2e.ts)消费显式启用的私有桌面授权，并通过打包 Host 验证正常创作控件；[验收决策](../../.agents/notes/implemented/testing/2026-10-23-arivo-bundled-image-acceptance.zh.md)区分付费轮次与显式 poll-only 重建。

Arivo [打包工具恢复](../web/tests/arivo-tool-recovery.e2e.ts)通过免费云端响应检查 Bash 副作用中断及普通历史续问。[验收决策](../../.agents/notes/implemented/testing/2026-10-23-arivo-bundled-image-acceptance.zh.md)定义信号范围与平台限制。

<a id="native-model-provider"></a>
## 原生模型提供方

`pnpm --filter @deepseek-ai/dsh-enterprise-desktop build:provider` 构建[网关插件](src/gateway-provider.ts)，导出为 `@deepseek-ai/dsh-enterprise-desktop/gateway`。云端操作需要时，插件检查凭据绑定并读取授权与启用的模型 ID。API 在 `/model/*` 下使用服务端持有的提供方凭据中转 Chat、Responses 和 Files 请求。每次请求选择平台模型 ID；适配器为 API 模型期限额外留出传输宽限时间。

[请求与流转换](src/gateway-wire.ts) 按所选目录条目把 DSH 消息映射为 OpenAI Chat Completions 或 Responses。它通过附件服务解析持久图片、视频、音频和文档；提供方文件策略使用共享 `llm-files` 协调器，有界内联策略则生成请求范围内的 Base64。媒体读取使用 profile 的 `maxMediaBytes` 限制，并与模型输出和网关元数据使用的 `maxResponseChars` 限制分开。当 Files API 上传仍处于处理状态时，适配器会按已配置的间隔轮询原生 `/files/:id` 资源，直到文件可用、处理失败或达到模型的上传超时；取消会同时停止等待和状态请求。目录元数据会另外说明原生视频只覆盖画面，还是也理解内嵌音轨；独立音频输入仍使用 `audio` 模态，两种视频模式则使用相同的提供方视频协议项。Responses 历史把 assistant 文本生成为已完成的原生消息项，并保留它与 reasoning 及后续媒体输入的顺序。Responses 工具结果把文本保留为有关联关系的 `function_call_output` 字符串，并把媒体放入相邻的用户输入项，因为 Ark 会拒绝结构化的 `function_call_output.output` 值。企业 API 校验模态声明与限制，使用服务端凭据上传提供方文件，并在不转换协议的情况下转发所选响应。适配器接受初始事件省略 `arguments` 的 Responses 函数调用项，累积后续参数增量，并要求完成项包含最终字符串。它把 reasoning-summary 记录投影为 DSH reasoning 块，并把每个非空的加密 reasoning 项与对应的原生函数调用一起存入带版本且按块对齐的适配器回放状态。后续工具轮次会在 `function_call_output` 之前按原顺序恢复这些原生项；初始事件中的空 `encrypted_content` 会被忽略，已经出现但不是字符串的协议字段则会关闭式失败。回放状态不包含附件数据或提供方文件标识符。适配器把 HTTP 429 分类为 `RATE_LIMIT`，把网关超时分类为 `TIMEOUT`，严格拒绝未知流式事件，并在取消时关闭附件读取、上传、状态轮询和模型响应。

生成的企业 profile 组合此提供方、本地 JSONL 会话持久化、企业客户端桥接及 Web profile。[Profile 测试](tests/gateway-profile.ts)通过 `dsh --profile` 验证构建后的提供方；真实 Keychain 检查要求 `ENTERPRISE_TEST_KEYCHAIN=1`。

两个桌面 profile 默认选择能力完整的 `cordis` Bot，并对新选择禁用 `standard`、`ptc` 和 `minimal`。Bot 管理保留组织 DSH Home 的 `.agent-presets` 目录，用于自定义和已安装插件提供的 Bot。历史会话保留并可恢复其记录的 preset。

<a id="local-session-storage"></a>
## 本地会话存储

桌面保留基础 profile 的 [JSONL 提供方](../../packages/session/session-persistence-jsonl/README.zh.md)。主目录为 `dataRoot/accounts/<identity>/organizations/<organizationId>`；identity 是 API 来源、账号 ID 和组织 ID 的哈希。会话事件、工作文件和浏览器状态保存在该账号的存储目录中。重新打开与读取历史无需云端请求或写租约。请备份这些文件；删除文件会丢失本地历史。

打开**设置 → 企业账户 → 对话云端同步**，上传全部本地对话或下载云端对话。在另一台设备登录同一账号和组织后，下载即可继续使用。传输保留一致的较长历史，遇到分歧即停止，不覆盖已有记录。中断前完成的页面会保留，重试可以安全续传。下载较长的云端历史前，请先关闭对应对话。仅传输对话事件；附件和工作文件留在原设备。电脑之间不自动同步。[客户端 README](../../packages/client/ui-enterprise/README.zh.md#mounting)负责传输语义。

远程 [SessionPersistence 适配器](src/session-provider.ts)供显式选择存档服务的使用方和 API 测试使用；桌面 profile 不挂载它。其服务端写租约仅保护远程写入。授权与存储取舍参见[本地会话决策](../../.agents/notes/implemented/architecture/2026-10-22-local-desktop-sessions.zh.md)。

<a id="enterprise-sandbox"></a>
## 企业沙箱

[企业沙箱](src/enterprise-sandbox.ts) 为具名桌面 profile 包装现有 `sandbox-local` Provider。在 macOS 上，受限调用使用平台 Seatbelt 运行器；在 Windows 上使用 ACL 受限令牌运行器。所选后端不可用时，调用会失败关闭。生成的桌面 profile 让 Session 从 `workspace-write` 启动，因此 Workbench 和 agent 可以更新组织工作区内的文件，同时仍拒绝工作区外的路径。调用方传入绝对工作区路径，并可为范围更窄的调用选择 `read-only`。`danger-full-access` 仍是 Provider 之外的显式用户选择。该包装不承诺网络隔离或防止本机管理员篡改，完整桌面 profile 仍需挂载其消费者。

<a id="dev-note"></a>
## 开发备注

[验收要求](../../docs/developer/discussion/enterprise-client-acceptance.zh.md) 区分 Web 基线行为与经过验证的企业行为。

升级说明：迁移 `0039_local_desktop_sessions` 将设备租约到期字段改为登录到期字段，并移除设备限额。不含账号 ID 的凭据需要登录一次。已有云端会话可通过显式导入操作读取；旧本地运行时目录保留，不会并入其他账号。

Arivo Rail 在创作入口之后提供独立任务界面。固定嵌入页面归构建后的创作插件所有，由其选择云端项目并读取授权任务页。[任务入口决策](../../.agents/notes/implemented/feature/2026-10-26-arivo-task-rail.zh.md)定义职责与验证。

Arivo 在 Workbench 开始页直接展示通用生成、剧本、设定集、分镜、画布与资产库。卡片使用统一 32px Arivo 图标规范，经认证嵌入路由直达当前 Session 文件夹对应项目页面。缺少绑定时明确报错；所有面板沿用编辑离页协调。
