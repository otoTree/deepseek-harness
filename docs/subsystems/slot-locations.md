# Client Slot UI locations

English | [中文](slot-locations.zh.md)

## Summary

Use this reference to choose a Client Slot by where your contribution should appear. The current source declares 57 keys; a declaration does not guarantee a visible location. `sidebar.brand.name` has no render call, and `conversation.details.tool` has no mounted declaration owner in the current Workbench composition. The tables cover all 57 keys and identify these limits.

This page describes the Harness Web Client and the desktop client that uses it. The separate enterprise Admin application is outside this slot system. Positions follow the current source composition; this page is a schematic reference, not a screenshot of a running deployment.

## Table of Contents

- [Read availability](#availability)
- [UI overview](#overview)
- [Application frame](#frame)
- [Navigation and sidebar](#sidebar)
- [Session header and views](#session)
- [New Session page](#hero)
- [Composer](#composer)
- [Transcript and tool cards](#transcript)
- [Workbench](#workbench)
- [Settings](#settings)
- [Choose an extension point](#choose)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="availability"></a>
## Read availability

A slot becomes live when its declaring entry is registered and remains live for that entry’s lifetime. Actual rendering also depends on navigation, selection, and local UI state. Replacing a parent can remove its descendant slots. The [Slot system reference](slots.md) owns cardinality, scope, priority, props, and registration semantics; the [release catalog](../cookbook/enterprise-plugin-kit/docs/slots.md) and its [JSON](../cookbook/enterprise-plugin-kit/docs/slot-catalog.json) provide per-key registration details.

In the tables, “Session required” means that a current Session binding must exist. Root scope does not mean always visible. A blank New Session page can exist before a Session is created, so Session-scoped controls do not necessarily appear there. Enterprise and local profiles can provide different occupants or replace entire settings pages.

-----

<a id="overview"></a>
## UI overview

Approximate desktop layout; labels are slot keys. The Workbench can collapse or become an overlay on a narrow viewport. Settings opens in the main content region.

```text
root
+-----------------------------------------------------------------------+
| topbar: product title | topbar.session: title / actions / utilities     |
+------+----------------+-----------------------------+------------------+
| rail | sidebar        | conversation                | details          |
|      |                |                             | Workbench        |
| extra| workspaces /   | hero OR conversation.view   | workbench.tabs   |
| items| sessions       | chat nodes / tool cards     | workbench.panel  |
|      |                |                             |                  |
|      |                | conversation.input.dock     |                  |
|      |                | conversation.composer       |                  |
|      |                |   attachments / text        |                  |
|      |                |   plan / left / right/model |                  |
|      | footer.action  | conversation.composer.dock  |                  |
|  S   |                |                             |                  |
+------+----------------+-----------------------------+------------------+
S = sidebar.settings (bottom of rail)
main.surface: replaces conversation for application pages
shell.overlay: floating layer above all columns
```

-----

<a id="frame"></a>
## Application frame

The frame supplies the main columns and their topbar. See the actual render locations in [AppFrame](../../packages/client/ui-layout/src/client/AppFrame.tsx).

| Slot key | Approximate UI position | Visibility and use |
| --- | --- | --- |
| `root` | Entire application | Shell entry; replacing it replaces the whole frame. |
| `rail` | Permanent far-left narrow navigation column | Contains navigation entries and the Settings control. |
| `sidebar` | Session sidebar immediately right of the rail | Workspace and Session browser; can collapse. |
| `topbar` | Global horizontal bar at the top | Product identity and shell controls. |
| `topbar.session` | Session region inside the topbar | Session required; contains title, actions, utilities, and view navigation. |
| `conversation` | Center column | Contains the blank New Session page and live conversation. |
| `main.surface` | Same main region as conversation | Keyed application pages: Settings, Plugin Market, Cloud Drive, and Triggers replace conversation. |
| `details` | Right column or narrow-screen overlay | Workbench occupant; stays mounted when closed and receives `open`. |
| `shell.overlay` | Floating layer above all columns | Suitable for a global badge or toast; entries must opt into pointer events. |

-----

<a id="sidebar"></a>
## Navigation and sidebar

The permanent navigation rail and the collapsible Session sidebar are separate columns. See [NavigationRail](../../packages/client/ui-sidebar/src/client/NavigationRail.tsx), [SidebarRoot](../../packages/client/ui-sidebar/src/client/SidebarRoot.tsx), and [WorkspaceBrowser](../../packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx).

| Slot key | Approximate UI position | Visibility and use |
| --- | --- | --- |
| `sidebar.rail.item` | Far-left rail, after Sessions and before the bottom Settings control | Additive navigation entries. |
| `sidebar.settings` | Bottom of the permanent rail | Settings navigation trigger and onboarding coordinator. |
| `sidebar.workspaces` | Main body of the Session sidebar | Workspace/Session browsing area, search, and related dialogs. |
| `sidebar.workspaces.directoryFlow` | Directory selection opened from the workspace browser | Shown during directory selection; browser and native providers can differ. |
| `sidebar.footer.action` | Bottom of the Session sidebar | Additional actions such as the Cordis panel; separate from Settings in the rail. |
| `sidebar.brand.mark` | Expand control in the collapsed Session sidebar | Only rendered in the collapsed posture; not an expanded-sidebar logo position. |
| `sidebar.brand.name` | No current visible location | Declared and registrable while SidebarRoot is registered, but SidebarRoot never renders it. |

-----

<a id="session"></a>
## Session header and views

These locations require a Session. The header is rendered in the global topbar; view content is rendered in the center column. See [ConversationSession](../../packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx).

| Slot key | Approximate UI position | Visibility and use |
| --- | --- | --- |
| `conversation.session` | Conversation body above the composer | Owns the active conversation view. |
| `conversation.session.header.lineage` | Title/breadcrumb segments in the topbar | Used for Session lineage and subagent title presentation. |
| `conversation.session.header.actions` | Immediately beside the Session title | Add actions such as Agent preset, jobs, or schedules. |
| `conversation.session.header.utilities` | Right-aligned Session header area | Add utilities such as Session log download. |
| `conversation.view` | Main conversation content; view navigation in the header | List entries become selectable views, with one active body; navigation appears when multiple views exist. |

-----

<a id="hero"></a>
## New Session page

These positions belong to the blank-session Hero. See [ConversationRoot](../../packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx) and [WorkspacePicker](../../packages/client/ui-workspace/src/client/WorkspacePicker.tsx).

| Slot key | Approximate UI position | Visibility and use |
| --- | --- | --- |
| `conversation.hero.workspace` | Workspace picker opened from the blank-page workspace chip | The chip is drawn by the parent; this slot owns the picker content. |
| `conversation.hero.workspace.directoryFlow` | Directory flow opened from that workspace picker | Visible when the directory flow is requested. |
| `conversation.hero.agentPreset` | Agent preset control on the blank New Session page | Stages the preset for the new Session. |

-----

<a id="composer"></a>
## Composer

The resident card contains attachments, text, and a bottom toolbar. The upper dock and lower dock sit outside that card. See [InputBar](../../packages/client/ui-conversation/src/client/skeleton/InputBar.tsx), [ConversationRoot](../../packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx), and [ApprovalPanel](../../packages/client/ui-approval/src/client/ApprovalPanel.tsx).

| Slot key | Approximate UI position | Visibility and use |
| --- | --- | --- |
| `conversation.composer` | Whole composer region at the bottom of the conversation | Session required; chain entries can take over for approval, user questions, or a read-only subagent. |
| `conversation.composer.bar` | Resident input card | Includes the pre-Session inert state; replaces the card rather than adding a button. |
| `conversation.input.dock` | Full width above the input card | Session required; queue, todo, and goal panels appear here when applicable. |
| `conversation.composer.dock` | Below the input card | Session required; additional ambient information such as statistics. |
| `conversation.input.attachments` | Inside the card, before the text editor | Attachment rail and drop target; supports optional Session binding. |
| `conversation.input.overlay` | Floating menu anchored inside the card | Session required; command and slash menus render here when opened. |
| `conversation.input.plan` | Left group of the bottom toolbar | Session required; Plan control beside the access control. |
| `conversation.input.left` | After the Plan group on the left of the toolbar | Session and input state required; additive compact controls. |
| `conversation.input.right` | Right toolbar group, before the model selector | Session and input state required; additive compact controls. |
| `conversation.input.model` | Right toolbar group, after input.right | Session required; model selector before the context meter and submit/stop controls. |
| `conversation.approval.detail` | Inside the approval card that takes over the composer | Only when a pending approval has a correlated tool call. |

-----

<a id="transcript"></a>
## Transcript and tool cards

All of these positions require a Session and the corresponding message, node, tool call, or view. See [ChatNodeSeat](../../packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx), [TurnTailNodeView](../../packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx), [ToolCallTree](../../packages/client/ui-tool/src/client/tool/ToolCallTree.tsx), and [Cordis slot declarations](../../packages/extensions/ui-cordis/src/client/slots.ts).

| Slot key | Approximate UI position | Visibility and use |
| --- | --- | --- |
| `conversation.chat.node` | One node in the central Chat message flow | Dispatches by node kind; replacing an occupied key replaces that node renderer. |
| `conversation.chat.commandview` | Command node inside Chat | Dispatches by command name. |
| `conversation.chat.turnTail` | Turn footer before its action row | Selector-routed chain; used for produced files. |
| `conversation.chat.assistant-actions` | Finalized assistant message action row at the Turn tail | Message feedback and other actions; requires a durable message id. |
| `conversation.message.images` | Image group inside Chat messages | Only for messages containing images. |
| `conversation.trajectory.images` | Image group inside the Trajectory ledger | Requires the Trajectory view and image-bearing records. |
| `tool.call.toolview` | One tool call row/card in Chat | Dispatches by wire tool name; intended for a tool-specific presentation. |
| `tool.call.images` | Image content inside a settled tool call | Requires an image-bearing tool result and its rendering entry. |
| `tool.view.cordis` | Interactive area inside the latest eligible cordis_run card | Keyed by Package identity; requires the matching Cordis card. |

-----

<a id="workbench"></a>
## Workbench

The right-hand shell is owned by [Workbench](../../packages/client/ui-workbench/src/client/Workbench.tsx). Built-in panels and plugin panels do not all use the same dispatch path.

| Slot key | Approximate UI position | Visibility and use |
| --- | --- | --- |
| `workbench.tabs` | Tab strip at the top of the right Workbench | Can render without a Session; entries receive tab registration and selection callbacks. |
| `workbench.panel` | Workbench body below the tabs | Session required; dispatches the active tab key; the built-in browser uses a separate rendering path. |
| `conversation.details.tool` | Tool-result body in the standalone DetailsPanel component | No live location in the current composition: Workbench registers into details, while DetailsPanel is not registered and no entry declares this child. |

-----

<a id="settings"></a>
## Settings

The Settings trigger opens a main page with section navigation on the left and content on the right. Narrow containers place section navigation above content. Operation dialogs open above this page. See [SettingsPage](../../packages/client/ui-settings-general/src/client/SettingsPage.tsx), [ModelsSection](../../packages/client/ui-settings-models/src/client/ModelsSection.tsx), and [ConfigurablePluginsTab](../../packages/client/ui-settings-plugins/src/client/ConfigurablePluginsTab.tsx). A profile that replaces a section may omit that section’s child slots.

| Slot key | Approximate UI position | Visibility and use |
| --- | --- | --- |
| `settings.trigger` | Content of the Settings entry at the bottom of the rail | Icon and label; the current narrow rail visually hides the label. |
| `settings.header` | Title above the page’s section navigation | Title text, not the entire header. |
| `settings.action` | Header of the right content column | Additive header actions. |
| `settings.section` | One left navigation entry and its right content page | Add a separate settings page; only the selected page body renders. |
| `settings.general.item` | Preference rows within General | Add a single preference without creating a separate page. |
| `settings.onboarding` | Onboarding layer controlled by SettingsRoot | Steps run when requested by their predicates; not a permanent General row. |
| `settings.models.provider-card` | Adapter extension area inside each Models provider card | Key is the provider settings namespace; a hand-declared unsaved draft has no dispatch yet. |
| `settings.models.footer` | After provider rows and add controls in Models | Additive content at the end of the Models page. |
| `settings.plugins.tab` | Tab navigation and active body within Plugins | Add a subpage inside the shared Plugins section. |
| `settings.plugin.item` | One card inside Plugins → configurable plugins | Key is a Host settings namespace enumerated by the tab; registering a key alone does not add a namespace. |

-----

<a id="choose"></a>
## Choose an extension point

Choose the smallest visible location that fits the contribution. These are common additive choices; confirm the owner and state in the tables above before registering.

- Add a topbar action: `conversation.session.header.actions`; add a far-left navigation entry: `sidebar.rail.item`.
- Add an input button: `conversation.input.left` or `conversation.input.right`; add a panel above the card: `conversation.input.dock`.
- Add a settings page: `settings.section`; add one General preference: `settings.general.item`.
- Add a right-side panel: coordinate `workbench.tabs` and `workbench.panel`; customize one tool card: `tool.call.toolview`.
- Add a global floating contribution: `shell.overlay`. Whole-frame slots such as `root`, `conversation`, and `details` replace large portions of the UI.

-----

<a id="further-exploration"></a>
## Further Exploration

Use these owners for registration details and the executable layout evidence.

- [Slot system reference](slots.md) — lifecycle, four composition kinds, and component inputs.
- [Release slot catalog](../cookbook/enterprise-plugin-kit/docs/slots.md) — per-key props and registration examples in the adjacent JSON.
- [Frame tests](../../packages/client/ui-layout/tests/app-frame.client.spec.tsx), [navigation tests](../../packages/client/ui-sidebar/tests/navigation-rail.client.spec.tsx), [composer tests](../../packages/client/ui-conversation/tests/skeleton.client.spec.tsx), [settings tests](../../packages/client/ui-settings-general/tests/settings-root.client.spec.tsx), and [Workbench tests](../../packages/client/ui-workbench/tests/workbench.client.spec.tsx) — layout and conditional rendering.

-----

<a id="dev-note"></a>
## Dev Note

None.
