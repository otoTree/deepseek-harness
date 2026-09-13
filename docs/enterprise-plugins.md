# Enterprise Plugin Model

English | [中文](enterprise-plugins.zh.md)

This reference defines the three enterprise plugin kinds and the runtime boundaries that apply to each kind.

## Plugin kinds

### Server plugin

A server plugin contains only Host or server code. The platform loads it outside the WebView, supplies a constrained SDK, and runs its business methods under the enterprise permission and sandbox policy. A server plugin cannot add a Client page or read browser state.

### Client plugin

A client plugin contains only a Client bundle. It runs in the Web profile and contributes pages or controls through the Client slot, locale, and Connection contracts. It cannot read Runtime tokens, Keychain data, provider secrets, or arbitrary local files.

### Linked plugin

A linked plugin publishes one server bundle and one Client bundle. The server bundle runs in the platform sandbox and receives a platform-assigned service origin. The Client bundle calls that service through a constrained SDK; it does not receive the Runtime token or server credentials. Identity and model access are explicit, least-privilege capabilities supplied by the platform.

## Shared publication rules

The enterprise API stores a plugin manifest, artifact, permissions, digests, organization id, signature, publication status, and policy revision. Only a published, organization-matching release enters the enterprise catalog. Electrobun verifies these fields before loading a release.

The current catalog endpoint is `GET /v1/organizations/:organizationId/plugins/catalog`. The enterprise Client renders catalog records but does not install, activate, or hot-swap them.

## Client extension model

The existing Client extension point is the standard Web slot system. A plugin registers locale dictionaries and contributes a `settings.section` entry with explicit injected properties. `ui-enterprise` uses this mechanism for the enterprise account, model, and plugin pages, while shared primitives and Connection RPC remain reusable.

## Current implementation boundary

The repository implements publication records, signature verification, Host loading helpers, enterprise sandbox primitives, Client slots, locale registration, and Connection RPC. It does not yet provide a user-facing conversational plugin authoring flow, a general plugin SDK, linked-bundle service routing, subdomain allocation, or platform-managed identity and model capability injection.

## Design constraints

Server code owns data access and privileged operations. Client code owns presentation and user interaction. A linked plugin crosses the two sides only through declared, authenticated, size-limited RPC methods. Every requested capability belongs in the manifest and is checked before execution.

The three kinds should remain distinct in manifests and build outputs: `server` publishes only the server bundle, `client` publishes only the Client bundle, and `linked` publishes both with an explicit association. This classification prevents a Client bundle from becoming an undeclared privileged provider and lets review, signing, deployment, and revocation apply to each executable part.

## Further exploration

- [API Gateway](api-gateway.md)
- [Enterprise Client package](../packages/client/ui-enterprise/README.md)
- [Enterprise plugin API](../apps/api/src/plugins.ts)
- [Electrobun plugin verification](../apps/electrobun/src/plugin-verifier.ts)

## Dev Note

This page records the current architecture and the intended three-kind vocabulary. The conversational authoring flow and linked-plugin capability injection remain design work and are not product behavior.
