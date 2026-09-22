# Agent Note: 内置离线 Office 编辑

Status: implemented

[English](2026-09-22-built-in-office-editing.md) | 中文

## 问题

Workbench 必须在不使用网络服务或运行时下载的情况下预览、编辑并保存 OOXML 文件。把文档压平成纯文本的解析器会丢失工作表绘图、幻灯片布局、媒体和未知 XML，而整体重导出可能删除用户从未编辑的不支持内容。

## 决策

`@deepseek-ai/dsh-client-ui-workbench` 把 Office 实现作为内部 Client 能力拥有。它随普通 Web 与 Electrobun bundle 发布，不进入企业插件生命周期。浏览器解析器使用有界 ZIP 解压、浏览器安全 XML 解析、ExcelJS 工作簿元数据和 React renderer，不依赖 CDN 或在线渲染服务。

XLSX renderer 加载全部工作表，并保留工作簿顺序、名称、尺寸、合并、冻结窗格、格式化值、基础样式、图片和绘图锚点。当 ExcelJS 拒绝某个生产者特有的扩展时，renderer 回退到有界的工作表 XML 直接解析，使有效工作簿仍能显示网格而不会丢弃原始 part。常见图表类型获得离线 SVG 预览，未知图表类型以明确的保留占位显示。公式单元格显示缓存结果并保持只读，因为 Client 不计算公式。

DOCX 展示正文段落、表格和关联图片。PPTX 使用幻灯片尺寸与绘图 transform 定位文本框、图片和常见形状样式；幻灯片文本可编辑。renderer 不执行宏、脚本、外部链接或嵌入对象。

保存从原始压缩包开始，只重写编辑所指向的工作表或文档文本 XML。未修改的 XML、关系、媒体、绘图、图表、布局和未知 entry 会保留。Workbench Controller 接受规范且有界的 DOCX、PPTX 和 XLSX 替换，并通过带现有 expected-version 校验的 `writeBytes` 提交，因此错误或冲突不会发布部分结果。

实现以用户拥有的 [AgentOS Office 源码](https://github.com/otoTree/AgentOS)作为设计参考，重点研究其 Excel schema、Konva renderer 组织方式及 Word/PPT parser。Workbench 保留自己的压缩包增量 adapter，因为 AgentOS 的单工作表转换和整体文档导出不能满足多工作表与未知 OOXML 保留规则。AgentOS 不作为 package vendoring，也不是运行时依赖。

## 考虑过的替代方案

**使用在线 Office 服务或从 CDN 加载编辑器。** 该方案无法离线运行，引入外部数据处理，并使 Electrobun 启动依赖网络可用性。

**原样 vendor AgentOS Office package。** 它的编辑器是有价值的实现参考，但其单工作表模型与整体文档导出路径可能丢弃不支持的工作簿 part 和关系。

**委托本地安装的 Microsoft Office 或 LibreOffice 进程编辑。** 该方案不能为 Web 与桌面端提供同一套实现，并增加安装与进程控制依赖。

## 后果

同一套 TypeScript 实现可用于普通浏览器与打包桌面 Client，且不支持的 OOXML 能在受支持编辑后继续存在。首期有意限制对象编辑：XLSX 绘图与图表是可展示的只读对象，公式不会重新计算，DOCX 不复刻完整 Word 分页引擎，PPTX 不提供任意形状操作。聚焦的 Client 与 Host 测试固定多工作表保存、公式保留、图片和绘图关系保留、PPTX 定位媒体，以及 PPTX 带版本保护的二进制写回行为。
