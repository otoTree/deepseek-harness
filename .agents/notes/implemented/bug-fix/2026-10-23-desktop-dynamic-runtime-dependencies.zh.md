# Agent Note: 桌面动态插件依赖闭包

Status: implemented

[English](2026-10-23-desktop-dynamic-runtime-dependencies.md) | 中文

## 问题

原生桌面加载的 Host 插件超出 CLI 静态依赖闭包。开发包可以成功构建可执行文件，却遗漏插件 peer，随后在隔离导入验证中因缺少 session-persistence 包而失败。

## 决策

[运行时构建器](../../../../apps/electrobun/scripts/build-runtime.ts) 为开发包和安装包共同选择桌面已发布依赖及其工作区 peer。它将所选包实体化到运行时树，并在部署后清理临时部署 hook。API 服务端仍不进入桌面运行时依赖选择。

此决策补充[安装包保护决策](../architecture/2026-10-19-local-desktop-installer-protection.zh.md)；其保护、原生启动器和官方 Node 发行版选择继续有效。

## 考虑过的替代方案

**只加入缺失的 session-persistence 包。** 这只处理一个缺失 peer，其他动态加载的 Host 插件仍可能发生相同问题。

**跳过隔离导入验证。** 构建成功会掩盖应用无法加载随包插件组合的事实。

## 后果

开发暂存包含与安装包相同的已发布 Host 依赖闭包。现有[构建验证器](../../../../apps/electrobun/scripts/verify-build.ts) 在检出目录外用原生 Node 导入复制出的企业 Host 入口，拒绝缺失或逃逸依赖。已复现开发构建在选择变更前失败、变更后通过；Windows 原生验收仍是独立要求。
