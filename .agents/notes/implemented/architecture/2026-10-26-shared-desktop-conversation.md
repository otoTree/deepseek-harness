# Agent Note: Shared desktop conversation and Bot management

Status: implemented

English | [中文](2026-10-26-shared-desktop-conversation.zh.md)

## Problem

Product-owned Workbench overrides leave 智域OS and Arivo with different control density, while separate command and attachment buttons clutter the shared composer. Offering several overlapping built-in Agent modes also makes the capability-complete choice difficult to find.

## Decision

The [shared theme](../../../../packages/client/ui-theme/src/styles/workspace.css) owns compact Workbench controls and composer presentation through semantic attributes. Both desktop distributions and Web consume this sheet. Arivo retains its independently supplied palette and fonts under the [appearance decision](2026-10-24-arivo-shared-appearance.md). Tool execution, Session selection and editor persistence stay with their existing owners.

The composer exposes one Add menu for attachments and commands. Its existing file input, upload queue, paste/drop intake and command selection remain authoritative. Continuable subagents omit attachment intake; locked Sessions disable the menu. Message bubbles use smaller corners, process summaries use a borderless disclosure, and activity text consumes semantic colors.

The Session header has no view-switch tabs, and Chat contributes no metrics strip below the composer. Both desktop profile overlays disable `ui-trajectory`, so the inherited Web roster does not load it. The Conversation shell passes `availableViews` to each View; Chat supplies tool inspection only while Trajectory is registered. Generic Web profiles retain contextual inspection and a return to Chat. Metrics remain available to their existing Host projections and per-Turn details.

The shared command menu localizes built-in Host command descriptions and input hints through typed Client dictionaries. Command names remain executable tokens, and extension commands retain their supplied copy. Translations are resolved when candidates or input claims are created, so a later menu opening reads the current language without changing the Host directory or execution protocol.

Settings calls the preset section Bot management. Both desktop profiles default to `cordis`, whose composition includes the standard tools plus runtime inspection, plugin experimentation and Bot authoring. They disable `standard`, `ptc` and `minimal` through `disabledPresets`. The Host excludes these ids from the selectable roster and rejects new creation or explicit switching to them. A disabled persisted default resolves to the enabled deployment default. The configured default cannot itself be disabled.

Historical Session reads and restoration retain access to the recorded composition files. Disabling a choice does not delete its files or rewrite Session history. Custom and installed-plugin Bots remain selectable unless explicitly disabled. Selection validation stays inside the existing per-Session switch queue so asynchronous resolution cannot reorder concurrent requests.

The client-only [palette sheet](../../../../packages/client/ui-theme/src/styles/client-palette.css) follows the neutral surfaces and monochrome actions in Arivo studio-ui 1.0.72. It loads after the shared enterprise/Admin baseline and before workspace presentation; Admin does not import it. This keeps menus, user bubbles, composer, code, navigation and controls on one palette without changing the independent Arivo release dependency. The framework-free boot page uses matching fallback colors, and process-text gradients derive from surface aliases. The lifecycle browser replay records painted conversation/menu colors for both appearances; the Settings scenario owns preference persistence.

Settings use shared `Select` and `TabGroup` atoms. Select exposes a themed popup while a hidden native control owns form serialization, required validation and reset behavior. Task tabs keep inactive panels mounted so switching between role, budget or storage tasks preserves drafts; consumers omit tabs without authorization. The enterprise and local provider settings reuse the same controls and semantic palette.

## Alternatives considered

**Duplicate the Arivo sheet for 智域OS.** Two presentation owners drift. Semantic palette aliases allow one shared sheet while retaining product identity.

**Hide choices only in the browser or delete their compositions.** Browser-only filtering leaves creation and switch APIs able to select disabled choices; deleting files prevents historical Session restoration.

## Consequences

The shared theme intentionally applies compact Workbench presentation to Web as well as both desktop shells. Desktop defaults affect new sessions; historical conversations keep their recorded tools. The full shipped preset catalog remains available to non-desktop profiles unless they configure the same policy. Browser replay covers Add-menu command access, and focused component and Host tests cover file selection, child restrictions, disabled selection and historical resolution. Packaged desktop visual acceptance remains separate from browser replay.
