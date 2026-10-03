# Agent Note: Workbench Start tab and Runtime ownership

Status: implemented

English | [中文](2026-10-02-workbench-start-and-runtime.zh.md)

## Problem

Workbench panel entry points were presented through an overlay menu that could be covered by a native WebView, and ordinary chat Sessions did not consistently own terminal, browser, and filesystem capabilities.

## Decision

Workbench keeps a permanent `start` tab and a registry of panel definitions. Built-in and plugin definitions are projected as Start entries; opening an entry activates or restores its tab. Closable tabs, including `results`, return to Start when closed, while plugin disposal removes its definition and keyed body.

Each chat-owned Workbench creates one hidden Runtime Session through a single-flight Host manager. The Runtime joins the standard agent preset, reports terminal, filesystem, sandbox, and browser capabilities, and supplies the Session ID used by Workbench Remote calls. Session Controller list and search projections filter these identities. Releasing the runtime disposes its `AgentHandle` and removes the hidden identity.

Native browser views are hidden and pointer-transparent whenever they are inactive or their panel is disposed. Visibility is re-applied after tab changes and readiness events; CSS stacking order is not used to cover a native composition layer.

## Alternatives considered

- **Keep the add-panel overlay:** Native WebView composition can remain above DOM regardless of CSS z-index, so the overlay cannot guarantee access to the navigation controls.
- **Reuse the chat Agent as the Workbench owner:** Blank chats and sessions without the standard preset would still lack terminal capability, and switching chats could reuse process state.
- **Register Runtime Sessions as ordinary chats:** Runtime identities would pollute navigation and search and could be opened by the user.

## Consequences

The Start page is the stable navigation surface and results data remains in the chat Session when its tab closes. Runtime resources are isolated per chat and must be released when the Workbench owner changes or is disposed. Runtime metadata is process-owned and is not exposed as a model-visible tool input.

## Verification

Focused Workbench client and Host controller suites pass. TypeScript checks pass for the Workbench client and Workbench controller faces. Full real-model Web and Electrobun recording remains dependent on the development API and model credentials.
