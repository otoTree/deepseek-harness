# Agent Note: Enterprise start 重建开发产物

Status: implemented

[English](2026-09-16-enterprise-start-builds-runtime.md) | 中文

## 问题

企业启动命令可能在 workspace 库或浏览器组合包过期时启动 API 与桌面进程。Electrobun 的开发命令只重建前端和插件，而桌面运行时会通过生成的 `lib` 文件解析 workspace 包，session-controller 客户端组合包也不会被它重建。App bundle 还会复制不含包依赖的企业 Client Host 入口，因此即使 Electrobun 报告构建成功，Cordis 仍可能在首次导入时失败。

## 决策

`pnpm run enterprise:start` 会在基础设施检查和应用进程启动前执行 `pnpm run enterprise:build`。该构建刷新 Host 库图和全部 Client 组合包；存在 `--desktop` 时，启动还会执行 `pnpm run enterprise:build:desktop`，依次刷新 Electrobun 前端、插件、原生辅助程序、运行时、生成的图标集和开发 app bundle，然后选择桌面包的 `dev:prepared` 入口。企业 Client Host 入口会打包全部非内置依赖。构建后检查会将已放入 App 的入口复制到 workspace 外，并由普通 Node 导入，因此仍依赖 workspace 包解析时构建会直接失败。开发桌面中的 DSH 本地运行程序继续使用 `apps/electrobun/scripts/dev-runtime` 加载当前 CLI 源码；它所导入的生成 workspace 产物和 Electrobun 资源会在同一次启动中刷新。构建失败时不会生成任何应用进程。

## 考虑过的替代方案

**只依赖 `apps/electrobun` 的 `dev` 脚本构建。** 该命令不会重建 workspace Host 库或 session-controller 客户端组合包，因此仍可能使用过期包产物。

**每次开发启动只编译打包版 Bun 运行时。** 桌面 app bundle 本身也必须重建，因为 `electrobun dev` 会启动已有 app bundle，不会自动复制最新前端或主进程资源。桌面内的 DSH 运行程序仍指向 `apps/electrobun/scripts/dev-runtime`，因此本地启动不会选择编译出的 `build/dsh` 可执行文件。

**只构建 session-controller Client 组合包。** Chat、trajectory 等客户端插件会各自打包共享浏览器依赖。只重建 controller，可能让某个订阅者继续使用同一 helper 的旧副本。

## 后果

每次企业启动都会承担必要的构建时间，并在无法刷新生成产物或已复制的 Host 插件缺少运行时依赖时提前失败。命令不会在仍选用旧库或旧浏览器组合包时宣称栈已运行。重建后的应用包含 `build/dsh`，但 `dev:prepared` 选择的本地 DSH 进程仍使用加载源码的开发辅助程序。
