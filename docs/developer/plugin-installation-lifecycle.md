---
description: "Current installation, activation, upgrade, disable, and uninstall behavior for trusted enterprise Cordis plugins."
---

# Plugin Installation and Runtime Lifecycle

English | [中文](plugin-installation-lifecycle.zh.md)

This reference describes the lifecycle implemented by the enterprise API for trusted Cordis plugins. The runtime executes plugin code in the existing Host or Client process; manifest permissions authorize platform capabilities but do not isolate malicious code in the same process.

## Records

The platform keeps one immutable release record, one installation record, device target records, short-lived activation records, and lifecycle state. An installation has a stable data space and permission revision. The desired state records what the owner requested; the observed state records what a device has reported.

Personal installations are managed by the account owner. Organization installations are managed by an owner or administrator, while members choose which of their devices enable a target. An organization installation is visible to its members and can be revoked by an administrator.

## Control-plane operations

`POST /v1/organizations/:organizationId/plugins/:id/install` creates an installation without enabling a target. `PATCH /plugins/installations/:id` changes the account-level desired state. `PUT /plugins/installations/:id/devices/:deviceId` changes one device target, and `POST /plugins/installations/:id/activate` returns a short-lived activation credential after the device request is enabled.

Every runtime request uses `Bearer` activation credentials and rechecks the activation, installation, release, device target, membership, and permission revision. Deactivation, uninstall, release revocation, or an organization membership change invalidates the credential. A heartbeat carries its activation id and can update state only while that activation still matches the device release and permission revision. Minting a replacement lease revokes the previous lease for the same device target.

Upgrades use a maintenance window. The API requires a published release and explicit confirmation when its permissions add a new entry. Existing activations are revoked, the permission revision advances, and devices return to preparation. Uninstall revokes activations and retains the data space. Export, data deletion, and reauthorization are separate audited operations.

## Runtime targets

Host and Client targets receive an installation-scoped SDK after the loader has verified the immutable package. The desktop Host imports the verified Host target, while the browser imports Client source supplied by the Host and mounts its modules and slots. Contributions are registered through Cordis effects; disable, upgrade, disconnect, and unload await their disposers. Client code reaches the API through its Host bridge and does not receive platform or provider credentials.

The first SDK release exposes current user identity, text model listing and calls, object storage, restricted database queries and transactions, and namespaced cache operations. It does not expose queues, workers, scheduled jobs, background tasks, Cloud targets, or image and video generation.

## Recovery

The device repeats preparation after restart or reconnect. A failed stage remains visible through the installation and device state and can be retried by repeating the corresponding operation. The server revokes credentials even when a local disposer fails; the desktop runtime reports that a Host restart is required when trusted code cannot stop.
