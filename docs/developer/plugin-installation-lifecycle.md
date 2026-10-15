---
description: "Current installation, activation, upgrade, disable, and uninstall behavior for trusted enterprise Cordis plugins."
---

# Plugin Installation and Runtime Lifecycle

English | [中文](plugin-installation-lifecycle.zh.md)

This reference describes the lifecycle implemented by the enterprise API for trusted Cordis plugins. The runtime executes plugin code in the existing Host or Client process; manifest permissions authorize platform capabilities but do not isolate malicious code in the same process.

## Records

The platform keeps one release record, one installation record, device target records, short-lived activation records, and lifecycle state. Public releases are immutable. An owner may re-upload a private release with the same plugin ID and version; identical bytes are idempotent, while changed bytes replace the private artifact in place, advance the permission revision, and revoke existing activations so devices reload it. An installation has a stable data space and permission revision. The desired state records what the owner requested; the observed state records what a device has reported.

Personal installations are managed by the account owner. Organization installations are managed by an owner or administrator, while members choose which of their devices enable a target. An organization installation is visible to its members and can be revoked by an administrator.

## Control-plane operations

`POST /v1/organizations/:organizationId/plugins/:id/install` creates an installation without enabling a target. `PATCH /plugins/installations/:id` changes the account-level desired state. `PUT /plugins/installations/:id/devices/:deviceId` changes one device target, and `POST /plugins/installations/:id/activate` returns a short-lived activation credential after the device request is enabled.

Every runtime request uses `Bearer` activation credentials and rechecks the activation, installation, release, device target, membership, and permission revision. Deactivation, uninstall, release revocation, or an organization membership change invalidates the credential. A heartbeat carries its activation id and can update state only while that activation still matches the device release and permission revision. Minting a replacement lease revokes the previous lease for the same device target.

Upgrades use a maintenance window. The API requires a published release and explicit confirmation when its permissions add a new entry. Existing activations are revoked, the permission revision advances, and devices return to preparation. Uninstall revokes activations and retains the data space. Export, data deletion, and reauthorization are separate audited operations.

## Runtime targets

The market release is a ZIP container; schema v2 contains top-level targets, while schema v3 contains Cordis packages with their own `package.json` and Host or Client targets. The desktop verifies the manifest, archive digest, integrity records, package metadata, and target entries before activation. Host packages are written under the organization DSH Home and loaded as a Cordis group through `ctx.loader`; Cordis fibers own each package's registrations and disposal. Package imports may use Node built-ins, `@deepseek-ai/cordis`, or dependencies declared by the package and provided by the Harness installation.

The browser receives each active Client bundle from the Host and mounts it through the module loader. A product release can provide multiple Host packages and multiple Client bundles. Each Client bundle is keyed and unloaded independently, and its `slot` or `window` contributions follow its Cordis fiber. Client code reaches the API through its Host bridge and does not receive platform or provider credentials. Tools and Skills become Agent-visible when their Cordis packages register them with the Harness registries; an archive declaration alone does not prove that a capability is active.

Activation verifies Tool and Skill registrations owned by the package fibers and projects Tool schemas before committing readiness. MCP readiness requires an owned connected client and discovered tools; matching names alone are insufficient. The market also checks the current Skill catalog, preset discovery, and browser-reported `ctx.slots.entries()` registrations. Disablement removes the Loader group, owned preset files and standing preset mounts, then invalidates activation credentials. Product upgrades restore the previous usable composition when replacement loading fails; a revision mismatch prevents rollback under revoked permissions.

The SDK provides platform data operations, installation configuration, permission-checked HTTP and activation-scoped credentials. Trusted Host packages read only their own integration credentials through the credential facade; Client bundles do not receive those secrets. Harness-native Tool, Skill and MCP registrations remain Cordis effects. The SDK does not provide a jobs scheduler or a Cloud target.

## Recovery

The device repeats preparation after restart or reconnect. A failed stage remains visible through the installation and device state, including after the failed activation lease is revoked, and can be retried by enabling the installation again. Disabling an installation clears target failures. The server revokes credentials even when a local disposer fails; the desktop runtime reports that a Host restart is required when trusted code cannot stop.
