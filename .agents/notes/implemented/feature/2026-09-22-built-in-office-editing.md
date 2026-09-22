# Agent Note: Built-in offline Office editing

Status: implemented

English | [中文](2026-09-22-built-in-office-editing.zh.md)

## Problem

The Workbench must preview, edit, and save OOXML files without a network service or a runtime download. A parser that flattens documents to text loses worksheet drawings, slide layout, media, and unknown XML, while whole-document export can delete unsupported content that the user never edited.

## Decision

`@deepseek-ai/dsh-client-ui-workbench` owns the Office implementation as an internal Client capability. It ships in the normal Web and Electrobun bundles rather than through the enterprise plugin lifecycle. The browser parser uses bounded ZIP extraction, browser-safe XML parsing, ExcelJS workbook metadata, and React renderers with no CDN or online rendering dependency.

The XLSX renderer loads every worksheet and preserves workbook order, names, dimensions, merges, frozen panes, formatted values, basic styles, images, and drawing anchors. It falls back to direct bounded worksheet XML parsing when ExcelJS rejects a producer-specific extension, so a valid workbook can still show its grid without dropping the original parts. Common chart types receive an offline SVG preview, and an unknown chart type remains visible as a preserved placeholder. Formula cells display their cached values and remain read-only because this Client does not calculate formulas.

DOCX exposes body paragraphs, tables, and related images. PPTX uses slide extents and drawing transforms to position text boxes, images, and common shape styling; slide text is editable. The renderers do not execute macros, scripts, external links, or embedded objects.

Saving starts from the original archive and rewrites only worksheet or document text XML addressed by an edit. Untouched XML, relationships, media, drawings, charts, layouts, and unknown entries remain present. The Workbench Controller accepts canonical bounded DOCX, PPTX, and XLSX replacements and commits them through `writeBytes` with the existing expected-version check, so an error or conflict cannot publish a partial result.

The implementation uses the user-owned [AgentOS Office source](https://github.com/otoTree/AgentOS) as a design reference, especially its Excel schema, Konva renderer organization, and Word/PPT parsers. The Workbench keeps its own archive-preserving adapter because AgentOS's single-sheet conversion and whole-document exporters do not satisfy the multi-sheet and unknown-OOXML retention rules. AgentOS is not vendored as a package and is not a runtime dependency.

## Alternatives considered

**Use an online Office service or CDN-loaded editor.** This loses offline operation, introduces external data handling, and makes Electrobun startup depend on network availability.

**Vendor the AgentOS Office package unchanged.** Its editor is a useful implementation reference, but its single-sheet model and whole-document export path can discard unsupported workbook parts and relationships.

**Delegate editing to a locally installed Microsoft Office or LibreOffice process.** That cannot provide one consistent Web and desktop implementation and adds an installation and process-control dependency.

## Consequences

The same TypeScript implementation works in ordinary browsers and in the packaged desktop Client, and unsupported OOXML survives supported edits. The first release deliberately limits object editing: XLSX drawings and charts are selectable presentation objects, formulas are not recalculated, DOCX does not reproduce the full Word pagination engine, and PPTX does not expose arbitrary shape manipulation. Focused Client and Host tests pin multi-sheet save behavior, formula retention, image and drawing relationship retention, positioned PPTX media, and PPTX version-checked binary writes.
