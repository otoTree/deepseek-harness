# Agent Note: Enterprise start 重建开发产物

Status: implemented

[English](2026-09-16-enterprise-start-builds-runtime.md) | 中文

## 问题

企业启动命令可能在 workspace 库或浏览器组合包过期时启动 API 与桌面进程。Electrobun 的开发命令只重建前端和插件，而桌面运行时会通过生成的 `lib` 文件解析 workspace 包，session-controller 客户端组合包也不会被它重建。因此窗口看似启动成功，实际可能执行上一次构建的代码。

## 决策

`pnpm run enterprise:start` 会在基础设施检查和应用进程启动前执行 `pnpm run enterprise:build`。该构建刷新 Host 库图和全部 Client 组合包；存在 `--desktop` 时，启动还会执行 `pnpm run enterprise:build:desktop` 刷新 Electrobun 前端和插件，然后选择桌面包的 `dev:prepared` 入口，避免再次构建这些产物。开发桌面继续使用 `apps/electrobun/scripts/dev-runtime` 加载当前 CLI 源码；它所导入的生成 workspace 产物现在会在同一次启动中刷新。构建失败时不会生成任何应用进程。

## 考虑过的替代方案

**只依赖 `apps/electrobun` 的 `dev` 脚本构建。** 该命令不会重建 workspace Host 库或 session-controller 客户端组合包，因此仍可能使用过期包产物。

**每次开发启动都编译打包版 Bun 运行时。** 开发运行时有意使用源代码启动器和仓库 profile 图。编译 `build/dsh` 只增加发布专用打包工作，并不会改变开发窗口使用的进程。

**只构建 session-controller Client 组合包。** Chat、trajectory 等客户端插件会各自打包共享浏览器依赖。只重建 controller，可能让某个订阅者继续使用同一 helper 的旧副本。

## 后果

每次企业启动都会承担必要的构建时间，并在无法刷新生成产物时提前失败。命令不再在仍选用旧库或旧浏览器组合包时宣称栈已运行。发布打包仍负责 `build:runtime`；开发启动不会生成或选择该打包二进制。
