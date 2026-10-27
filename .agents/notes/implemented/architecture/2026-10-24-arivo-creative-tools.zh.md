# Agent Note：原 Harness 中的 Arivo 创作工具

Status: implemented

[English](2026-10-24-arivo-creative-tools.md) | 中文

## 问题

Arivo 对话需要编辑创作工作区中的同一本地剧本与分镜。独立 Agent 运行时或直接数据库访问会绕过 OS 工具策略与本地修订检查。

## 决策

[启动工具适配器](../../../../apps/electrobun/src/distribution/arivo-shell/host/studio-tools.ts)在原 Harness 注册创作工具。验证后的插件提供原生 v1 句柄，调用限定账号的 Worker 用例。Session 与工具调用身份派生稳定命令 UUID；Worker 负责持久回放与 CAS。每个工具释放捕获账号的句柄。错误只暴露有界代码，不返回本地诊断。正文分页读取，输出限制字节数。[画布工具](../../../../apps/electrobun/src/distribution/arivo-shell/host/canvas-tools.ts)通过同一 Worker 回执与可撤销历史读取固定修订页、编辑标题、提示词和连接；它们不能提交生成结果或启动付费媒体任务。

[Client 适配器](../../../../apps/electrobun/src/distribution/arivo-shell/client/index.ts)贡献普通可关闭 Workbench 面板，并保留 rail、对话、Skills/MCP、预设及市场。两个创作面板读取同一项目存储。Arivo 主题将对话操作映射到已发布中性色板。共享上下文计量支持可选工具颜色变量，保留企业原默认值。

## 考虑过的替代方案

第二套 Agent 循环重复历史、取消与权限。浏览器数据库访问绕过原生账号选择。客户端 Provider Key 绕过 Arivo 身份与计费。因此采用既有云端语言适配器执行模型。

## 影响

创作工具修改本地内容，不派发模型或收取积分；对话模型继续通过 Arivo 云端鉴权计费。本地 ID 不替代云端计费 ID。编辑镜头保留固定素材引用，除非原有 Host 用例显式修改。市场服务适配和完整原生登录仍有独立验收要求。

## 测试

[注册器测试](../../../../apps/electrobun/tests/arivo-studio-tools.test.ts)覆盖稳定命令、匿名拒绝、安全错误与释放。独立插件验证真实 Worker 持久化、CAS、账号屏障和重开。[会话回放](../../../../snapshots/session/arivo-native-agent/snapshot.yml)固定创作工具模型 schema，并保留原文件副作用任务。[产品验收](../../../../apps/web/tests/arivo-studio-acceptance.ts)通过 Workbench 和完整 Host 重启后读取 Agent 创建的剧本与镜头；真实 Provider 测试必须显式启用，只使用隔离测试账号计费。浏览器证据不代表原生窗口验收通过。
