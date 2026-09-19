# Enterprise Plugin Model

English | [中文](enterprise-plugins.zh.md)

This reference defines the enterprise desktop plugin targets and the runtime boundaries that apply to each target.

## Plugin kinds

### Host plugin

A Host plugin contains only Host code. The desktop runtime loads it outside the WebView, supplies a constrained SDK, and runs its business methods under the enterprise permission and sandbox policy. A Host plugin cannot add a Client page or read browser state.

### Client plugin

A client plugin contains only a Client bundle. It runs in the Web profile and contributes pages or controls through the Client slot, locale, and Connection contracts. It cannot read Runtime tokens, Keychain data, provider secrets, or arbitrary local files.

### Cloud target

Cloud targets are reserved for a later phase. The first desktop marketplace rejects `cloud` in manifests and does not provide a cloud runtime, service route, or cloud installation path.

## Shared publication rules

The enterprise API stores a plugin manifest, artifact, permissions, digests, organization id, publication status, and policy revision. Only a published, organization-matching release enters the enterprise catalog. Electrobun verifies these fields before loading a release.

The desktop marketplace uses `GET /v1/organizations/:organizationId/plugins/catalog` for visible releases, `POST /plugins/packages` for standard `.dsh-plugin.zip` uploads, and account-level installation endpoints for install and enablement. Private releases publish immediately for their creator. Organization and platform releases enter their respective administrator review queues. A release is installable only after publication and before revocation.

The package root contains `manifest.json`, `integrity.json`, optional `client/entry.js`, optional `host/entry.js`, and `assets/`. The API rejects `cloud` and unknown targets, unsafe ZIP paths, duplicate entries, missing integrity records, and digest mismatches. Objects use an immutable content-addressed key. Electrobun compares the downloaded package, manifest, permissions, plugin id, and version with the published release metadata before Host activation. Publication does not require a signing key.

The enterprise Client contributes a sidebar marketplace action and a `main.surface` page. Installation downloads and verifies a release before the user enables Client or Host targets. Account synchronization carries release, configuration, target state, and enabled status; Keychain values and operating-system permissions remain device-local.

## Client extension model

The existing Client extension point is the standard Web slot system. A plugin registers locale dictionaries and contributes a `settings.section` entry with explicit injected properties. `ui-enterprise` uses this mechanism for the enterprise account, model, and plugin pages, while shared primitives and Connection RPC remain reusable.

## Current implementation boundary

The repository implements publication records, package validation, object storage, digest verification, Host loading helpers, enterprise sandbox primitives, Client slots, locale registration, marketplace navigation, installation records, and Connection RPC. It does not yet provide the Cloud target runtime, linked-bundle service routing, subdomain allocation, or platform-managed identity and model capability injection.

## Design constraints

Server code owns data access and privileged operations. Client code owns presentation and user interaction. A linked plugin crosses the two sides only through declared, authenticated, size-limited RPC methods. Every requested capability belongs in the manifest and is checked before execution.

The desktop manifest uses `client` and `host` target descriptors. A package may contain either target or both. This classification prevents a Client bundle from becoming an undeclared privileged provider and lets review, installation, and revocation apply to each executable part.

## Further exploration

- [API Gateway](api-gateway.md)
- [Enterprise Client package](../packages/client/ui-enterprise/README.md)
- [Enterprise plugin API](../apps/api/src/plugins.ts)
- [Electrobun plugin verification](../apps/electrobun/src/plugin-verifier.ts)

## Dev Note

This page records the current architecture and the intended three-kind vocabulary. The conversational authoring flow and linked-plugin capability injection remain design work and are not product behavior.
