# Agent Note: Arivo 随包产品验收

Status: implemented

[English](2026-10-23-arivo-bundled-image-acceptance.md) | 中文

## Problem

独立创作插件测试可以通过，但桌面包仍可能加载另一份插件清单，或在打开创作窗格时丢失原始 Agent。组合验收必须同时验证已校验发行包和正常 OS 导航。

## Decision

[打包浏览器验收](../../../../apps/web/tests/arivo-startup.e2e.ts)通过原生监督器在一次性数据目录启动完整 Arivo 包。它读取包内清单固定摘要，使用原生凭证助手，并在 Chrome 打开原始 OS 外壳。创作窗格使用正常 rail 和项目控件。语言目录通过普通模型设置选择；fixture 拒绝所有语言生成请求。

测试的私有 loopback fixture 提供明确免费的云端响应。它检查一次图片创建、核对回复丢失、完整替换 Host 后的持久恢复、原核对 UUID 及已解码的本地结果。重启前返回原始 Agent 会保留其草稿。单独的未配置外壳场景验证没有可用模型时输入框保持禁用。

[打包工具恢复](../../../../apps/web/tests/arivo-tool-recovery.e2e.ts)验证原始 Bash 工具及 Session JSONL。本地副作用出现后，它核对 Host 祖先关系与进程组所有权，再向 Host 组和单独分离的工具组发送 SIGKILL。重新打开普通历史项会记录 `TOOL_OUTCOME_UNKNOWN`，不自动重复工具或模型请求。显式续问携带关联的未知结果；文件副作用仍只有一次。辅助标题调用接收独立的纯文本 fixture 响应。该测试不声称仅杀死 Host 就会终止分离的工具进程。

[真实图片产品验收](../../../../apps/web/tests/arivo-images.e2e.ts)按显式开关消费隔离云端编排器提供的私有桌面授权。正常项目、上传、报价、历史、下载及备份控件验证打包 Host。预检不创建付费任务；付费轮次上限为两积分且只提交一次 Provider。受理回复丢失后按原命令恢复，下载失败不重新生成。离线重开和备份恢复后先把结果滚动到可见区域，再检查按需加载的缩略图。OS 和创作 frame 的界面树与原生截图分开记录。

显式 poll-only 重建只接受已完成付费轮次中、配置匹配的私有任务 handle。它不调用 Provider 提交，使用新的隔离本地 Generation 和测试账本，并在回执中明确标记重建。它使用同一远端结果验证剩余产品路径，不把原先中断的验收轮次记为完整端到端通过。

## Alternatives considered

**仅保留独立插件覆盖：**它无法验证包内清单固定摘要、原始 OS 组合或 rail 所有权。它仍适合插件故障测试，但不能代替本测试。

**每次装配检查都重复付费 Provider 调用：**网络和计费波动会掩盖组合故障并增加费用。既有真实 Provider 证据仍须单独保留；此 fixture 不代表真实模型或结算验收。

## Consequences

回归检查装配产品，不替换已安装应用，也不修改企业配置。它需要匹配的本地 macOS 包、Chrome 及可用原生凭证。无头浏览器证据不能证明原生窗口、安装器、Windows、公证或最终发布验收通过。
