---
description: "Session-following details workbench with results, terminal, browser, and files tabs."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-workbench

English | [中文](README.zh.md)

## Summary

The Workbench owns the `details` column and exposes stable child slots for session results, terminal, browser, and files panels. A permanent Start tab lists every built-in and registered plugin panel, so panel navigation does not depend on an overlay menu. The Results tab can close and reopen from Start. The global topbar toggle can open Workbench before a chat exists; Workbench then creates and selects a real blank chat Session, and the first message continues on that `SessionId`. Each chat gets a hidden capability Runtime Session for terminal operations; browser operations belong to the chat Session.

The deliverables package provides Results content through `workbench.panel`. The page aggregates successful mutation-tool outputs from every loaded Turn in the current Session and removes duplicate paths. Selecting a result, a Chat turn-tail chip, or a matching inline mention switches to Files, opens its directory, and loads the file in the Workbench editor or preview. The details column opens from the global topbar and can expand to 80% of the main content area.

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

Start entries show distinct icons and localized descriptions in a centered content column; the grid uses two columns in wide panels and one in narrow panels.

### When to choose it

Choose it when one `details` column must switch among session results, terminal, browser, and files panels without changing the surrounding layout owner.

The client setting `browserInitializationTimeoutMs` bounds initial native view readiness (default `5000`, positive integer milliseconds). A view that emits no readiness event is recreated once with the same target and persistent partition; a ready page is retained across panel hiding and Connection generation changes.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package owns the tab shell and keyed panel slots. Panel commands address the chat Session. The browser embeds a sandboxed native CEF Chromium view and attaches its exact page to the Session provider through CDP. Native input and Agent tools share that live document; tabs remain mounted when another panel is selected or Workbench is collapsed. Background views remain invisible and do not intercept input, including during native initialization. Terminal operations use a hidden capability Runtime. The [shared-page decision](../../../.agents/notes/implemented/architecture/2026-10-16-shared-browser-page.md) records ownership and target discovery.

The browser and terminal panels bind to the active Connection generation. Reconnection cancels old readers and discovers current Session resources before accepting input. Browser follow baselines supply the current context identity and open a blank tab when empty; the address bar normalizes bare domains to HTTPS and reports unsupported addresses before navigation. Cached browser ids are not queried during startup. Terminal discovery reuses a selected running process, then a running `Workbench` terminal, then another running terminal. If none runs, it closes an exited `Workbench` record before creating that named shell. Errors expose a Reconnect action. Host restart recovery creates usable resources but does not restore terminated shell processes or lost browser tabs.

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

- The interactive viewport requires the trusted desktop native bridge and embedded Chromium; ordinary Web clients report browser unavailability. Switching chat Sessions remounts the native views and reloads their current URLs, retaining partition storage but losing unsaved DOM state. Persistent partitions are isolated by Runtime and Session.
- XLSX editing covers visible cell values and worksheet switching. It does not calculate formulas; formula cells keep their original XML and cached values. Images and common charts render as read-only drawing layers; unsupported chart types show a preserved placeholder. Macros, external links, and advanced conditional formatting remain read-only.
- DOCX editing covers body paragraphs and table-cell text, not complete Word pagination or layout. When one edited text block spans multiple runs, the replacement is stored in its first run and the remaining run text is cleared, so mixed inline styling inside that block can be reduced. Headers, footers, media, and other untouched archive entries remain present.
- PDF, CSV, image, audio, and video presentations are read-only. PPTX supports bounded slide-text editing and preserves media, shapes, relationships, and unsupported XML; full slide-layout editing remains deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No runtime invariant companion is published. Panel stores consume controller snapshots and revisions, while capability providers own the underlying resources.
