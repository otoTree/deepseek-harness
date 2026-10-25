# Agent Note: 在原 Harness 上组合产品插件市场

Status: implemented

[English](2026-10-26-product-plugin-market.md) | 中文

## 问题

Arivo 需要原有插件市场体验和 Agent 贡献，同时使用独立身份和发布服务。装配企业账号插件会将企业权限引入另一产品。

## 决策

[Host 适配器](../../../../packages/client/ui-enterprise/src/market-host.ts) 接受原生会话供应函数与产品 RPC 路径。会话捕获账号归属并拥有取消和凭证。适配器复用原 Cordis 运行时、安装器及清理；运行时的可选传输保持企业默认行为。一个异步释放结果共同拥有账号取消与退出清理。

[Client 适配器](../../../../packages/client/ui-enterprise/src/client/market.tsx) 通过 Rail 和 main.surface 注册原市场。产品文案与发布范围由产品显式声明。展示投影保留已撤销安装的卸载入口；不可用版本不进入执行目录。Arivo 构建器注册正常构建的市场模块工厂，不增加企业启动行，保留原依赖表与样式流水线。

[归档校验器](../../../../packages/plugin/protocol/src/archive.ts) 是公开库入口。[导出脚本](../../../../scripts/export-plugin-verifier.ts) 生成含源摘要的版本化外部产物；发布者信任与权限由产品拥有。核心创作启动独立随包，不依赖市场租约。

## 考虑过的替代方案

复制安装器与市场 UI 会重复生命周期归属。企业启动行还会激活企业账号与模型消费者。直接源码别名会绕过正常 Client 模块表和样式归属。

## 影响

[Host 适配回归](../../../../packages/client/ui-enterprise/tests/market-host.test.ts) 固定原 Client 槽位回报接口及单次释放。[Client 回归](../../../../packages/client/ui-enterprise/tests/client-runtime.spec.tsx) 验证构建工厂和撤销展示投影。原运行时测试保留真实 Harness Tool/Skill/MCP 覆盖。macOS 原生验收使用已认证的本地 Arivo Admin 与桌面，真实 ZIP 提供 Tool、Skill 和可见 Workbench 面板；Core 保存截图与服务证据。Windows、正式发布者签名信任和完整企业发布矩阵仍是独立门禁。Arivo 在上传时拒绝未实现的云端 SDK 能力，不宣称兼容完整企业服务。
