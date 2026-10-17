# Cookbook: developing an enterprise composition plugin

English | [中文](developing-an-enterprise-composition-plugin.zh.md)

This guide describes the authoring path for a trusted enterprise plugin that composes Host and Client contributions into one published release. It covers the manifest, target boundaries, installation-scoped SDK, package archive, lifecycle, tests, and index maintenance. Read [the enterprise plugin model](../enterprise-plugins.md), [the installation lifecycle](../developer/plugin-installation-lifecycle.md), and [the plugin data SDK](../developer/plugin-data-sdk.md) first; the [`plugin/acceptance` fixture](../../packages/plugin/acceptance/README.md) is a platform-maintainer reference.

## Table of Contents

- [Start in a standalone workspace](#start-in-a-standalone-workspace)
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

<a id="start-in-a-standalone-workspace"></a>
## 0. Start in a standalone workspace

Develop the plugin in a repository that you control. The Harness repository is not a build dependency for an enterprise plugin. Your workspace needs Node.js 22 or a later supported version, a package manager, TypeScript or JavaScript, a bundler, the versioned public plugin packages, and a ZIP/hash implementation. The platform supplies the runtime, authorization, credentials, Agent registries, Client slots, and release verification after installation.

Use the versioned public artifacts for `@deepseek-ai/dsh-plugin-protocol` and `@deepseek-ai/dsh-plugin-sdk` that match the platform compatibility range. The platform SDK distribution supplies these artifacts through its configured registry or release archive. `@deepseek-ai/dsh-tools` is optional when you want typed tool helpers. `@deepseek-ai/dsh-plugin-runtime` is a platform-owned loader and fixture package; it is optional for local tests and is not required by a shipped entry. If a deployment does not expose the public distribution, ask its platform administrator for the versioned SDK bundle; do not copy Harness source directories. Use `@deepseek-ai/cordis` as the peer runtime contract. Do not import from `apps/`, `packages/`, `.artifacts/`, the platform database, the desktop source tree, or `/Users/hjr/Desktop/plugins`; those paths belong to a Harness checkout and are not part of the external authoring contract.

A standalone workspace can use this layout:

```text
my-plugin/
  package.json
  manifest.json
  packages/core/package.json
  src/host.ts                 # omit for a Client-only release
  src/client.ts               # omit for a Host-only release
  scripts/build.mjs
  scripts/package.mjs
  scripts/verify.mjs
  dist/my-plugin-1.0.0.dsh-plugin.zip
```

The Host entry exports a Cordis function plugin and receives the installation-scoped SDK through its declared injection. The Client entry exports a Cordis function plugin and receives the Client SDK and slot services through its declared injection. A plugin can contain either entry or both; multiple Cordis packages and multiple Client entries are expressed in one product manifest. The entry does not import a Harness application or start an Agent loop:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { PluginSdk } from '@deepseek-ai/dsh-plugin-sdk'

export const name = 'acme-report-host'
export const inject = ['pluginSdk', 'tools']

export function apply(ctx: Context & { pluginSdk: PluginSdk }): void {
  const dispose = ctx.tools.register({
    name: 'acme_report',
    description: 'Read the current Acme report.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(_args, exec) {
      const identity = await ctx.pluginSdk.identity.current(exec.signal)
      return `Report for ${identity.organizationId}`
    },
  })
  ctx.effect(() => dispose)
}
```

The platform injects `pluginSdk` and the shared `tools` registry when it loads the entry. Register tools, Skills, MCP clients, and other services from `apply`; Cordis owns their effect lifetime. Use the public `@deepseek-ai/dsh-tools` types or raw JSON Schema when the tool needs stricter typing. A Client entry follows the same pattern with the public Client slot service. The platform-owned `@deepseek-ai/dsh-plugin-runtime` package is for the loader and fixture harness; an author normally does not call `mountPluginTarget` or `bindPluginSdk` from the shipped entry.

The standalone authoring boundary is strict: the ZIP is the only product input sent to the platform, and the installed runtime is the only source of platform services. A local mock may implement the public SDK transport for tests, but it must not be treated as a platform implementation.

For a ready-to-copy mixed documentation and code workspace, use the [enterprise plugin development kit](enterprise-plugin-kit/README.md). It includes the versioned SDK archives, the current Client Slot catalog, a standard Host/Client/Skill/MCP sample, an Agent preset, and package verification scripts. The same directory contains the [downloadable kit ZIP](enterprise-plugin-kit/dist/enterprise-plugin-kit-0.1.0.zip) and the sample plugin artifact.

<a id="define-the-enterprise-composition"></a>
## 1. Define the enterprise composition

State the plugin's product responsibility and its release identity before writing target code. A public enterprise release has a stable `pluginId`, a semantic `version`, a manifest, one or both executable targets, and an immutable archive. Private development uploads may replace the same plugin ID and version; publish a new semantic version before sharing a release. The release is installed and revoked as a unit, while each target is enabled and activated on a device independently.

Keep enterprise composition separate from an ordinary workspace package. A workspace package is resolved by the repository loader and aggregate TypeScript builds; an enterprise plugin is delivered as a validated `.dsh-plugin.zip` and loaded by the enterprise API and desktop runtime. The package may reuse shared protocol, SDK, and runtime libraries, but it must not assume access to the host repository's private services.

Use the acceptance fixture as the smallest complete example: its Host target registers a model-facing tool, its Client target contributes a settings panel, both targets call the installation-scoped SDK, and two manifests exercise upgrade and migration behavior.

<a id="choose-host-and-client-targets"></a>
## 2. Choose Host and Client targets

Declare only the target that owns each capability. A Host target runs outside the WebView with a constrained SDK and may perform business operations under enterprise policy. A Client target runs in the Web profile and contributes UI through the Client slot, locale, and Connection contracts. Client code cannot read runtime tokens, Keychain data, provider secrets, or arbitrary local files.

| Target | Entry | Valid responsibilities | Prohibited assumptions |
| --- | --- | --- | --- |
| `host` | The `entry` declared by the manifest or Cordis package, normally under `packages/<package-id>/host/`. | Host services, model-facing tools, privileged orchestration through the SDK, and Host-side lifecycle. | Browser state, Client UI objects, or unlisted platform credentials. |
| `client` | The `entry` declared by the manifest or Cordis package, normally under `packages/<package-id>/client/`. | Slot or window contributions, locale registration, user interaction, and calls through the injected SDK or Host bridge. | Direct filesystem access, provider credentials, Keychain access, or trusted Host state. |

A linked plugin may declare both targets, but the target entries remain separate and the platform verifies each target before activation. Cloud targets are not supported by the current manifest parser or desktop marketplace. Do not encode a `cloud` target as a future-compatible shortcut.

<a id="design-contributions-and-permissions"></a>
## 3. Design contributions and permissions

Treat the manifest as the reviewable declaration of executable behavior. Every capability requested by code must have a corresponding permission, resource declaration, target contribution, and test. The runtime checks permission and resource access again on every SDK call; declaring a resource does not grant permission by itself.

Use schema version 3 for new products. Schema version 2 remains a compatibility format for products with top-level targets; the platform accepts both formats but does not infer missing package metadata.

The manifest contains these fields:

| Field | Authoring rule |
| --- | --- |
| `schemaVersion`, `pluginId`, `name`, `version` | Use schema `3`, a stable lower-case plugin id, a user-facing name, and a new semantic version for every public immutable release. During private development, re-uploading the same version replaces that private release. |
| `packages` | In schema `3`, declare each Cordis package with its package metadata, dependencies, targets, and optional preset files. A product may contain multiple Host and Client packages. |
| `targets` | In schema `2`, declare one or two top-level `client`/`host` descriptors with `entry`, `compatibility`, and target-specific contributions. Schema `3` puts these descriptors under `packages`. |
| `permissions` | Request the smallest set of `identity.read`, `models.text`, `models.media`, `objects.*`, `database.*`, and `cache.*` permissions required by the code. |
| `resources` | Declare each of `objects`, `database`, and `cache` at most once, with a positive byte quota when bounded storage is needed. |
| `sdk` | Pin the supported SDK version range when the plugin depends on a specific capability revision. |
| `migrations` | Use strictly increasing positive versions and parameter-free statements owned by the plugin data space. |
| `dependencies` | Record runtime package dependencies required by the target bundle. |
| `build` | Record the build runtime and the SHA-256 digest of the lockfile used to produce the archive. |

A minimal schema v3 manifest looks like this:

```json
{
  "schemaVersion": 3,
  "pluginId": "acme-report",
  "name": "Acme report",
  "version": "1.0.0",
  "permissions": ["identity.read"],
  "resources": [],
  "packages": [{
    "id": "core",
    "name": "@acme/acme-report-core",
    "version": "1.0.0",
    "dependencies": {},
    "targets": [{
      "kind": "host",
      "entry": "packages/core/host/index.js",
      "compatibility": "dsh-host>=1",
      "contributions": ["tool:acme_report"]
    }]
  }],
  "build": {
    "runtime": "node22",
    "lockfileDigest": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

The zero digest above is only a placeholder for the example. The package script must replace it with the SHA-256 digest of the lockfile used for the build. The corresponding archive must contain this file:

```json
{
  "name": "@acme/acme-report-core",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {}
}
```

For a Client contribution, use a unique id and either a `slot` with `one` or `many` multiplicity, or a `window` with a surface, title key, shell, multiplicity, and optional bounded default size. A contribution id is part of the installed target contract; changing it requires a deliberate release and UI migration decision.

Do not use a manifest contribution to smuggle an undeclared RPC or privileged operation. Server code owns data access and privileged actions. A Host/Client link uses authenticated, size-limited RPC or the declared Connection contract, and the Client receives only the projection it needs.

<a id="build-the-package-archive"></a>
## 4. Build the package archive

For schema v2, the standard archive root contains `manifest.json`, `integrity.json`, the declared `client/<file>.js` and `host/<file>.js` entries, and any declared assets. For schema v3, entries and package metadata live below `packages/<package-id>/`; the root still contains `manifest.json` and `integrity.json`. The API rejects unsafe paths, duplicate entries, missing integrity records, digest mismatches, unknown targets, and archive files not represented by the integrity map.

Build the Host and Client bundles from source, then write the current lockfile digest into the manifest before packaging. Hash every archive entry except `integrity.json`, write those hashes into `integrity.json`, and create an immutable `.dsh-plugin.zip`. The desktop verifier compares the downloaded archive, manifest digest, permission digest, plugin id, and version with the published release before Host activation.

Build the archive in your own workspace. Your packaging script must perform the following sequence without importing Harness source:

1. Bundle each declared Host and Client entry with its production dependencies. Keep Harness-native packages external when the platform provides them as runtime services.
2. Write the exact target paths and package metadata into the manifest. For schema v3, include one `packages/<package-id>/package.json` for every Cordis package and make its name, version, dependencies, and targets match the manifest.
3. Include `manifest.json`, every declared entry, every preset or asset, and `integrity.json` at the ZIP root.
4. Hash every entry except `integrity.json`, write the hashes into `integrity.json`, and compute the archive digest used by your release record.
5. Reopen the ZIP from `dist/`, validate paths and hashes, and fail the build when a declared entry is missing or an undeclared file is present.

The acceptance fixture in [`packages/plugin/acceptance`](../../packages/plugin/acceptance) is a platform-maintainer reference for these checks. It is not a dependency of an external plugin and its workspace scripts must not appear in an external plugin's package manifest.

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

The plugin README documents its target matrix, manifest permissions and resources, SDK calls, model and UI effects, migrations, lifecycle limitations, and release verification. State the external prerequisites and the exact build command for your own workspace. Link to [the enterprise model](../enterprise-plugins.md), [the lifecycle reference](../developer/plugin-installation-lifecycle.md), and [the SDK reference](../developer/plugin-data-sdk.md) instead of duplicating their complete contracts.

Submit the finished ZIP through the platform administrator's upload and approval flow. The platform validates the manifest, integrity map, package dependencies, target entries, permissions, and compatibility before publication. Installation users need only the published release; they do not need your source repository, your build toolchain, or a Harness checkout.

Update [the development index](../development-index.md) in the same change when the plugin adds a package, target entry, Client contribution, SDK capability, build script, acceptance fixture, or release path. Add the plugin to the enterprise composition row, link its source package and verification scripts, and update the ordinary independent-plugin row only when the plugin also introduces a general Cordis capability. Re-record the English/Chinese index pair after the entries agree.

<a id="verification"></a>
## Verification

Run the scripts defined by your standalone workspace, then run the platform checks covering the published archive:

```sh
pnpm run build
pnpm test
pnpm run verify:package
```

`verify:package` is an author-owned script that must reopen the generated ZIP and verify the manifest, package metadata, entries, paths, and integrity map. The platform administrator or CI owner runs the enterprise API and desktop acceptance suites when the change affects publication, activation, package verification, Host loading, Client loading, or lifecycle state. A green package parse is not evidence that a target can activate, use its SDK permissions, or unload cleanly.

An enterprise composition plugin is complete only when its archive, target boundaries, declared capabilities, activation lifecycle, cleanup behavior, tests, package contract, and development-index entry agree.
