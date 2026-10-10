# 企业设置页面验证

本次改动仅重组 ui-enterprise 设置页面；原有工作区改动保留。组件预览使用实际 React 组件及主题样式、测试示例数据和临时导航容器，不代表原生桌面认证验收。

## 通过

- `pnpm --filter @deepseek-ai/dsh-enterprise-client test:client`：2 个文件，28 项通过。
- `pnpm exec vitest run packages/client/ui-enterprise/tests/client.spec.tsx`：22 项通过，包含内容归属、空模型、默认模型选择、设备撤销确认、钱包兑换、插件市场跳转。
- `pnpm --filter @deepseek-ai/dsh-enterprise-client typecheck`。
- `pnpm --filter @deepseek-ai/dsh-enterprise-client build`。
- `pnpm run verify-translation-pairing packages/client/ui-enterprise/README.md .agents/notes/implemented/feature/2026-09-18-team-cny-wallet.md .agents/notes/implemented/simplification/2026-10-09-enterprise-settings-task-ownership.md`：3 对一致。
- 本次修改文件的 `git diff --check`。
- Playwright 组件预览：桌面尺寸切换四个设置页，并检查 600px 窄窗口账户布局。

## 未通过的仓库检查

- `pnpm run test:gui`：首次运行 11 个文件失败、290 个通过。企业设置标签与快照问题随后修复，根配置下对应的 22 项测试已通过；未重新运行其他模块。其余失败涉及会话、模块加载、布局、模型选择、主题、工作区。
- `DSH_SNAPSHOT=replay pnpm run test:web`：79 个文件失败、14 个通过、1 个跳过；多数浏览器用例缺少 chromium_headless_shell-1228，同时存在 built-boot 等装配失败。
- `pnpm run test:docs`：13 项通过、2 项失败，原因是现有的两份 10 月 6 日 Agent Note 缺少 Alternatives considered，以及 9 月 30 日管理员参考说明的双语记录未同步。
- `pnpm run doc-sync`：21 项通过、12 项失败，包含现有生成目录、JSDoc、子系统和路径声明不一致，以及上述文档问题。
- `pnpm run lint`：仓库现有代码存在多处错误；本次新增的测试类型断言错误已修正。
- `pnpm run verify-client-ui-i18n`：7 处未修改区域的硬编码文案，涉及企业云盘/触发器与 Workbench 文档预览。

## 限制

内置浏览器连接不可用；通过 Playwright CLI 检查隔离组件预览。本地桌面服务返回认证要求，因此没有操作已登录的原生桌面客户端，也未执行真实模型调用。页面截图位于同目录的 settings-review-*.png。
