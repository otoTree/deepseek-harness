---
description: "Session-following details workbench with results, terminal, browser, and files tabs."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-workbench

English | [中文](README.zh.md)

## Summary

The Workbench owns the session-scoped `details` column and exposes stable child slots for session results, terminal, browser, and files panels. It owns only the tab shell and session-local selection; capability packages provide the panel contents through Cordis slot injection.

The deliverables package provides Results content through `workbench.panel`. The page aggregates successful mutation-tool outputs from every loaded Turn in the current Session and removes duplicate paths. Selecting a result, a Chat turn-tail chip, or a matching inline mention switches to Files, opens its directory, and loads the file in the Workbench editor or preview. The details column opens from an icon in the Session header and can expand to 80% of the main content area.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the Workbench with `ui-layout`, the Client Remote connection, and the capability panels it should display for each Session.

### When to choose it

Choose it when one `details` column must switch among session results, terminal, browser, and files panels without changing the surrounding layout owner.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package owns the tab shell and Session-keyed child slots. The Session header supplies an icon-only action that opens the details column, while panel commands use the Workbench Remote and capability-specific state. The Results-key dispatch supplies a file-open callback; it converts workspace-rooted absolute result paths to relative paths and updates the Files tab, directory, and selection in one store action. A browser tab starts at `about:blank`. The desktop panel mounts a sandboxed native Electrobun WebView, and the Web client mounts an iframe; both render pages at the panel's actual viewport size instead of displaying provider screenshots. A resize observer resynchronizes the native WebView bounds whenever the panel changes size. The active native view alone receives pointer input; every inactive view remains hidden and input-transparent, including when a late readiness event resynchronizes the tab set. All native tabs opened by one enterprise Runtime use the same named persistent Electrobun partition across Sessions and Browser contexts, so they share cookies and site storage. Each Runtime uses a separate partition derived from its deployment, organization, and Runtime identities without including its credential token. The native WebView owns visible navigation, persistent storage, and history. Its `src` is fixed when the view is created; address submissions and toolbar commands act on the native view, and resulting navigation plus bounded semantic observations update the Session Playwright mirror. Provider follow state may update the address bar but cannot reload the native view. The terminal panel reuses the Session terminal named `Workbench`, falls back to another existing terminal, or creates that named terminal when none exists. An xterm renderer sends keyboard data directly to the PTY, consumes retained and live raw PTY output, and synchronizes measured rows and columns after panel resize. Bash therefore owns line editing, history, completion, signals, ANSI styling, and cursor behavior inside one focused terminal surface. The files panel distinguishes directories, regular files, and other entries with separate icons, colors, metadata, and accessible descriptions. It edits valid UTF-8 files with expected-version writes and keeps a successful edit open. It loads PDF bytes through a revocable Blob URL so the browser's PDF viewer can render the document; SVG, PNG, JPEG, GIF, WebP, AVIF, and BMP images; MP3, WAV, Ogg, FLAC, and M4A audio; and MP4, WebM, Ogg, and QuickTime video use their native browser elements. XLSX uses a workbook grid with named worksheet tabs, row and column headers, merged cells, stored widths and heights, frozen panes, formatted values, and basic cell styles; visible cells are editable. DOCX exposes body paragraphs and table-cell text as editable fields. Saving either format changes only the corresponding OOXML document or worksheet XML in the original archive, retains the other ZIP entries, and sends a guarded binary replacement through the Workbench Remote. Bounded client-side parsers render PPTX slide text and quoted CSV rows without executing macros, scripts, or embedded objects. Panel disposal aborts the follow stream and releases Blob URLs, renderers, resize observers, and input listeners. The source map starts at [`src/client/index.ts`](src/client/index.ts), [`src/client/Workbench.tsx`](src/client/Workbench.tsx), and [`src/client/panels`](src/client/panels).

</details>

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-client-ui-layout`](../ui-layout/README.md) — three-column layout owner.
- [`dsh-api-workbench-controller`](../../api/workbench-controller/README.md) — Host Remote methods.
- [`dsh-browser`](../../browser/browser/README.md) — shared browser capability.

<a id="model-experience"></a>
## Model Experience

### Workbench panel presentation

#### What the model sees

The Workbench adds no model-visible input: it renders logged capability results and sends Client actions through `workbench` Remote methods, while model-facing tools own prompt content and Session events.

#### Token effect

Zero tokens from the panel shell itself; token use comes from a capability result only when its separate model-facing consumer renders that result.

#### KV Cache effect

Panel selection and layout state do not alter the model request prefix or provider cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The native Electrobun WebView and the Session Playwright provider are separate browser engines. Native navigation and semantic observations update the provider mirror, but provider actions do not drive the visible native page and direct native-page interaction is not replayed as an identical Playwright action sequence.
- XLSX editing covers visible cell values and worksheet switching. It does not calculate formulas; input is saved as a number or plain text, including text beginning with `=`. The grid does not render charts, macros, conditional formatting, drawings, or embedded objects, although saving retains untouched archive entries that contain them.
- DOCX editing covers body paragraphs and table-cell text, not complete Word pagination or layout. When one edited text block spans multiple runs, the replacement is stored in its first run and the remaining run text is cleared, so mixed inline styling inside that block can be reduced. Headers, footers, media, and other untouched archive entries remain present.
- PDF, PPTX, CSV, image, audio, and video presentations are read-only. PPTX remains a slide-text preview rather than a complete presentation layout.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
