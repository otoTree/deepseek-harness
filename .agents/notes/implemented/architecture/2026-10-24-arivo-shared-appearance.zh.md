# Agent Note: Arivo Web 与桌面共享外观

Status: implemented

[English](2026-10-24-arivo-shared-appearance.md) | 中文

## 问题

桌面外壳使用独立配色时，即使创作页面共享组件，也会与 Arivo Web 脱离。线上字体也需要离线可用，同时不改变企业依赖。

## 决策

[Arivo 构建器](../../../../apps/electrobun/scripts/build-arivo.ts) 消费已验证创作发行包的 `theme.css`，其中包含版本化公开 Web 色板、光效与 OFL 字体。生成的 esbuild 注入模块向启动 Client 提供样式表和既有品牌标识；不解析跨仓库源码或新的工作区依赖。[启动适配器](../../../../apps/electrobun/src/distribution/arivo-shell/client/theme.ts) 将 OS 语义角色映射为共享变量，其生命周期拥有样式表和 body 标记。OS 持久化的明暗偏好选择共享色板，不改变其他产品的主题。

[顶栏槽位](../../../../apps/electrobun/src/distribution/arivo-shell/client/topbar.ts) 保留原运行时的 Session 内容、侧栏和工作台操作，并使用 Arivo 品牌。既有 Agent、rail 贡献及插件市场职责保持完整。本地与云端差异体现在能力和本地化说明；资产和项目的作用域控件保留 Web 配色。

公开 `controls.css` 提取当前 Web 个人资料页的中性按钮、小圆角和输入框。原生发行包将这些令牌提供给 OS 基础控件与嵌入账号/项目表单。模型设置使用 DOM 列表框，支持视口定位、Escape、方向键和焦点恢复；目录授权与默认模型持久化继续由既有服务拥有。打包启动验收覆盖深浅色和模型菜单。

Arivo 将布局可选的 `--dsh-layout-column-transition` 设为 `none`。macOS 原生捕捉在网格列过渡期间可能不显示 Workbench，即使计算后几何正确。列宽立即生效后，无需轮询强制布局即可取得创作面板可见截图；间歇性原生缺绘仍需单独排查。没有发行覆写时，共享外壳保留既有过渡。

Arivo 只在外层文档绘制一次环境光。可选的 `--dsh-shell-surface` 填充使固定框架、导航栏、会话侧栏和对话区透明；嵌入创作文档的根元素同样透明且不再绘制自己的光晕。抽屉和 Workbench 覆盖层保留不透明底色，浮起控件仍使用各自的语义填充。这样可避免独立定位的背景在列边界形成硬切，同时防止重叠内容透出。

[共享桌面对话区决策](2026-10-26-shared-desktop-conversation.zh.md) 在共享主题中拥有紧凑 Workbench 与输入框展示。Arivo 通过既有语义别名提供色板；浏览器与文件命令、Session 绑定及编辑器离页检查保留原有归属。

## 考虑过的替代方案

**维护桌面色板。** 即使初始匹配 Web，独立字面值也会逐渐偏离。

**导入 Web 仓库或运行时下载字体。** 源码导入破坏发行隔离；联网字体破坏离线外观。

## 后果

只有显式 Arivo 构建需要创作主题产物。企业桌面、Admin 和 API 继续使用原构建入口和依赖。[启动产品回归](../../../../apps/web/tests/arivo-startup.e2e.ts) 检查 OS/iframe 的计算后色彩、字体、偏好传递及原有会话与控件。打包窗口仍需原生截图验收；浏览器测试不能替代 Windows、安装器、更新及最终产品验收。
