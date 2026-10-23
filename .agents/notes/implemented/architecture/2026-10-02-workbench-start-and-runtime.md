# Agent Note: Workbench Start tab and Runtime ownership

Status: implemented

English | [中文](2026-10-02-workbench-start-and-runtime.zh.md)

## Problem

Workbench panel entry points were presented through an overlay menu that could be covered by a native WebView, and ordinary chat Sessions did not consistently own terminal, browser, and filesystem capabilities.

## Decision

Workbench keeps a permanent `start` tab and a registry of panel definitions. Built-in and plugin definitions are projected as Start entries; opening an entry activates or restores its tab. Closable tabs, including `results`, return to Start when closed, while plugin disposal removes its definition and keyed body.

Start entries use distinct capability icons and localized descriptions. A centered, bounded content column keeps entries together when the panel expands; a container query selects one or two columns from the Workbench width rather than the window width. Neutral entry borders and icon wells inherit the shared theme, while focus and hover identify the actionable entry.

Each chat-owned Workbench uses the chat `SessionId` as its only ownership key and Remote address. Opening Workbench with no selected chat creates and selects one real blank chat Session before capability resources start; the first message continues on that identity. A single-flight Host manager may create one hidden Runtime Session as the capability resource for that owner; the Host resolves terminal and browser operations from the chat address to the hidden resource. UI state, files, and results remain on the chat Session. A process-stable Session classifier filters the generated resource namespace from live and persisted list and search projections. Releasing the runtime disposes its `AgentHandle`; the classifier keeps the persisted resource identity internal.

Native browser views are hidden and pointer-transparent whenever they are inactive or their panel is disposed. Visibility is re-applied after tab changes and readiness events; CSS stacking order is not used to cover a native composition layer.

## Alternatives considered

- **Keep the add-panel overlay:** Native WebView composition can remain above DOM regardless of CSS z-index, so the overlay cannot guarantee access to the navigation controls.
- **Use the chat Agent as the capability resource:** Blank chats and sessions without the standard preset would still lack terminal capability, and switching chats could reuse process state. The chat Session remains the ownership key, but capability resources stay isolated in the hidden Runtime Session.
- **Register Runtime Sessions as ordinary chats:** Runtime identities would pollute navigation and search and could be opened by the user.

## Consequences

The Start page is the stable navigation surface and results data remains in the chat Session when its tab closes. Runtime resources are isolated per chat and must be released when the Workbench owner changes or is disposed. Runtime metadata is process-owned and is not exposed as a model-visible tool input.

## Verification

Focused Workbench client and Host controller suites pass. The Web recovery replay creates replacement browser and terminal resources through the hidden Runtime Session. TypeScript checks pass for the Workbench client and Workbench controller faces. Full real-model Web and Electrobun recording remains dependent on the development API and model credentials.
