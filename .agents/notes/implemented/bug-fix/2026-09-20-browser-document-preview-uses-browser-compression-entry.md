# Agent Note: Browser document preview uses the browser compression entry

Status: implemented

English | [中文](2026-09-20-browser-document-preview-uses-browser-compression-entry.zh.md)

## Problem

The Workbench document parser runs in the browser, but importing the package root of `fflate` under the Client bundler can select its Node entry. That entry creates a `require("module")` dependency which is absent from the Client module table and prevents the Workbench loader from initializing.

## Decision

`packages/client/ui-workbench/src/client/panels/document-preview.ts` imports `strFromU8` and `unzipSync` from `fflate/browser`. The explicit subpath keeps document decompression in the browser implementation and excludes Node's `module` dependency from the generated Client bundle.

## Alternatives considered

**Keep importing the `fflate` package root.** Rejected because conditional export resolution differs between the host build and the browser module table, so a valid source import can still emit a Node-only dependency.

**Add a browser shim for Node's `module` API.** Rejected because document preview has no Node runtime requirement; a shim would increase the browser bundle and conceal an incorrect dependency selection.

**Replace `fflate` with a second archive parser.** Rejected because the existing parser already provides the required bounded ZIP extraction and changing libraries would expand the fix beyond the bundling defect.

## Consequences

The Workbench loader can initialize in the browser while retaining bounded DOCX, PPTX, and XLSX extraction. Node-only `fflate` APIs are not available to this Client parser, and future browser imports must keep the explicit `fflate/browser` subpath.

## Verification

The focused Workbench and files-panel tests pass. `pnpm run build:lib:client` completes, and the rebuilt `packages/client/ui-workbench/lib/client.js` contains neither `require(\"module\")` nor `createRequire`.
