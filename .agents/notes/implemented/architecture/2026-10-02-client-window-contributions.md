# Agent Note: Declarative Client contributions and window instances

Status: implemented

English | [中文](2026-10-02-client-window-contributions.zh.md)

## Problem

Enterprise plugins and dynamic Cordis packages need one Client artifact to contribute UI to every main window and to open controlled independent windows without creating another Host target or lease.

## Decision

Client manifests use structured `slot` and `window` contributions. The protocol validates unique contribution IDs, declared surfaces, locale keys, shell choices, multiplicity, and bounded default sizes. `ClientWindowRegistry` stores normalized definitions and ephemeral instances on the Host. `singleton` opens focus the existing instance; `many` opens a new instance. `ClientWindowService` exposes only contribution-ID based operations over the existing SDK transport, so plugin code cannot supply a URL, script path, or native window options.

Enterprise Client target reconciliation registers window definitions once and closes the plugin's instances before target disposal. The Host-owned SDK transport remains shared by the target. Client shells install the restricted service in their isolated Client Context when they expose window actions. Window instance failures are emitted as window-local errors and do not change the target lease state.

## Consequences

The same contribution model can be consumed by enterprise and dynamic Cordis runners. Host lifecycle remains installation-scoped, while window state is ephemeral and isolated. A native desktop adapter still supplies the `ClientWindowPlatform` callbacks; the runtime rejects window creation when no platform is attached instead of inventing a fallback window.

## Alternatives considered

- **Create a new Host target per window** — this duplicates leases and SDK transports and makes upgrade cleanup depend on native window count.
- **Accept arbitrary URLs or scripts from Client code** — this bypasses manifest verification and lets a plugin escape the registered artifact.
- **Use one global Client heartbeat for all windows** — one failed render or disconnect would incorrectly mark the shared Client target as failed.

## Verification

Protocol, API package parsing, runtime registry, and enterprise runtime tests cover structured contributions, duplicate rejection, singleton focus, many-instance isolation, undeclared contribution rejection, upgrade cleanup, and target lifecycle. TypeScript checks pass for the protocol, plugin runtime, and enterprise Client packages.
