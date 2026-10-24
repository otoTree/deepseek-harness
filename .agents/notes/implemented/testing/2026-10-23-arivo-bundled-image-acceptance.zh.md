# Agent Note: Arivo 随包图片验收

Status: implemented

[English](2026-10-23-arivo-bundled-image-acceptance.md) | 中文

## Problem

独立创作插件测试可以通过，但桌面包仍可能加载另一份插件清单，或在打开创作窗格时丢失原始 Agent。组合验收必须同时验证已校验发行包和正常 OS 导航。

## Decision

[打包浏览器验收](../../../../apps/web/tests/arivo-startup.e2e.ts)通过原生监督器在一次性数据目录启动完整 Arivo 包。它读取包内清单固定摘要，使用原生凭证助手，并在 Chrome 打开原始 OS 外壳。创作窗格使用正常 rail 和项目控件。语言目录通过普通模型设置选择；fixture 拒绝所有语言生成请求。

测试的私有 loopback fixture 提供明确免费的云端响应。它检查一次图片创建、核对回复丢失、完整替换 Host 后的持久恢复、原核对 UUID 及已解码的本地结果。重启前返回原始 Agent 会保留其草稿。单独的未配置外壳场景验证没有可用模型时输入框保持禁用。

## Alternatives considered

**仅保留独立插件覆盖：**它无法验证包内清单固定摘要、原始 OS 组合或 rail 所有权。它仍适合插件故障测试，但不能代替本测试。

**每次装配检查都重复付费 Provider 调用：**网络和计费波动会掩盖组合故障并增加费用。既有真实 Provider 证据仍须单独保留；此 fixture 不代表真实模型或结算验收。

## Consequences

回归检查装配产品，不替换已安装应用，也不修改企业配置。它需要匹配的本地 macOS 包、Chrome 及可用原生凭证。无头浏览器证据不能证明原生窗口、安装器、Windows、公证或最终发布验收通过。
