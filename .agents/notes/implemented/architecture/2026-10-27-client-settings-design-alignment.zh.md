# Agent Note: 保留的桌面设计由共享功能所有者实现

Status: implemented

[English](2026-10-27-client-settings-design-alignment.md) | 中文

## 问题

桌面设置、插件浏览与账户入口需要采用保留产品设计的层级，同时保留原生认证、持久化偏好与插件生命周期归属。把参考示例复制进运行数据会错误描述可用能力。

## 决策

[保留的 Figma 设计](https://www.figma.com/design/PNrSdRjstOIGuE720lfv14?node-id=34-10)指导设置、企业管理、插件市场、云盘、触发器与账户入口。对话与 Workbench 设计不在本次实现范围内。

[设置外壳](../../../../packages/client/ui-settings-general/README.zh.md)拥有可搜索的分类导航、面包屑与通用卡片分组。搜索筛选本地化贡献标签，同时保留当前分类。[主题插件](../../../../packages/client/ui-theme/README.zh.md)拥有外观预览与语义表面角色。[企业功能](../../../../packages/client/ui-enterprise/README.zh.md)拥有市场导航与卡片、云盘导航和触发器表格。市场插图的原始导出随 Client 打包，渲染不依赖 Figma 可用性。

Arivo 通过[产品适配器](2026-10-26-product-plugin-market.zh.md)复用这些注册的市场与触发器组件；产品能力继续控制发布范围与云端来源。[共享外观决策](2026-10-24-arivo-shared-appearance.zh.md)拥有发行版色板覆盖。[Admin 画布决策](2026-09-30-enterprise-admin-reference-alignment.zh.md)独立拥有 Admin 明度与密度。

## 考虑过的替代方案

**将参考页面复制为独立应用。** 第二套应用会把设计验收与桌面实际使用的认证、设置和安装流程分开。

**用参考示例填充插件市场。** 示例卡片不能证明插件已发布、已授权或可安装；运行时卡片由真实目录生成。

## 影响

功能插槽、原生账户传输和既有修改处理器保留各自归属。窄窗口导航保持可达；密集触发器表格在自身内容区域滚动。本地化字典拥有可见与可访问文案。浏览器回归在既有持久化与生命周期用例之外，覆盖不切换分类的搜索、上传入口、表单可达性与页面溢出。打包平台验证与浏览器验收分别执行。
