# Agent Note: 浏览器文档预览使用浏览器压缩入口

Status: implemented

[English](2026-09-20-browser-document-preview-uses-browser-compression-entry.md) | 中文

## 问题

Workbench 文档解析器运行在浏览器中，但在 Client 打包器下从 `fflate` 包根入口导入时可能选中 Node 入口。该入口会创建 Client 模块表中不存在的 `require("module")` 依赖，导致 Workbench loader 无法初始化。

## 决策

`packages/client/ui-workbench/src/client/panels/document-preview.ts` 从 `fflate/browser` 导入 `strFromU8` 和 `unzipSync`。显式子路径确保文档解压使用浏览器实现，并从生成的 Client bundle 中排除 Node 的 `module` 依赖。

## 考虑过的替代方案

**继续从 `fflate` 包根入口导入。** 不予采用，因为 Host 构建与浏览器模块表的条件导出解析不同；看似有效的源码导入仍可能生成仅适用于 Node 的依赖。

**为 Node 的 `module` API 增加浏览器 shim。** 不予采用，因为文档预览不需要 Node 运行时；shim 会增大浏览器 bundle，并掩盖错误的依赖选择。

**替换为另一套压缩包解析器。** 不予采用，因为现有解析器已经提供所需的有界 ZIP 提取能力，替换库会把修复扩大到打包缺陷之外。

## 后果

Workbench loader 可以在浏览器中初始化，同时保留有界的 DOCX、PPTX 和 XLSX 提取能力。该 Client 解析器不再使用仅适用于 Node 的 `fflate` API，后续浏览器导入必须继续使用显式的 `fflate/browser` 子路径。

## 验证

Workbench 与 files-panel 聚焦测试通过。`pnpm run build:lib:client` 成功完成，重建后的 `packages/client/ui-workbench/lib/client.js` 同时不包含 `require(\"module\")` 和 `createRequire`。
