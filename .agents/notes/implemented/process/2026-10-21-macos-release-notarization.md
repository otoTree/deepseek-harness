# Agent Note: Durable macOS release notarization

Status: implemented

English | [中文](2026-10-21-macos-release-notarization.zh.md)

## Problem

Apple notarization can remain pending after an installer build finishes. Rebuilding or uploading after a command timeout creates unrelated submissions, while stapling changes the bytes authenticated by desktop update metadata. Ad-hoc bundle signatures do not establish Developer ID or Gatekeeper trust.

## Decision

The [release builder](../../../../apps/electrobun/scripts/build-installer.ts) requires an explicit Developer ID identity, team and Keychain profile. The [signer](../../../../apps/electrobun/scripts/macos-signing.ts) signs regular Mach-O code without following symlinks, then nested frameworks and applications, then the outer app. Hardened runtime and timestamps apply to code; JIT/native-library entitlements support Node, Bun and CEF without debug access. The DMG is signed after the protected application's packaged profiles pass.

The [notarization owner](../../../../apps/electrobun/scripts/macos-notarization.ts) records the submitted file hash and Apple submission ID beside an immutable versioned release. It creates an exclusive upload-intent record before contacting Apple. An uncertain upload requires history-based recovery rather than automatic re-upload. A separate query command resumes that ID, rejects changed bytes or teams, and serializes finalization with a directory lock. A process killed while holding the lock requires an operator to establish that no finalizer remains before removing it.

Acceptance saves the audit log and staples a private copy. Developer ID verification, ticket validation, DMG integrity and Gatekeeper checks for both the DMG and copied app precede replacement of the release. The tracking record retains submitted and final hashes across the replacement. Only verified final bytes receive the final checksum; update metadata is signed afterward. Rejected submissions retain their logs and stop polling. Apple processing time and server-side cancellation are outside this tool's control.

The [local installer decision](../architecture/2026-10-19-local-desktop-installer-protection.md) retains obfuscation, staging and unsigned-identity local builds. The [update decision](../architecture/2026-10-20-signed-desktop-updates.md) retains Ed25519 release authentication and publication ordering. Neither is superseded by platform trust.

## Alternatives considered

**Resubmit after each timeout.** The timeout does not cancel Apple's work. Saving and querying one ID avoids duplicate queues and preserves the association with exact submitted bytes.

**Sign using recursive --deep.** Explicit inside-out signing assigns runtime entitlements to the executables that need them and verifies every component's team, timestamp and release configuration.

**Sign update metadata before stapling.** The metadata would authenticate a different installer. Final checksum and update signing follow verified ticket attachment.

## Consequences

Release operators keep passwords and private keys in Keychain, outside repository and artifact inputs. Local ad-hoc builds remain available without Apple credentials. Tests pin upload-intent durability, repeated pending queries, team/hash refusals, rejection logs and final-byte tracking. Unit fixtures do not prove Apple's acceptance or Gatekeeper trust; the real release path requires those checks before reporting success. The scripts do not upload to production, perform recurring scheduling or promise clean-machine native-module portability.
