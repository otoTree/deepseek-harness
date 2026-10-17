# Enterprise Plugin Model

English | [中文](enterprise-plugins.zh.md)

This reference defines the enterprise desktop plugin targets and the runtime boundaries that apply to each target.

## Plugin kinds

### Host plugin

Host packages run in the existing trusted DSH Node process and register Agent tools, Skills, MCP clients or other Cordis services. Platform SDK calls enforce manifest permissions; arbitrary same-process Node code is not sandboxed. Client contributions require separately declared Client bundles.

### Client plugin

A client plugin contains only a Client bundle. It runs in the Web profile and contributes pages or controls through the Client slot, locale, and Connection contracts. It cannot read Runtime tokens, Keychain data, provider secrets, or arbitrary local files.

### Cloud target

Cloud targets are reserved for a later phase. The first desktop marketplace rejects `cloud` in manifests and does not provide a cloud runtime, service route, or cloud installation path.

## Shared publication rules

The enterprise API stores a plugin manifest, artifact, permissions, digests, organization id, publication status, and policy revision. Only a published, organization-matching release enters the enterprise catalog. Electrobun verifies these fields before loading a release.

The desktop marketplace reads visible releases from the organization catalog and manages account-level installations. Private uploads publish for their creator; organization and public uploads enter their administrator review queues. Platform administrator uploads automatically approve the verified artifact digest. Only published, non-revoked releases are installable.

The ZIP root contains `manifest.json` and `integrity.json`. Schema v3 products contain multiple Cordis packages, each with a matching `package.json`, declared dependencies and Host or Client entries; schema v2 reads product-level entries. The API rejects unsafe paths, duplicate entries, invalid dependencies, missing entries and integrity mismatches. Published product versions are immutable and use content-addressed artifacts.

The enterprise Client contributes a sidebar marketplace action and a `main.surface` page. Installation downloads and verifies a release before the user enables Client or Host targets. Account synchronization carries release, configuration, target state, desired state, observed state, and permission revision; Keychain values and operating-system permissions remain device-local.

## Client extension model

The existing Client extension point is the standard Web slot system. A plugin registers locale dictionaries and contributes a `settings.section` entry with explicit injected properties. `ui-enterprise` uses this mechanism for the enterprise account, model, and plugin pages, while shared primitives and Connection RPC remain reusable.

## Current implementation boundary

The repository implements publication records, package validation, resource and migration declarations, object storage, digest verification, dynamic Host and Client target loading, Client slots, locale registration, marketplace navigation, installation and device activation records, short-lived runtime leases, and Connection RPC. The plugin protocol, author SDK, and Cordis runtime binding expose current identity, text models, objects, restricted SQL, and namespaced cache capabilities. Local enterprise infrastructure provisions a separate plugin PostgreSQL service, Redis, and MinIO. Cloud targets, linked-bundle service routing, subdomain allocation, and image or video generation remain outside the first runtime.

## Design constraints

Server code owns data access and privileged operations. Client code owns presentation and user interaction. A linked plugin crosses the two sides only through declared, authenticated, size-limited RPC methods. Every requested capability belongs in the manifest and is checked before execution.

The desktop manifest uses `client` and `host` target descriptors. A package may contain either target or both. This classification prevents a Client bundle from becoming an undeclared privileged provider and lets review, installation, and revocation apply to each executable part.

Schema v3 packages may declare preset files, which the Plugin Manager installs into the AgentPresets user root for discovery and composition. Presets compose tools and Skills without providing an Agent loop. Market diagnostics check owned Agent-visible Tool schemas, the Skill catalog, MCP connection and discovery, presets, and Client slot registrations. Missing or failed contributions keep their target non-ready.

## Further exploration

- [Enterprise composition plugin authoring guide](cookbook/developing-an-enterprise-composition-plugin.md)
- [Standalone enterprise plugin development kit](cookbook/enterprise-plugin-kit/README.md)
- [API Gateway](api-gateway.md)
- [Enterprise Client package](../packages/client/ui-enterprise/README.md)
- [Enterprise plugin API](../apps/api/src/plugins.ts)
- [Electrobun plugin verification](../apps/electrobun/src/plugin-verifier.ts)

## Dev Note

This page records the current architecture and the intended three-kind vocabulary. The conversational authoring flow and linked-plugin capability injection remain design work and are not product behavior.
