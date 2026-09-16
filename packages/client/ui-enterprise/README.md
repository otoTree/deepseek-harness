---
description: "Enterprise account and governed plugin views embedded in the existing DSH Web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-client

English | [中文](README.zh.md)

## Summary

This Cordis client plugin adds organization account, platform model, usage, device, and published-plugin views to the existing DSH Web settings shell. It keeps the user-facing layout and interaction from [the Web client](../../../apps/web/src/main.ts); it does not render the administration console.

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

The enterprise desktop profile inserts this plugin after the Web bundle and injects the local `connection` handle. The host side reads the organization credential from macOS Keychain, calls the enterprise API, validates response records with Zod, and returns only browser-safe account and catalog data.

The plugin is a profile component, not a second chat application. The Web profile owns chat, sessions, tools, workspace, attachments, plans, goals, jobs, search, export, and schedule views. Enterprise policy disables local model and personal plugin settings before this plugin is loaded. The enterprise Models page lists the enabled platform catalog and writes the selected `enterprise` model through the native host; the gateway checks platform availability on every call.

<a id="browser-bridge"></a>
## Browser bridge

The bridge exposes dashboard reads, platform model selection, published plugin catalog reads, and device revocation through the local Connection RPC channel. Runtime tokens stay in the host process and never enter WebView state, command arguments, or plugin environment variables. The host checks the Keychain credential's API origin and organization binding before each request; the enterprise API checks the current server-side Runtime lease. The login response's `leaseUntil` field is only an initial lease snapshot because the native heartbeat renews the server record without rewriting Keychain. Responses remain size-limited before browser-safe data returns.

Account actions use localized dictionaries registered in the existing Web locale service. Device revocation requires a second click, and failed requests remain visible to the user. The native shell owns organization switching and logout so it can stop the old runtime and remove its Keychain credential.

<a id="verification"></a>
## Verification

Run the host and client suites from this package:

```sh
pnpm --filter @deepseek-ai/dsh-enterprise-client test
```

The host tests verify credential isolation and fail-closed authorization. The jsdom suite verifies settings-slot registration, Chinese rendering, platform model and usage display, device confirmation, and the published catalog fields.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Host-owned default-model selection applied to later requests.

#### KV Cache effect

Changing the selected model starts a request in that provider and model's cache namespace; the browser views themselves do not change prompt tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This plugin does not implement administration operations, SSO, SCIM, billing settlement, or public marketplace publishing.
- The catalog lists published records but does not install, activate, hot-swap, or revoke a plugin in the local loader; those checks remain owned by the desktop plugin manager.
- The dashboard currently aggregates personal usage in the client. Organization-wide reporting and session content access belong to the administration console and API.
- A working enterprise API, Keychain helper, and organization-scoped desktop runtime are required. The browser plugin cannot authenticate by itself.

<a id="dev-note"></a>
### Dev Note

The [enterprise platform blueprint](../../../docs/developer/discussion/enterprise-agent-platform.md) defines the product allocation. The [desktop README](../../../apps/electrobun/README.md) documents the native host and its release checks.
