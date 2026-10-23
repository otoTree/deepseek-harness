# Agent Note: Signed desktop full-installer updates

Status: implemented

English | [中文](2026-10-20-signed-desktop-updates.zh.md)

## Problem

Installed enterprise desktops need a verifiable path to newer releases. An HTTPS download and an adjacent checksum do not independently authenticate the publisher when storage is compromised. Platform publisher identities are unavailable for the local installers, and replacing a running desktop can leave its owned Runtime active.

## Decision

The [native updater](../../../../apps/electrobun/src/desktop-updates.ts) authenticates releases for startup discovery and user-requested installation. [Startup update notification](2026-10-23-startup-desktop-update-notification.md) owns discovery timing and notification dismissal; this note retains release authentication and installer handoff. The installer build embeds one HTTPS feed URL and one Ed25519 SPKI public key; missing pairs fail configuration, and omitted pairs disable updates. The [release signer](../../../../apps/electrobun/scripts/sign-update.ts) keeps the private key outside build inputs and signs exact payload bytes containing application identity, semantic version, platform, download URL, size, SHA-256 and release notes. The client authenticates before parsing those fields. It accepts only a matching platform and a greater semantic version. This trust model requires a trusted initial installer and protects neither a compromised signing key nor a local administrator.

Downloads stream into exclusive owner-only files inside private temporary directories. Manifest reads are bounded; HTTPS redirects cannot introduce HTTP or URL credentials. Verification finishes before Windows ZIP extraction or native installer handoff. The native menu exposes cancellation, concurrent checks share one interaction, and quit aborts and awaits active I/O while invalidating late dialog results. Installation asks for a second confirmation, stops the owned Runtime through the existing quit guard, opens the full installer, then permits native exit. A quit already in progress rejects an additional installer callback. Installer launch failures remain visible and permit a normal quit.

Settings → General exposes the same native interaction through the trusted WebView's parameterless `checkForUpdates` RPC. The enterprise Client contributes this row only when the native bridge is available, including bridge readiness after Client activation; browser deployments hide it. The button remains disabled until the native interaction settles, and an RPC failure permits retry. Feed configuration, release authentication and installer paths remain native-owned so the Settings entry cannot select another publisher or duplicate download state.

The [local installer protection decision](2026-10-19-local-desktop-installer-protection.md) continues to own artifact construction and obfuscation; it is not superseded by release authentication. The [native quit decision](2026-10-10-desktop-work-plugin-capabilities.md) continues to own the Runtime lifetime. [Desktop publishing instructions](../../../../apps/electrobun/README.md#desktop-updates) own key setup and feed publication.

[Admin release publication](2026-10-21-admin-desktop-release-publication.md) owns API uploads, private artifact storage and serialized publication; this note retains native release authentication and installer handoff.

[macOS notarization](../process/2026-10-21-macos-release-notarization.md) finalizes Apple tickets and checksums before update metadata is signed.

## Alternatives considered

**Electrobun's automatic delta updater.** Full verified DMG/ZIP artifacts reuse the local installers and leave replacement visible to the user. Automatic patch application adds a separate artifact and installation protocol that is unnecessary for this release path.

**TLS and SHA-256 sidecars alone.** An attacker controlling artifact storage can replace both the installer and sidecar. A public key embedded in an already trusted client authenticates metadata independently of that storage.

**Silent replacement while Runtime runs.** The Runtime and Windows installer carry native executables and shared resources. Stopping owned work before handoff prevents replacement from overlapping that work; macOS replacement remains an explicit Finder operation.

## Consequences

Static HTTPS hosting can distribute authenticated full installers without holding the release private key. Feed publication follows immutable artifact upload. Builds without pinned settings explain that updates are unavailable. Key rotation requires another trusted installer. Older clients cannot automatically acquire this updater, and signed feeds do not replace Apple notarization or Authenticode. There is no automatic restart, delta protocol, data downgrade or background polling. A successful handoff retains temporary files for the external installer; operating-system temporary cleanup owns their eventual removal.

Focused tests authenticate signed payloads and reject signature, platform, URL, size and hash failures; barrier-based tests cover cancellation, late dialogs and cleanup-before-handoff. An owner-local expected output pins native prompts without inventing a Session transcript. The signer runs as a real subprocess with a temporary key and fixture artifact. Interactive Windows Setup, macOS DMG replacement, OS trust dialogs and upgrades on clean machines require platform-host acceptance.
