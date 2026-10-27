# Agent Note：Arivo 受管触发器

Status: implemented

[English](2026-10-26-arivo-triggers.md) | 中文

## Problem

Arivo 创作者需要在常驻 Rail 使用原桌面触发器控件，同时账号与项目模型保持独立于企业产品。

## Decision

[启动 Host](../../../../apps/electrobun/src/distribution/arivo-shell/host/triggers.ts) 使用原生 supervisor 选择的账号存储挂载原触发器运行时。认证 RPC 捕获原生账号、拒绝云端来源、解析目标项目文件夹，并为新 Session 冻结项目模型。已有 Session 保留原模型及正常 Arivo 模型准入。[共用编辑器](../../../../packages/client/ui-enterprise/src/client/triggers.tsx) 服务两个产品；既有 Client apply 入口接收仅触发器的组合，不安装企业账号页面。Arivo 隐藏云端来源并使用随包 standard Agent 预设。

## Alternatives considered

复制触发器编辑器和调度器会产生竞争所有者。启动企业插件会将其账号及云服务依赖引入 Arivo。[企业触发器决策](2026-09-24-enterprise-triggers.zh.md) 继续有效：本增量仅改变产品组合，并修复启停变更传递的元数据。

## Consequences

规则状态属于账号 Harness home，不进入项目导出。原权限、Session 交付、合批、恢复及计费所有者保持。桌面停止时不执行定时器或唤醒操作系统。运行时发布启停修订前剥离版本和时间戳，使严格的创作输入校验能够接受。

## Testing

原生 RPC 测试覆盖账号过期、项目/模型选择、禁止云端来源、匹配、启停及删除。运行时测试覆盖文件事件、合批、确定性重试及重启后的规则修订。Client 测试保留企业控件并验证仅本地来源的产品表单。打包浏览器证据及更大范围 GUI 失败记录于 Arivo 云端工作区；本决策不关闭原生、Windows、真实 Provider 或发布验收。
