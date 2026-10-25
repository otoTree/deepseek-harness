# Agent Note: Arivo Web 与桌面共享外观

Status: implemented

[English](2026-10-24-arivo-shared-appearance.md) | 中文

## 问题

桌面外壳使用独立配色时，即使创作页面共享组件，也会与 Arivo Web 脱离。线上字体也需要离线可用，同时不改变企业依赖。

## 决策

[Arivo 构建器](../../../../apps/electrobun/scripts/build-arivo.ts) 消费已验证创作发行包的 `theme.css`，其中包含版本化公开 Web 色板、光效与 OFL 字体。生成的 esbuild 注入模块向启动 Client 提供样式表和既有品牌标识；不解析跨仓库源码或新的工作区依赖。[启动适配器](../../../../apps/electrobun/src/distribution/arivo-shell/client/theme.ts) 将 OS 语义角色映射为共享变量，其生命周期拥有样式表和 body 标记。OS 持久化的明暗偏好选择共享色板，不改变其他产品的主题。

[顶栏槽位](../../../../apps/electrobun/src/distribution/arivo-shell/client/topbar.ts) 保留原运行时的 Session 内容、侧栏和工作台操作，并使用 Arivo 品牌。既有 Agent、rail 贡献及插件市场职责保持完整。本地与云端差异体现在能力和本地化说明；资产和项目的作用域控件保留 Web 配色。

Arivo 将布局可选的 `--dsh-layout-column-transition` 设为 `none`。macOS 原生捕捉在网格列过渡期间可能不显示 Workbench，即使计算后几何正确。列宽立即生效后，无需轮询强制布局即可取得创作面板可见截图；间歇性原生缺绘仍需单独排查。没有发行覆写时，共享外壳保留既有过渡。

## 考虑过的替代方案

**维护桌面色板。** 即使初始匹配 Web，独立字面值也会逐渐偏离。

**导入 Web 仓库或运行时下载字体。** 源码导入破坏发行隔离；联网字体破坏离线外观。

## 后果

只有显式 Arivo 构建需要创作主题产物。企业桌面、Admin 和 API 继续使用原构建入口和依赖。[启动产品回归](../../../../apps/web/tests/arivo-startup.e2e.ts) 检查 OS/iframe 的计算后色彩、字体、偏好传递及原有会话与控件。打包窗口仍需原生截图验收；浏览器测试不能替代 Windows、安装器、更新及最终产品验收。
