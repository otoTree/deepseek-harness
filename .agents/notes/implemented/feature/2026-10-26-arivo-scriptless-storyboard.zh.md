# Agent Note：无剧本分镜工作区

Status: implemented

[English](2026-10-26-arivo-scriptless-storyboard.md) | 中文

## Problem

手动创建镜头前要求先保存剧本，会阻碍从画面开始构思。狭窄 Workbench 内的分集管理也会占用编辑空间。

## Decision

[启动外壳](../../../../apps/electrobun/src/distribution/arivo-shell/client/index.ts)把剧本和分镜面板接入已有[分集侧栏贡献](../../../../apps/electrobun/src/distribution/arivo-shell/client/story-rail.ts)。插件发布明确的编辑器类型。侧栏转发分集新建、选择、改名、删除及分镜来源绑定意图，弹窗、保存准入与持久化仍由原编辑器负责。frame、来源、项目与绑定身份校验保持必需；替换面板会移除其贡献。

独立构建的创作插件在同一 SQLite 事务中创建分集、空剧本版本和分镜来源，外层命令可原样重放。向未绑定分集添加第一个手动镜头时，镜头事务同时冻结当前草稿并创建来源。既有来源和镜头快照保持固定，只有用户明确重绑才改变后续镜头的来源。Harness 仅消费构建后的 release。

## Alternatives considered

允许镜头来源为空会让制作与备份维护第二套来源模型。由渲染层顺序请求可能在局部失败后留下没有可用分镜的分集。本地原子事务保留原有固定版本模型，也允许先画分镜后写剧本。

## Consequences

两个编辑器使用同一分集身份与标题。删除隐藏分集，同时保留历史剧本和制作引用。未知写入回复保留原命令并阻止离页。未保存的镜头修改会禁用侧栏操作。本片不增加付费执行、自动云端请求或数据库 schema 变更。

## Testing

[打包产品回放](../../../../apps/web/tests/arivo-workbench-direct.e2e.ts)使用已有对话记录，检查无剧本新建、丢回复重试、手动镜头、脏编辑准入、侧栏管理、剧本身份、面板替换与空态。插件 Worker 测试覆盖原子回滚、CAS、不可变版本、文件夹路由和备份恢复。原生窗口、付费 Provider 和发布验收仍与浏览器 fixture 分别记录。
