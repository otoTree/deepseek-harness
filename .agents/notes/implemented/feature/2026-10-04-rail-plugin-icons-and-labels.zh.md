# Agent Note: Rail 插件图标与标签元数据

Status: implemented

[English](2026-10-04-rail-plugin-icons-and-labels.md) | 中文

## Problem

Rail slot 条目在侧栏收起时需要稳定的图标与标签展示。独立插件目前自行渲染内容而收不到注册元数据，因此只输出文字的贡献会溢出 56px rail，也无法使用宿主统一的 tooltip 约定。

## Decision

list 注册项在已有 `label` 旁支持可选的 `icon` renderer。React slot 渲染器把当前条目的 id、解析后的 label 与 icon 作为 `slotEntry` 元数据提供给组件。侧栏 rail 通过 owner props 提供默认插件图标，每个贡献可以选择使用默认图标或注册的图标。Rail 操作在收起栏中只显示图标，并通过 hover/focus tooltip 或原生 title 与无障碍名称提供本地化标签。

## Alternatives considered

**在渲染器中包裹所有 rail 贡献：** 放弃，因为渲染器不拥有任意贡献组件的视觉约定，无法安全包裹未知的按钮或菜单结构。

**要求所有插件导入共享 Rail 按钮组件：** 放弃，因为独立插件会依赖某个功能包，并失去对自身操作行为的控制。

## Consequences

slot registry 携带一个小型 React icon 函数类型，渲染器向注册组件增加一个可选元数据 prop。现有组件保持源码兼容，因为元数据 prop 是可选的。Rail 贡献作者需要消费 `slotEntry` 才能使用宿主提供的标签或图标；默认图标与紧凑 rail 几何仍由外壳负责。
