# Agent Note: 私有应用发布

Status: implemented

[English](2026-10-18-private-application-publication.md) | 中文

## Problem

企业服务、管理端、桌面端和沙箱应用通过容器或桌面分发渠道交付。将每个 `apps/*` 目录都视为 npm 发布成员，会要求这些已有独立部署职责的应用提供 npm 发布元数据和载荷。

## Decision

dsh npm 家族包含 `apps/cli`、`apps/web` 和非实验性 harness 包。其他应用保持私有。所有私有应用和包共享根版本，参与版本更新但不生成发布标签。Workspace 约束拒绝 npm 发布集以外的非私有应用。

这一决策收窄了[发布序列决策](2026-08-10-npm-release-sequences.zh.md)中的应用成员范围；原决策继续负责独立家族、标签和发布顺序。

## Alternatives considered

发布所有应用会引入不受支持的 npm 启动路径，并重复现有部署职责。将私有应用排除在版本更新之外，会导致 workspace 版本一致性门禁拒绝下一次发布。

## Consequences

新增 npm 应用必须显式修改发布家族和载荷策略。包清单公开构建后的声明，打包载荷必须包含每个导出的运行时文件。容器和桌面发布继续使用各自的交付流程。
