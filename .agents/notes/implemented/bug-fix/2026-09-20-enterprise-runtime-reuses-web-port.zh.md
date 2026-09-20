# Agent Note: 企业 Runtime 复用 Web 端口

Status: implemented

[English](2026-09-20-enterprise-runtime-reuses-web-port.md) | 中文

## 问题

企业桌面 Runtime 每次启动都会使用 `--port 0` 选择操作系统端口。Runtime 重启后仍存在的浏览器文档会继续请求旧的 loopback 地址，因此即使当前插件 bundle 正常，Client module loader 也只会报告笼统的 bundle 加载失败。

## 决策

组织 Runtime 会在组织 home 中保存上一次成功使用的 Web 端口，并在启动前探测该端口。可用的已记录端口会传给 DSH 进程；被占用或无效的值会回退到操作系统分配的端口。Runtime 在向桌面会话公开 Web URL 前记录新报告的端口。浏览器 loader 还会在 bundle 请求失败后使用 `HEAD` 探测，并报告 HTTP、网络或浏览器拒绝执行的具体原因。

## 考虑过的替代方案

**继续在每次启动时选择随机端口。** 这样浏览器文档在重启后仍绑定到无法恢复的旧 loopback 地址。

**使用整个仓库共用的固定端口。** 全局端口会与个人 Web 进程和并行的组织 Runtime 冲突；组织 home 已经提供了正确的所有权范围。

**只修改笼统的浏览器错误文本。** 更好的诊断可以识别失败原因，但不能让旧文档重新连接到相同的 loopback 地址。

## 后果

同一组织重复启动时通常会保留浏览器地址及其按 authority 绑定的 Cookie。发生端口冲突时 Runtime 仍然安全地回退到新端口，并把新 URL 提供给桌面宿主。记录文件只包含端口号，并受现有组织锁和 home 权限保护。

## 验证

Runtime 生命周期测试覆盖首次随机端口，以及干净重启后复用已报告端口。Client module loader 测试继续覆盖脚本清理和加载失败。Electrobun 与 Client module TypeScript 工程均已通过类型检查。
