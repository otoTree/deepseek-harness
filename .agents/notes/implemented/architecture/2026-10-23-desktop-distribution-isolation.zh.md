# Agent Note: 桌面发行身份隔离

Status: implemented

[English](2026-10-23-desktop-distribution-isolation.md) | 中文

## 问题

新增桌面产品不能重定向企业构建、复用已安装的企业数据，或成为企业更新器接受的升级。共享构建进程可能继承另一产品的选择器与服务配置。

## 决策

[发行配置](../../../../apps/electrobun/src/distribution/config.ts) 校验不可变的智域和 Arivo 身份、产品自有版本选择、平台数据根及分离的构建/产物目录。企业品牌与数据路径消费者显式选择智域。根企业桌面构建和打包命令通过[子进程包装器](../../../../apps/electrobun/scripts/run-distribution.ts) 固定选择智域，移除 Arivo 配置，不修改父进程环境。

原生凭证助手通过编译选项固定产品身份；Arivo 不迁移企业 Keychain 服务，不写入企业 DPAPI 目录。默认编译继续保留智域服务迁移和路径。[后台服务声明](../../../../apps/electrobun/src/launch-agent.ts)按显式产品选择标签及 plist 路径，省略产品时使用企业身份。

[随包加载器](../../../../apps/electrobun/src/distribution/bundled-plugin.ts)在激活前校验已安装资源的固定摘要、协议版本、发行版本、平台、文件清单及全部文件摘要。调用方必须从受签名保护的应用配置提供摘要，并在加载期间保持安装资源不可变；用户工作目录及市场租约不构成信任来源。校验、取消或缺失依赖文件失败时，不注册插件。加载后的并发关闭共享同一个异步释放结果。

企业构建配置拒绝其他发行版，避免将 Arivo 外观应用到企业账号组合。[Arivo 原生入口](../../../../apps/electrobun/src/distribution/arivo-index.ts)只通过 DSH profile 启动校验过的第一方 Host/Client/Agent 产物。构建、打包和校验命令消费显式发行目录、独立产品暂存及 CLI 生产依赖。本地 macOS DMG 校验使用只读挂载和临时安装副本；ad-hoc 签名不建立正式发行信任。Arivo 不装配企业更新器或活动更新源。

Electrobun 2.0.1 的原生管理器要求安装根目录在 macOS 首次登记前已经存在。Arivo 专用[启动程序](../../../../apps/electrobun/native/arivo-bootstrap.c)通过校验过的目录句柄创建该产品目录，再以未修改的随包 launcher 替换自身，保留进程 ID、参数与终止行为；被重定向或不安全的目录组件会在委托前失败。无需修改 SDK 或企业 launcher。

[品牌决策](2026-10-21-zhiyu-desktop-brand.zh.md)、[企业凭证决策](2026-10-23-enterprise-upgrade-and-administration.zh.md)和[签名更新决策](2026-10-20-signed-desktop-updates.zh.md)继续维护既有企业身份与兼容性要求。企业 Admin、API schema、更新协议、信任密钥和镜像发布入口均未改变。

插件 Host 通过随包原生助手持有内核文件锁；Host 关闭即释放锁，无需删除锁文件或猜测 PID 所有权。每次启动写入自己的 profile 目录，被拒绝的第二实例不能替换正在运行的 profile。Host 监控原生拥有者，监督器等待进程关闭后再删除 profile。工作台报告本地运行时就绪；独立版本化插件负责账号和创作用例。

[Arivo 账号配置](../../../../apps/electrobun/src/distribution/arivo-identity.ts)接受显式 Web/API 来源和有界超时。构建器将配置嵌入 Arivo 主进程；监督器仅向第一方 Host 提供非敏感值和编译为 Arivo 身份的凭证助手。省略配置时保留离线启动，不进入企业鉴权。独立插件消费版本化 Arivo Identity 线协议，并在浏览器和业务数据库之外管理 Token。真实账号与原生浏览器验收独立于配置和凭证助手验证。

Arivo profile 先组合原始 OS base 与 Web application bundles，再加载经过校验的创作插件。启动适配器贡献带鉴权的 RPC、rail 入口及命名空间 `main.surface` 页面；原生窗口打开原始对话。创作页在仅允许所属 OS origin 嵌入的 frame 中运行，保留原始 Session 提供者并隔离创作 CSS。页面生命周期仅在挂载期间标记所属文档；启动主题将该活动创作页固定为 56px 常驻 rail 与弹性主区，不为会话侧栏或工作台预留空间；对话布局保留自身列宽。具有生命周期的 Arivo token 覆写在两种外观模式中覆盖整个 OS 及其 Portal 弹窗。侧栏拥有可选的导航选中填充 token；产品未覆写时保留已发布的蓝色默认值。Rail 入口和设置分区通过鉴权 RPC 请求版本化页面、语言与色彩模式；文档渲染前拒绝未知或重复查询字段。Host 的索引转换在 Client 插件激活前提供 Arivo 文档标题、启动字标与经过校验的 favicon。可选挂载点数据属性为静态启动页命名，其他产品保留默认字标。构建器在暂存运行时前编译 Client 产物和前端。账号入口使用创作 Host 已有的原生身份，不向任一浏览器暴露凭证。Arivo 不加载 DeepSeek 凭证入门行，企业组合保持原样。该组合保留 OS 工具、预设、子 Agent、Skills/MCP 和设置。Arivo 市场服务仍需独立验收。

监督器通过只装配已验证创作插件的可丢弃 profile 解析原生身份，再启动任何用户 Agent。Host 在读取或持久修改原生凭证后发出 `arivo account-scope: v1:<device-or-digest>`，其中不包含 Token 或浏览器提供的范围。已确认用户使用经过检查的私有 `accounts/<digest>/agent` DSH 目录，设备使用保留原目录。归属变化后，包含 Session 存储、搜索缓存、工作区登记、自建预设目录、设置与权限的整个进程被替换；原生视图在退出前清空，仅在新 Host 确认范围后导航，防止旧内存投影和后台任务跨账号存活。续期中断保留本地归属；持久退出在远程撤销不可用时仍切换到设备范围，不将原设备记录搬入账号。[范围测试](../../../../apps/electrobun/tests/arivo-account-scope.test.ts)拒绝路径穿越、链接和不安全目录权限；打包 profile 回归覆盖两个账号目录、离线退出、旧 URL 失效、设置/预设分离及已提交 Session 恢复。真实云身份与原生/Windows 验收仍需独立完成。

## 考虑过的替代方案

**运行时通过环境变量选择品牌。** 已启动的企业应用可能采用另一产品的路径或身份。已发布的企业消费者显式选择自己的产品。

**将企业桌面复制成第二个应用。** 在独立 Arivo 组合存在之前，这会重复生命周期和安全职责。

## 后果

[发行回归](../../../../apps/electrobun/tests/distribution.test.ts) 固定已发布的企业值、Arivo 独立版本/数据身份、不可变配置、子进程环境隔离、拒绝错误组合选择，以及企业更新器拒绝签名有效的 Arivo 更新。元数据不迁移已安装数据或凭证。企业 Admin 和 API 不依赖 Arivo 插件检出目录与资源。

[原生凭证回归](../../../../apps/electrobun/tests/keychain.test.ts)使用相同的全新测试账号键检查两个已编译助手读写和删除互不影响；[随包回归](../../../../apps/electrobun/tests/bundled-plugin.test.ts)加载真实本地 ESM 入口，校验篡改、路径、缺文件、预算及释放错误。Windows 需在原生系统执行，macOS 结果不替代它。[生产镜像回归](../../../../apps/electrobun/tests/enterprise-images.test.ts)由 `DSH_ENTERPRISE_TEST_API_IMAGE` 和 `DSH_ENTERPRISE_TEST_ADMIN_IMAGE` 显式启用；它拥有独立数据库、对象存储和网络，并验证初始化、登录、重启幂等及 Admin standalone 启动，不修改既有服务数据。
