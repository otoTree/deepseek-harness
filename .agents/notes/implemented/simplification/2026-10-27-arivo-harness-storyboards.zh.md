# Agent Note: Harness owns storyboard prompt authoring

Status: implemented

[English](2026-10-27-arivo-harness-storyboards.md) | 中文

## Problem

独立分镜生成器要求用户准备已保存剧本、另选模型并管理另一份制作记录，而对话已经负责创作任务。这重复了编排职责，也阻碍直接写入镜头。

## Decision

原 Harness 对话通过既有[创作工具](../../../../apps/electrobun/src/distribution/arivo-shell/host/studio-tools.ts)写入完整镜头提示词。创作插件允许首次未绑定镜头在同一事务关联不可变空剧本。模型读取分镜修订，顺序写入镜头，并使用每次返回的修订继续写入；冲突后重读，不覆盖用户的新修改。显式来源绑定保持可选。

独立发布的创作插件负责持久化、UUID 回执、固定素材及界面观察。分镜编辑器提供直接创建与人工编辑；独立单集/多集生成的新建操作退役。原 Harness 的模型准入、工具策略、日志和计费继续保持权威。

## Alternatives considered

保留生成器并增加对话快捷入口仍会留下两个编排所有者。让模型分多次工具调用创建空剧本会产生部分准备状态，并增加不必要的版本命令。在创作插件新增 Agent 循环会重复现有取消、工具及会话行为。

## Consequences

每个成功写入的镜头立即持久化，并可独立编辑。已有剧本草稿和保存正文保留；固定来源及素材身份不变。模型可见的工具说明定义空来源初始化、顺序修订和连续性。写入镜头不会引入自动付费重试、媒体生成或新的云端命令。历史本地制作数据仍由原恢复协议读取。

## Testing

创作插件的发布版 Worker 测试覆盖连续原生写入、空来源初始化、无效素材回滚、重放、旧修订拒绝和重开。打包 profile 浏览器验收覆盖生成控件移除、直接创建、Agent 写入观察、脏输入保护和 Host 重启。[注册器测试](../../../../apps/electrobun/tests/arivo-studio-tools.test.ts)保持 Session 命令身份、文件夹权限和 effect 清理。[原生 Agent 录制会话场景](../../../../snapshots/session/arivo-native-agent/snapshot.yml)固定模型可见工具说明，不产生付费调用。这些检查不代表原生窗口或真实 Provider 验收。
