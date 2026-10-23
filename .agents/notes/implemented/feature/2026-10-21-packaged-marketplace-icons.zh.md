# Agent Note: 随插件版本打包市场图标

Status: implemented

[English](2026-10-21-packaged-marketplace-icons.md) | 中文

## 问题

插件目录在安装插件之前就需要版本自有的图标。运行时 slot 图标不能提供这项信息，远程图片请求则会向外部服务商暴露目录浏览行为，并在离线时失败。

## 决定

可选的 manifest `icon` 包含有界 PNG data URL。[协议 schema](../../../../packages/plugin/protocol/src/index.ts) 校验编码、PNG 文件头、尺寸和结束块。[ZIP 解析器](../../../../apps/api/src/plugin-package.ts)与[目录读取器](../../../../packages/client/ui-enterprise/src/wire.ts)复用此字段定义。清单完整性校验覆盖图片，[组织目录](../../../../apps/api/src/plugins.ts)只随可见版本返回图标。

市场在可见插件名称旁展示图片。缺少图标或无法解码时使用名称前两个字符，图片变化时重置失败状态。图标属于装饰，不增加重复的无障碍名称。[侧栏元数据决定](2026-10-04-rail-plugin-icons-and-labels.zh.md)独立负责已挂载 slot 贡献的可执行图标，不被本决定替代。

## 考虑过的替代方案

**浏览时请求服务商图标。** 可用性和隐私依赖外部图片服务器。

**通过另一个认证端点提供 ZIP 资源。** 这需要为原生 Host 凭据增加图片认证或代理路径。有界内嵌图片可直接使用现有目录及其响应上限。

## 影响

公开版本添加或替换图标时需要新版本号。没有图片的已有版本仍然可读。PNG 排除可执行 SVG 标记，字节和尺寸上限限制目录增长和图片大小。浏览器解码仍决定图片能否展示；无效像素数据使用名称回退。图标不进入模型请求或 Session 事件。

## 验证

协议和 ZIP 测试覆盖有效 PNG、字段缺省、不支持的格式、无效文件头和尺寸上限。API 身份测试上传 ZIP，再通过授权目录读取相同图片。客户端测试覆盖图片缺省和解码失败。[录制 Session 浏览器用例](../../../../apps/web/tests/plugin-market-icons.e2e.ts)使用经过校验的包元数据，通过 Loader 加载构建后的 Client，验证图片解码且没有外部请求，刷新变更后的图片，并固定[可见结果](../../../../snapshots/web/plugin-market-icons/icons.expected.md)。
