# Cookbook: developing an enterprise composition plugin

English | [中文](developing-an-enterprise-composition-plugin.zh.md)

This guide describes the authoring path for a trusted enterprise plugin that composes Host and Client contributions into one published release. It covers the manifest, target boundaries, installation-scoped SDK, package archive, lifecycle, tests, and index maintenance. Read [the enterprise plugin model](../enterprise-plugins.md), [the installation lifecycle](../developer/plugin-installation-lifecycle.md), and [the plugin data SDK](../developer/plugin-data-sdk.md) first; the [`plugin/acceptance` fixture](../../packages/plugin/acceptance/README.md) is the reference implementation.

## Table of Contents

- [Define the enterprise composition](#define-the-enterprise-composition)
- [Choose Host and Client targets](#choose-host-and-client-targets)
- [Design contributions and permissions](#design-contributions-and-permissions)
- [Build the package archive](#build-the-package-archive)
- [Use the installation-scoped SDK](#use-the-installation-scoped-sdk)
- [Handle activation and lifecycle](#handle-activation-and-lifecycle)
- [Test the complete release](#test-the-complete-release)
- [Document and index the plugin](#document-and-index-the-plugin)
- [Verification](#verification)

-----

<a id="define-the-enterprise-composition"></a>
## 1. Define the enterprise composition

State the plugin's product responsibility and its release identity before writing target code. One enterprise release has a stable `pluginId`, a semantic `version`, a manifest, one or both executable targets, and an immutable archive. The release is installed and revoked as a unit, while each target is enabled and activated on a device independently.

Keep enterprise composition separate from an ordinary workspace package. A workspace package is resolved by the repository loader and aggregate TypeScript builds; an enterprise plugin is delivered as a validated `.dsh-plugin.zip` and loaded by the enterprise API and desktop runtime. The package may reuse shared protocol, SDK, and runtime libraries, but it must not assume access to the host repository's private services.

Use the acceptance fixture as the smallest complete example: its Host target registers a model-facing tool, its Client target contributes a settings panel, both targets call the installation-scoped SDK, and two manifests exercise upgrade and migration behavior.

<a id="choose-host-and-client-targets"></a>
## 2. Choose Host and Client targets

Declare only the target that owns each capability. A Host target runs outside the WebView with a constrained SDK and may perform business operations under enterprise policy. A Client target runs in the Web profile and contributes UI through the Client slot, locale, and Connection contracts. Client code cannot read runtime tokens, Keychain data, provider secrets, or arbitrary local files.

| Target | Entry | Valid responsibilities | Prohibited assumptions |
| --- | --- | --- | --- |
| `host` | `host/<file>.js` | Host services, model-facing tools, privileged orchestration through the SDK, and Host-side lifecycle. | Browser state, Client UI objects, or unlisted platform credentials. |
| `client` | `client/<file>.js` | Slot or window contributions, locale registration, user interaction, and calls through the injected SDK or Host bridge. | Direct filesystem access, provider credentials, Keychain access, or trusted Host state. |

A linked plugin may declare both targets, but the target entries remain separate and the platform verifies each target before activation. Cloud targets are not supported by the current manifest parser or desktop marketplace. Do not encode a `cloud` target as a future-compatible shortcut.

<a id="design-contributions-and-permissions"></a>
## 3. Design contributions and permissions

Treat the manifest as the reviewable declaration of executable behavior. Every capability requested by code must have a corresponding permission, resource declaration, target contribution, and test. The runtime checks permission and resource access again on every SDK call; declaring a resource does not grant permission by itself.

The schema version 2 manifest contains these fields:

| Field | Authoring rule |
| --- | --- |
| `schemaVersion`, `pluginId`, `name`, `version` | Use schema `2`, a stable lower-case plugin id, a user-facing name, and a new semantic version for every immutable release. |
| `targets` | Declare one or two `client`/`host` descriptors with `entry`, `compatibility`, and target-specific contributions. |
| `permissions` | Request the smallest set of `identity.read`, `models.text`, `models.media`, `objects.*`, `database.*`, and `cache.*` permissions required by the code. |
| `resources` | Declare each of `objects`, `database`, and `cache` at most once, with a positive byte quota when bounded storage is needed. |
| `sdk` | Pin the supported SDK version range when the plugin depends on a specific capability revision. |
| `migrations` | Use strictly increasing positive versions and parameter-free statements owned by the plugin data space. |
| `dependencies` | Record runtime package dependencies required by the target bundle. |
| `build` | Record the build runtime and the SHA-256 digest of the lockfile used to produce the archive. |

For a Client contribution, use a unique id and either a `slot` with `one` or `many` multiplicity, or a `window` with a surface, title key, shell, multiplicity, and optional bounded default size. A contribution id is part of the installed target contract; changing it requires a deliberate release and UI migration decision.

Do not use a manifest contribution to smuggle an undeclared RPC or privileged operation. Server code owns data access and privileged actions. A Host/Client link uses authenticated, size-limited RPC or the declared Connection contract, and the Client receives only the projection it needs.

<a id="build-the-package-archive"></a>
## 4. Build the package archive

The standard archive root contains `manifest.json`, `integrity.json`, the declared `client/<file>.js` and `host/<file>.js` entries, and any declared assets. The API rejects unsafe paths, duplicate entries, missing integrity records, digest mismatches, unknown targets, and archive files not represented by the integrity map.

Build the Host and Client bundles from source, then write the current lockfile digest into the manifest before packaging. Hash every archive entry except `integrity.json`, write those hashes into `integrity.json`, and create an immutable `.dsh-plugin.zip`. The desktop verifier compares the downloaded archive, manifest digest, permission digest, plugin id, and version with the published release before Host activation.

The repository fixture demonstrates this sequence in [`packages/plugin/acceptance/scripts/package.ts`](../../packages/plugin/acceptance/scripts/package.ts). Its package scripts are:

```sh
pnpm --filter @deepseek-ai/dsh-plugin-acceptance build
pnpm --filter @deepseek-ai/dsh-plugin-acceptance test:package
```

Use the fixture's archive layout and verification script as a reference, not as a production packaging dependency. A production publisher must keep its build runtime, lockfile, manifest, archive, and release metadata reproducible.

<a id="use-the-installation-scoped-sdk"></a>
## 5. Use the installation-scoped SDK

Import `@deepseek-ai/dsh-plugin-sdk` and consume the `PluginSdk` injected by the target runtime. The SDK transport carries no platform, database, object-store, or provider credential. Every call is bound to the activation that created the SDK and is rejected after revocation, permission revision changes, expiry, quota failure, or target mismatch.

Use the SDK capabilities deliberately:

- `identity.current()` reads the current user and organization context; it cannot read another user by supplied id.
- `models.list()`, `models.text()`, `models.textStream()`, and model task methods use the enabled model catalog and require the matching model permission.
- `objects` provides versioned, installation-scoped content; it does not create public URLs that bypass revocation.
- `database` accepts parameterized SQL and bounded transaction batches in the installation schema; platform database access is not available.
- `cache` provides namespaced, TTL-capable temporary state and is not an authorization, billing, or sole business-data store.

Pass `AbortSignal` through every supported call. Use a fresh idempotency key for a new operation and reuse the same key only when retrying that idempotent operation. Handle stable `plugin/*` errors as product states, not as provider-specific strings. Do not put secrets in Client bundles, manifests, object keys, or model-visible tool results.

<a id="handle-activation-and-lifecycle"></a>
## 6. Handle activation and lifecycle

Treat publication, installation, target enablement, activation, upgrade, disablement, and uninstall as separate states. Publication makes a release eligible for the catalog; installation creates a stable data space without enabling targets; device enablement records desired state; activation returns a short-lived credential; runtime requests revalidate the activation, installation, release, device target, membership, and permission revision.

The target runtime must:

1. Verify the immutable release and target entry before importing code.
2. Register all Cordis contributions through effects owned by the target fiber.
3. Stop accepting new work when disable, revoke, upgrade, disconnect, or unload begins.
4. Await disposers and report cleanup failures; never keep an untracked listener, window, tool, or worker alive.
5. Treat a new activation or permission revision as a new capability context; do not cache an old SDK credential indefinitely.

Upgrades run through a maintenance window. Existing activations are revoked, migrations apply in the installation data-space transaction, and the new release becomes active only after verification. A migration failure keeps the installation on its previous release. Uninstall revokes activations but retains the data space for the platform's separate data-deletion operation.

<a id="test-the-complete-release"></a>
## 7. Test the complete release

Test the archive and both targets together. The minimum acceptance matrix includes:

1. Manifest acceptance and rejection: missing files, unsafe paths, duplicate entries, unknown targets, duplicate permissions/resources, non-increasing migrations, missing integrity entries, and digest mismatch.
2. Host behavior: SDK permission checks, model and data calls, tool registration, cancellation, stable error projection, and disposal after target unload.
3. Client behavior: module-table loading, contribution registration, locale or slot output, absence of credentials, and removal after Client target disposal.
4. Lifecycle behavior: install without enablement, activation lease expiry, revocation, permission revision mismatch, upgrade confirmation, migration rollback, and uninstall retention.
5. Product behavior: real Host/Client composition through the enterprise runtime, model-visible tool output through Session events, and UI output through the declared Client slot or window.

Keep package validation tests at the archive boundary and runtime tests at the target boundary. Mock external model or storage services only where the acceptance contract does not own them. A test that loads a function directly does not prove archive verification, target binding, or lifecycle cleanup.

<a id="document-and-index-the-plugin"></a>
## 8. Document and index the plugin

The plugin README documents its target matrix, manifest permissions and resources, SDK calls, model and UI effects, migrations, lifecycle limitations, and release verification. Link to [the enterprise model](../enterprise-plugins.md), [the lifecycle reference](../developer/plugin-installation-lifecycle.md), and [the SDK reference](../developer/plugin-data-sdk.md) instead of duplicating their complete contracts.

Update [the development index](../development-index.md) in the same change when the plugin adds a package, target entry, Client contribution, SDK capability, build script, acceptance fixture, or release path. Add the plugin to the enterprise composition row, link its source package and verification scripts, and update the ordinary independent-plugin row only when the plugin also introduces a general Cordis capability. Re-record the English/Chinese index pair after the entries agree.

<a id="verification"></a>
## Verification

Run the fixture's focused checks or the equivalent commands for the plugin, then run the repository checks covering the changed contracts:

```sh
pnpm --filter @deepseek-ai/dsh-plugin-acceptance build
pnpm --filter @deepseek-ai/dsh-plugin-acceptance test:package
pnpm run test:docs
pnpm run doc-sync
git diff --check
```

Run the enterprise API and desktop acceptance suites when the change affects publication, activation, package verification, Host loading, Client loading, or lifecycle state. A green package parse is not evidence that a target can activate, use its SDK permissions, or unload cleanly.

An enterprise composition plugin is complete only when its archive, target boundaries, declared capabilities, activation lifecycle, cleanup behavior, tests, package contract, and development-index entry agree.
