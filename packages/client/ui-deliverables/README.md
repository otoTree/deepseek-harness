---
description: "Produced-files and clickable file references for the Web GUI: the deliverables row a finished turn ends with, and inline-code links in the closing prose; for users and maintainers of the deliverables experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-deliverables

English | [中文](README.zh.md)

## Summary

This package renders the Session Results page and the deliverables row a finished turn ends with — the files the mutation tools created or modified — and links matching inline-code references in the closing prose. Selecting any Results entry, turn-tail chip, or inline mention opens the file in the Session Workbench Files panel when Workbench is mounted; Chat retains the Host opener only as a fallback for compositions without Workbench. Results aggregates the same per-Turn vocabulary in order across the current Session and removes duplicate paths. The shipped Web patch is the only composition that loads this package; removing its cordis.yml entry removes the guidance, Results page, row, and prose links together.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-conversation` and `ui-workbench`; the Results tab lists produced files from every loaded Turn, and a finished turn ends with the produced-files row between the closing message's body and its action footer. A Results entry uses the Results-key callback to switch to Files and load the selected workspace file. Turn-tail chips and inline mentions use the Session Workbench opener, with relative paths resolved against the session cwd; when the row first appears, it queries `session.canOpenWorkspacePath()`, and an omitted-file **Show in folder** action opens the session workspace only when the page is loopback and that query succeeds with `true`.

### The row

The row uses CSS container-width bands to show a responsive prefix of up to six file chips. Flexbox shrinks and ellipsizes basename text, while CSS selects the matching localized `+ N files` label for omitted paths; the full path remains available as the title, and the row performs no JavaScript layout observation or horizontal scrolling.

### Inline-code links

The closing prose carries the same vocabulary: an inline-code token resolves by exact path, or by being exactly the basename of exactly one produced path — a basename two paths share stays inert rather than guessing, so a mention can never open the wrong file. A resolved mention keeps its code chip and takes the markdown sheet's link language, with the full path as its title.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Node half registers the static `ui:deliverable-file-references` system-prompt section. The browser half registers `ProducedFiles` into `conversation.chat.turnTail` and `ResultsPanel` into the Workbench's keyed `workbench.panel` slot. The Workbench passes its file-open callback through the Results key props, so deliverables does not import Workbench runtime code or mutate its store. `collectDeliverables` walks the Chat timeline in Turn order and builds one deduplicated Session list from `DeliverablesTurnData`. Reads, deletes, unsupported tools, malformed calls, and failed results contribute nothing. A new mutation tool needs an explicit Client contribution before it joins either list. The package also provides the `chatFileMentions` service; composing the plugin out removes all three browser surfaces.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the deliverables surface is not enough. They move from the row to the turn-tail hole and the decisions behind the vocabulary.

- [ui-conversation](../ui-conversation/README.md) — declares the `conversation.chat.turnTail` hole and renders the closing prose.
- [Workspace file links](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.md) — the decision behind the produced-files row and the Host open path.
- [Inline file mentions](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.md) — the decision behind clickable mentions in the closing prose.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

### Clickable file-reference guidance

#### What the model sees

One fixed paragraph instructs the model to name primary files from successful creation or modification calls in its final response and to format those and any other changed-file references as exact-path or unique-basename Markdown inline code, such as `out/report.html`.

#### Token effect

One fixed prompt paragraph whenever this package is loaded; no tool schema, tool result, or per-Turn context is added.

#### KV Cache effect

The section is static at first-party order 9000 for the lifetime of the package mount, so it remains in the reusable prompt prefix and does not change across Turns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current deliverables vocabulary. They are current package constraints, not a general file-linking comparison or a task backlog.

- **Mention matching is exact path or unique basename only** — a suffix mention stays inert; widening the matcher is deferred until a real closing-message shape needs it.
- **Files created indirectly by terminal commands remain outside the matching vocabulary** — naming such a file in inline code does not make it clickable unless a successful mutation location also records that path.
- **Results includes loaded Turns only** — older history is not listed until the Session loads it into the Chat timeline.
- **Results preview is confined to the Session workspace** — the Files panel rejects an absolute result path outside the current workspace instead of granting broader filesystem access.
- **Native folder handoff targets the Host desktop** — a browser reached through a non-loopback authority omits the action, as does a deployment reporting no native opener; SSH forwarding that makes a remote Host look loopback-local must set the Session Controller's `nativeOpen: false`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The prompt section, slot, dictionary, event definition, and optional service registrations are effect-owned with disposal proven by their plugin specs; this package owns no mutable state.
