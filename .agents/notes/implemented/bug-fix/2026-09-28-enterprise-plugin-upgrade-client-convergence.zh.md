# Agent Note: 企业插件升级收敛浏览器 Client 目标

Status: implemented

[English](2026-09-28-enterprise-plugin-upgrade-client-convergence.md) | 中文

## 问题

启用中的插件升级会撤销旧激活并切换安装版本，但浏览器 Client runtime 只在连接代次变化时重新收敛。Host 可能已经完成新版本加载，而浏览器仍保留旧的 Client 贡献，使设备目标停留在 `preparing`，市场卡片也一直显示变更中。

## 决定

企业 Client 的升级操作会等待控制面的升级请求完成，然后调用浏览器 Client runtime reconciler。企业 RPC 的升级端点仍负责 Host 侧收敛。浏览器 reconciler 会卸载旧激活、加载新的 Client 目标，并在升级操作返回市场界面前报告 active 或 failed heartbeat。

## 考虑过的替代方案

**依赖下一次连接代次事件。** 不采用，因为版本切换不要求新的连接代次，旧的浏览器贡献可能会无限期保留。

**只刷新插件市场数据。** 不采用，因为目录和安装记录读取不会卸载或挂载 Client 贡献，也无法更新设备 heartbeat。

**增加专用的升级浏览器加载路径。** 不采用，因为这会重复 Client runtime 已经负责的目标替换、清理、激活截止时间和 heartbeat 处理。

## 影响

从插件市场执行升级时，Host 和浏览器 Client 目标会在界面报告完成前收敛。Client 加载失败通过现有 heartbeat 路径记录，并继续显示为激活错误。市场界面仍以服务端 observed state 为准，不会在浏览器目标尚未挂载时宣称升级成功。

## 测试

企业 Client 测试验证升级请求之后会调用 `plugin-runtime-targets` 收敛。Client runtime 测试覆盖版本替换、清理和 active heartbeat 行为；企业包类型检查通过。
