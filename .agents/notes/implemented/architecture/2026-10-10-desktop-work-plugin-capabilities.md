# Agent Note: Desktop work plugins use verified Host packages

Status: implemented

English | [中文](2026-10-10-desktop-work-plugin-capabilities.zh.md)

## Problem

The desktop plugin protocol could install verified ZIP packages, but its manifest and SDK vocabulary only described identity, models, storage, and cache. Work integrations such as Feishu, mail, enterprise search, MCP servers, and operational skills had no declared place in the package or author SDK. The product also needed one source workspace for independently installable plugin ZIPs without making the desktop trust source directories.

## Decision

The protocol accepts optional Host policy fields for an HTTP host allowlist and credential descriptors. Its permission vocabulary includes network requests, Host credentials, authorization, MCP connections, Skill registration, and installation configuration. Schema v2 retains product-level targets. Schema v3 groups Host and Client targets under Cordis packages and requires each package's `package.json` metadata to match the manifest. The SDK exposes optional capability facades, and the package parser validates declarations before activation.

`/Users/hjr/Desktop/plugins` is the separate work-plugin source workspace. Each product has its own identity and ZIP artifact. Esbuild bundles shared source and third-party libraries into each Host entry; Harness-native service packages remain declared external dependencies to preserve runtime service identity. Builds emit integrity records and package metadata. Memory and Agent orchestration remain outside the workspace.

The desktop verifies the ZIP before writing Host package files under the organization DSH Home. It loads each Host entry in a Cordis group through `ctx.loader`, so Loader fibers own Host registrations and disposal. Client bundles are served by the Host and mounted by the browser module loader; separate `moduleId` values let one product release load and remove multiple Client packages independently. External Host imports must be declared package dependencies and resolve from the installed Harness runtime.

The desktop host also exposes a reusable discovery helper that reads only `<workspace>/<pluginId>/dist/*.dsh-plugin.zip`, parses every package with the same verifier used by publication, and ignores invalid archives or directory identity mismatches. Source directories are never activation inputs. A manifest declaration does not prove that a Tool or Skill is Agent-visible; the Cordis package must register it with the Harness runtime.

The Electrobun enterprise profile overrides the Web bundle's existing `agent-presets` entry rather than inserting a duplicate Loader id. It keeps the shipped root for the `standard` default, adds an explicit user-trust root at `<organization DSH_HOME>/.agent-presets`, and disables the derived personal home root. The roster discovers both built-in and managed plugin presets without reading unrelated personal preset files. The real profile boot tests cover startup with and without configured models.

Activation checks package-fiber ownership of Tool and Skill registrations and projects Tool schemas before committing readiness. MCP evidence includes owned connection status and discovered tools. Client diagnostics require live slot registrations from each module. Agent preset files and standing preset mounts leave with activation; AgentPresets owns composition and child inheritance. Failed upgrades restore the preceding usable product unless the current permission revision forbids it. Keyless Agent acceptance replays persisted Session events against the actual model request, rather than treating a market label as capability evidence.

The independent `cordis-reference` acceptance product starts a bundled loopback MCP server on an OS-assigned port when installation configuration omits `mcpUrl`. The Host fiber owns its listener and MCP sessions. An explicit `mcpUrl` selects an external server and still fails activation on connection errors. The opt-in actual-ZIP regression uses an empty installation configuration, verifies keyless model requests, and checks that disabling the product closes the listener. Synthetic composition fixtures alone cannot prove that a published product starts with marketplace defaults.

Client slot verification reads the live Cordis slot spec. A manifest contribution id selects the registered `key` in a keyed slot and the registered `id` in a list slot; it is not a separate UI label. The actual Media Canvas ZIP regression covers both selectors, the Client readiness report, and disposal. Invalid selectors fail activation and release the mounted bundle. This preserves Cordis registration semantics without adding another registry.

Verified MCP products declare their connection URL and authorization mode separately from runtime entry configuration. The market exposes only human-supplied fields and keeps official URLs fixed. OAuth grants use MCP SDK discovery, dynamic registration, PKCE and a state-validated loopback callback. Before saving a grant, the Host rechecks installation ownership and permission revision. Cancellation, replacement, uninstall and Host disposal invalidate pending authorization. The HTTP MCP bridge receives a process-local OAuth provider, so refresh persists through the installation credential facade. Missing authorization remains non-ready and is presented as a connection requirement. SDK fixture tests verify callback state, code exchange, Host persistence and listener cleanup; Client regressions cover login, Token and self-hosted URL inputs. Real service login requires the user’s account. On native desktop, the Host opens the OAuth URL through the allow-listed external-link bridge; the WebView `window.open` path remains the browser deployment fallback. The Client assigns each connection dialog an authorization generation, cancels its Host flow on close, and ignores late discovery results so a second MCP connection cannot inherit the first service’s browser state.

MCP authorization discovery follows the initial service response’s `WWW-Authenticate` metadata URL and scope, so query parameters and a separate authorization domain survive discovery. Verified product metadata owns exceptions for an authorization metadata document hosted away from its issuer and a missing `response_types_supported` field. Explicit response types are never replaced, and the MCP SDK still validates metadata, PKCE and tokens. The discovery record stays in Host credentials with the grant, allowing refresh to reuse the same provider information. Reconnection writes `auth: oauth` over a saved Token mode. Stage-specific error codes reach localized Client messages; upstream bodies and token errors remain outside the browser bridge.

## Alternatives considered

- **Isolate every package in a worker or subprocess** — deferred because native Cordis services and Loader fibers share the Host process. This design trusts uploaded Host code; SDK permissions do not restrict arbitrary Node access. Untrusted packages require a separate execution environment.
- **Put all work integrations in the Harness repository** — rejected because independent ZIP installation and upgrades require a separate source workspace and package identity.
- **Keep package permissions unchanged and encode capabilities in README text** — rejected because the Host cannot enforce an undocumented network, credential, MCP, or Skill request.

## Consequences

Native quit requests, including Electrobun's signal handlers, pass through a synchronous `before-quit` veto until desktop cleanup completes. Cleanup stops the owned DSH process group before permitting native exit. Failed cleanup keeps the application alive and permits another quit request; unit tests synchronize on cleanup completion and verify retry behavior. A process signal listener alone cannot guarantee this ordering because Electrobun also handles the signal and can exit before asynchronous cleanup finishes.

- Existing plugins remain compatible because new SDK properties are optional and old manifests continue to parse.
- Third-party service acceptance requires its configuration and credentials. Missing configuration fails visibly; fixture calls prove runtime integration, not access to a real external account.
- The marketplace accepts user-selected local ZIPs without executing source. Native workspace discovery remains available to installers, but opening the marketplace does not publish discovered packages; platform administrators publish ZIPs through their own upload and approval flow.
- New capability implementations must enforce the declared policy at the Host transport and must keep secrets out of Client bundles, logs, and tool results.
