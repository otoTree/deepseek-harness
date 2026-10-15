# Agent Note: Session-following Workbench separates UI ownership from capability state

Status: implemented

English | [中文](2026-09-19-session-following-workbench.zh.md)

## Problem

The desktop and Web clients need one Session-following details workbench while terminal, files, and browser capabilities keep their own Host-owned state and cleanup rules.

## Decision

`ui-workbench` is the sole owner of the layout `details` slot. Its session-scoped keyed child slot owns the Results, terminal, browser, and files panels, so switching Sessions remounts panel state without changing the three-column layout owner. Results reuses `ui-deliverables` Turn data and aggregates successful mutation paths across the loaded Chat timeline in first-seen order. The Results key props carry a file-open callback to Results; selecting a path changes the active tab, directory, and file selection in one Workbench store action, then the Files panel reads it through the bounded Workbench Remote. Chat uses the root-scoped Workbench file opener for turn-tail chips and message-body links, so those affordances open the same Session Files panel; compositions without Workbench retain the Host workspace opener as a fallback. Terminal operations continue to use `ctx.terminals`; file operations use `ctx.fs` with an expected version; browser state is an independent capability and does not change `ctx.web` search/fetch semantics.

The [shared browser page decision](2026-10-16-shared-browser-page.md) owns browser presentation, storage, and chat Session identity. This note owns the Workbench shell, terminal, files, and connection-generation recovery.

The launcher contributes to `conversation.session.header.utilities` as an icon-only action, so users can open the Workbench from the session header after closing it. The terminal panel binds to a Session-owned persistent terminal and uses an xterm renderer. Keyboard bytes flow directly to the PTY, raw PTY output retains ANSI and cursor-control sequences, and renderer dimensions resize the provider. Bash owns line editing, history, completion, and foreground signals; model-facing sends continue to read a separate sanitized output view.

The files panel reads within the Session workspace through `ctx.fs`. Separate icons, colors, metadata, and accessible descriptions distinguish directories, regular files, and other entries. Valid UTF-8 files remain editable with expected-version replacement, while an allowlist maps common image, audio, video, and PDF filename extensions to browser-native media elements. A revocable Blob URL lets the browser's PDF viewer consume the bounded bytes without a sandboxed `data:` document. DOCX, PPTX, XLSX, and CSV bytes cross the Remote as bounded document payloads. The [built-in Office decision](../feature/2026-09-22-built-in-office-editing.md) owns OOXML rendering, limited editing, and archive-preserving saves. `ctx.fs.writeBytes` gives local, sandboxed, and E2B providers the same atomic publication, stale-version protection, and per-call sandbox policy as text writes without manufacturing text diff fields. No preview executes macros, scripts, or embedded objects, and unrecognized binary files still fail closed. The enterprise desktop profile starts Sessions with `workspace-write`, which permits file replacement inside its organization workspace without granting paths outside that workspace.

Browser actions are automatically allowed at the product layer. URL protocol, tab count, observation size, resource size, and process cleanup limits are enforced by the current capability. Full browser-navigation SSRF resistance remains open implementation work; the current URL validation is not a DNS-pinned public-network policy.

Workbench resource ids are hints within a live Host lifetime, not durable ownership evidence. The Connection generation controls browser and terminal reader lifetimes. Browser follow baselines replace cached context ids; terminal discovery selects only running processes and frees an exited Workbench name before respawn. This keeps Host ownership checks intact instead of treating an ownership failure as permission to use another Session’s resource. Recovery restores availability, not process memory or lost page state.

## Alternatives considered

- **Keep `ui-chat` as the details owner** — it preserves the original composition, but every new panel would compete for the same layout slot and session switching would mix UI selection with capability state.

## Consequences

- Session changes remount panel content while preserving the surrounding three-column layout.
- The Results tab is the default Workbench tab and lists only successful mutation-tool paths from loaded Turns; terminal-created files remain outside this vocabulary.
- A Results selection opens inside Files without importing deliverables runtime code into Workbench; paths outside the Session workspace retain the file capability's rejection behavior.
- Browser, terminal, and file operations remain bounded by their existing providers and Remote contracts; the Workbench does not add a second capability registry.
- Text reads and binary document payloads have separate configurable byte limits. DOCX, PPTX, and XLSX use an allowlisted binary replacement path; PDF, CSV, media, and unrecognized binary content remain read-only and never become writable through the text mutation API.
- Office saves retain untouched OOXML archive entries. XLSX formulas and drawing objects remain read-only, while DOCX and PPTX expose bounded text editing without claiming complete Microsoft Office layout compatibility.
- Direct terminal input bypasses the model-facing send reservation but remains owner-authorized and serialized at the backend; concurrent writers must coordinate their input.
- The details column can expand to 80% of the main content area while retaining a 240-pixel center floor; it closes when the details minimum and center floor cannot coexist.
- Browser URL checks enforce the current protocol and lifecycle limits only; deployments needing DNS-pinned public-network SSRF policy must add that policy before treating navigation as hardened.

## Verification

Focused Client regressions cover stale browser identity replacement, empty replacement baselines, running-terminal selection, exited-name release, and cancellation before terminal discovery settles.

Focused Client and Host regressions cover Workbench state, terminal recovery, version-checked file editing, and media/document presentation. Browser presentation verification belongs to the shared browser page decision.

Four focused test files pass 120 tests, the repository TypeScript check passes, the Workbench bundle builds, and the documentation quick check passes. The enterprise desktop command rebuilds the production client and starts its API, Admin, renderer, and Electrobun process. Round-trip acceptance with an existing five-worksheet XLSX and a nine-page DOCX reopens the edited values, preserves every ZIP entry, and changes only the selected worksheet XML or `word/document.xml`; LibreOffice opens and exports both saved files, and the original and edited DOCX exports retain the same page count and layout. The bundled LibreOffice renderer lacks some Chinese fonts, so both the original and edited DOCX exports show the same missing-glyph boxes. Direct Office editing in the native window remains a manual acceptance item because the test automation bridge cannot control Electrobun's native surface.
