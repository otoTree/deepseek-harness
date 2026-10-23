# Agent Note: Admin publication of signed desktop installers

Status: implemented

English | [中文](2026-10-21-admin-desktop-release-publication.zh.md)

## Problem

Platform administrators need to publish large desktop installers through the enterprise API without giving the web console or artifact storage authority to sign executable releases.

## Decision

The [Admin release page](../../../../apps/admin/app/desktop-releases-workspace.tsx) accepts an installer and its offline-signed envelope. The [API publisher](../../../../apps/api/src/desktop-releases.ts) uses the same [Ed25519 protocol parser](../../../../apps/api/src/desktop-release.ts) as the native updater. Deployment pins the public key; the private key remains outside the repository, browser, API and build inputs. Signed download URLs name the deployment API, target and semantic version exactly.

The API authorizes platform administrators before reading installer streams. It bounds bytes by the signed size, spools into a private temporary file, verifies SHA-256, then uploads to a fresh private MinIO key. A database transaction serializes publication per target, rechecks administrator authority and rejects equal or older semantic versions. Published rows cannot be overwritten. Anonymous read-only endpoints serve the highest published version and stream its immutable installer; drafts remain inaccessible. Feed selection uses semantic versions rather than timestamps. A 204 feed means no release is published and never authorizes installation.

Upload failure or cancellation removes temporary files and uncommitted objects when rollback is known. A lost database commit response preserves the object because the publication might already be durable. Storage maintenance owns such unreferenced objects. Browser cancellation can race a committed publication; administrators refresh the list before retrying. Ingress limits and temporary-disk capacity must cover each concurrent upload.

The [signed desktop update decision](2026-10-20-signed-desktop-updates.md) continues to own initial trust, key rotation, user confirmation, cancellation and native installer handoff. This note owns API publication and retains that independent security rationale. [API deployment settings](../../../../apps/api/README.md#desktop-releases) own operational configuration.

## Alternatives considered

**Signing in the API or browser.** Offline signing keeps a compromised administration session or artifact store from manufacturing a release accepted by installed clients.

**Buffering the complete installer.** Streaming through a bounded temporary file avoids allocating an installer-sized buffer and permits exact verification before durable publication. Presigned uploads require externally reachable storage and browser CORS configuration; API streaming uses the deployment's existing private storage endpoint.

## Consequences

The release key must remain available for future builds, and every target needs its own feed. Initial installations need a trusted installer with pinned settings. macOS updates still open a verified DMG for explicit application replacement; Apple signing and notarization remain separate.

Isolated PostgreSQL acceptance covers authorization, signature rejection, size/hash failures, immutable downloads, storage failures, concurrent publication and rollback cleanup. Native updater tests cover empty feeds and authenticated installer handoff; Admin request tests verify File uploads, cancellation and signed-size checks. The publication result is pinned in an owner-local expected file because this control-plane operation has no Session transcript. A local browser run also publishes a signed installer through the real API and MinIO, then downloads matching bytes from the public installer route.
