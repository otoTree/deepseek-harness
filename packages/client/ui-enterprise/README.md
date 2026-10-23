---
description: "Enterprise account and governed plugin views embedded in the existing DSH Web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-client

English | [中文](README.zh.md)

## Summary

This Cordis client plugin adds organization account, team wallet, member usage, invitation, platform model, device, and desktop plugin-market views to the existing DSH Web shell. Its page layouts use the shared `ui-theme` semantic palette and keep the Web client's wider reading rail; it does not render the administration console. The target visual rules are defined in the [Enterprise Client and Admin Visual Design System](../../../docs/visual-design-system.md).

## Table of Contents

- [Mounting](#mounting)
- [Browser bridge](#browser-bridge)
- [Verification](#verification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="mounting"></a>
## Mounting

Settings assign one home to each task: Account contains organization identity, subscription, roles, and devices; Models contains the default selection and capability catalog. Directory opens on the member list; selecting a member opens their profile, with privileged usage records on a separate tab. Pending invitations have their own view. Billing separates personal usage totals, paged call records, and shared-wallet transactions. Usage supports rolling 3-, 7-, and 30-day periods and custom dates. The Host reads every API page in the selected period before returning personal totals. Account and model reads do not fetch usage. Settings renders in the application main column; inviting members and redeeming codes open a single shared modal above that page. The plugin settings page opens the marketplace, which owns browsing and installation. On desktop, General also offers Software updates through the native signed updater; the row stays hidden in browser deployments. The native startup check supplies a persistent, closable notification through `shell.overlay`, available across workspace navigation. Its install action opens the same native confirmation flow; dismissing it clears the native launch-scoped state.

The Directory's Departments tab lets Owners and administrators create subdepartments, rename or reparent them, and assign an active member to one or more departments. Both deployment modes use the same organization-scoped units and assignments. Root units are protected; deletion requires confirmation and fails while children, assignments, or department roles remain. The Host loads the tree only when this tab opens.

Account, Models, Directory, and Billing retain their page heading and description while loading or unavailable. A failed read shows a compact status card with connection guidance and a retry action; retry reloads only the active page.

Settings use subdued bordered sections, aligned form controls, and tabular financial figures. Model selectors show display names while catalog details retain full IDs. Date filters and financial summaries stack within narrow content columns; wallet amounts retain their full precision. Usage and wallet records load when their view opens; changing the member or period discards responses for the previous selection.

The enterprise desktop profile inserts this plugin after the Web bundle. The Host reads the platform-protected organization credential, validates API records and exposes browser-safe results. Account settings offers manual upload of all local conversations and download of account-owned cloud archives for the same account and organization on another device. Transfers preserve identical prefixes, retain longer histories and refuse divergent records. Downloads validate each complete archive before writing and refresh the session list; an active local writer must close before a download can extend its log. Uploads use bounded transactions without cloud writer leases. Completed pages survive failures and repeated transfers resume safely. No background synchronization runs, and attachments and workspace files are excluded. Each conversation is assembled in Host memory.

The plugin is a profile component, not a second chat application. The Web profile owns chat, sessions, tools, workspace, attachments, plans, goals, jobs, search, export, and schedule views. Enterprise policy disables local model and personal plugin settings before this plugin is loaded. The enterprise Models page lists the enabled platform catalog and writes the selected `enterprise` model through the native host; the gateway checks platform availability on every call.

The trigger page keeps rule management as its primary list and combines the execution queue and run history in one tabbed region. With no rules, a compact empty state opens the rule editor directly; rule enablement and Runtime listening remain separate statuses.

The rule editor groups trigger conditions, execution targets, and Agent instructions in three sections. Its header and save controls stay visible while long forms scroll; available prompt variables expand below the instruction field.

The cloud drive separates Personal, Organization and Shared with me views. File and folder details show the effective audience, inherited permissions, the current organization's accessible-member count and the caller's access level. Sharing managers can select named members, concrete departments with an explicit subdepartment option, or the named organization's entire membership, with view or edit access. The My departments shortcut saves concrete department IDs, so a later transfer does not change the selected audience. Sharing a personal file preserves ownership; organization files remain manageable by their creator and organization administrators. [API authorization](../../../apps/api/src/drive.ts) enforces the same policy for the browser and Agent requests.

The sharing editor uses the shared modal, button and search-input primitives. Scope choices use compact rows; searchable department and member lists preserve selections while filtering. Narrow screens stack the lists inside a scrollable body while keeping the title and save controls visible.

The [recorded-session browser case](../../../snapshots/web/drive-sharing/snapshot.yml) checks the Host bridge, department selection, saved audience display and navigation into a shared personal folder through the shipped Web profile.

<a id="browser-bridge"></a>
## Browser bridge

Private package uploads are idempotent for identical bytes. A changed private package with the same plugin ID and version replaces that private release and restarts its installations; public releases remain immutable.

The marketplace lists published platform releases alongside releases visible to the current account or organization. The refresh control reloads the catalog after a platform administrator publishes a package. Opening the market does not upload local ZIPs; a user-selected private upload remains visible only to its creator.

The market renders the release’s embedded PNG icon from the verified catalog. Missing or undecodable images display the first two characters of the plugin name; refreshing to a different image resets its load state. Icons remain decorative beside the visible plugin name and require no external image requests. See the [manifest icon format](../../plugin/protocol/README.md#use-this-package).

The upload panel keeps visibility selection and package upload together. Plugin cards separate identity and runtime status from their action footer; runtime details and removal controls expand on demand, while activation errors remain visible.

Verified `contributions.configuration` fields provide ordinary plugin setup, including typed values, defaults, bounds, and installation-scoped credential inputs. The Host validates declared fields and API write authority before changing local secrets. Secret values remain in Host credential storage; the API stores non-secret configuration and the form receives only credential presence. Empty replacement inputs retain saved credentials. Missing ordinary setup appears as a configuration requirement, while MCP setup uses connection controls independently of the plugin ID. Installations whose archived release has no setup metadata require an upgrade to the release that declares it.

Verified MCP connection metadata supplies official URLs and chooses OAuth, provider-issued Token, or unauthenticated access. The market asks for a URL only for a self-hosted service. OAuth uses MCP SDK discovery, dynamic client registration, PKCE and a state-checked loopback callback; installation grants persist in Host credentials and runtime refreshes update the same record. Cancellation or desktop shutdown closes the listener without saving an incomplete grant. Missing authorization appears as a connection requirement; readiness still requires successful MCP discovery.

OAuth discovery reads the service’s `WWW-Authenticate` challenge, including query-bearing and cross-origin resource metadata URLs. Verified `mcpConnection.oauth` settings may select an `authorizationServerMetadataUrl` or supply `responseTypesSupported: [code]` only when the server omits that field; explicit server values and all other SDK validation remain authoritative. Discovery metadata persists with the grant for code exchange and refresh. Reconnecting an OAuth release replaces a saved Token authentication mode while retaining unrelated installation settings. The Client localizes discovery, registration, exchange, denial, and cancellation failures without exposing provider responses.

On the native desktop, the Host opens OAuth and provider credential-page URLs through its allow-listed external-link bridge so the system browser starts even when the WebView blocks popups. The WebView `window.open` path remains the fallback for browser deployments. Closing the connection dialog or leaving the market cancels its authorization, including discovery still awaiting a login URL. Late responses cannot open an obsolete login page or change another service’s connection state. Reopening the same service waits for its previous authorization cleanup.

The Connection RPC bridge supplies account operations and the plugin market. Verified ZIPs install into an organization package store; `CordisPluginManager` adds Host packages to Loader groups, while the browser module loader mounts each Client bundle independently. Loader fibers own Tool, Skill, MCP and UI registrations. The market checks registration ownership, Agent-visible schemas, Skill catalog entries, MCP connection and discovery, presets, and reported Client slots. Diagnostic failures expose the returned error. Platform Runtime tokens stay in the Host; authorized integration credentials are available only to trusted Host packages through the activation-scoped credential facade. Host imports support Node built-ins and declared dependencies supplied by the Harness runtime. See the [installation lifecycle](../../../docs/developer/plugin-installation-lifecycle.md) for permissions, rollback and disposal.

Account actions use localized dictionaries registered in the existing Web locale service. Device revocation requires a second click, and failed requests remain visible to the user. The dashboard returns server-computed plugin capabilities; organization mutation controls and non-private upload choices stay unavailable when the current account lacks them. Plugin cards show the activation error reported by either target and keep permitted upgrade, disable, uninstall, and force-remove controls available for recovery; a stale target preparation row does not override an active installation state. Force removal uses an in-app confirmation and reports API revocation independently from best-effort local Client reconciliation; bridge failures include their returned message. Client and Host target failures are isolated so another plugin can reconcile; revoked uninstall leases are collected on the next device-target read. The native shell owns organization switching and logout so it can stop the old runtime and remove its Keychain credential.

The marketplace reloads installation and device-target state after background reconciliation settles. Preparation keeps disable and retained-data uninstall available; pending reads cannot overwrite a newer refresh or update an unmounted page.

Host and Client preparation has a configurable deadline (`activationTimeoutMs`, default 30 seconds). The Host reports a timed-out target as failed and revokes its lease, while the browser receives the same deadline with each runtime snapshot. Host lease revocation and Host or Client contribution cleanup use `cleanupTimeoutMs` (default 10 seconds). These deadlines keep serialized reconciliation available for other plugin operations.

<a id="verification"></a>
## Verification

Client readiness follows the [manifest slot selectors](../../plugin/protocol/README.md#use-this-package). The optional `DSH_MEDIA_PLUGIN_ZIP` test input points to a built Media Canvas ZIP and checks its real Client bundle through marketplace mounting, slot reports, and disposal; the recorded report lives beside the Client runtime tests.

Run the host and client suites from this package:

```sh
pnpm --filter @deepseek-ai/dsh-enterprise-client test
```

The [installed SDK Session replay](../../../snapshots/session/model-platform-sdk/snapshot.yml) installs a verified Host ZIP and calls the real SDK through controlled HTTP responses. It verifies catalog, preview, creation, query, and history projection; it does not certify supplier generation or storage.

The host tests verify credential isolation, team-role authorization, response validation, fail-closed model selection, and package lifecycle state. The jsdom suite verifies settings-slot registration, Chinese rendering, wallet redemption, personal and member usage, invitation controls, platform model display, device confirmation, published catalog fields, and standard Client bundle activation, removal, and re-enablement.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Host-owned default-model selection applied to later requests.

#### KV Cache effect

Changing the selected model starts a request in that provider and model's cache namespace; the browser views themselves do not change prompt tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This plugin does not implement platform administration, SSO, SCIM, payment collection, or Cloud target execution. Model usage debits the API-owned team wallet; the browser never calculates or settles charges.
- Local Host activation and rollback remain owned by the desktop plugin manager. The marketplace page records account installation and enablement state and does not transfer device-local credentials or operating-system permissions.
- Team usage summaries and member pages come from the API. The client does not infer organization totals from a recent-record window, and it never exposes another member's Session content.
- A working enterprise API, Keychain helper, and organization-scoped desktop runtime are required. The browser plugin cannot authenticate by itself.

<a id="dev-note"></a>
### Dev Note

The [enterprise platform blueprint](../../../docs/developer/discussion/enterprise-agent-platform.md) defines the product allocation. The [desktop README](../../../apps/electrobun/README.md) documents the native host and its release checks.

**Runtime invariant:** No runtime invariant companion is published. Views consume Host snapshots and RPC results; authoritative account, plugin, and billing records remain on the Host.
