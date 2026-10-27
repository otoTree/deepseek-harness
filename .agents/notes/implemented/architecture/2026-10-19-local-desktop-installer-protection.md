# Agent Note: Local desktop installer protection

Status: implemented

English | [中文](2026-10-19-local-desktop-installer-protection.zh.md)

## Problem

The enterprise desktop needs installable macOS and Windows artifacts before an Apple Developer account is available. Development bundles include readable application JavaScript, TypeScript declarations and source maps. A native executable alone does not protect dynamically loaded Host and Client plugins, and a build launched beside the repository can accidentally select the development runtime.

## Decision

The [installer builder](../../../../apps/electrobun/scripts/build-installer.ts) builds a local Apple Silicon DMG with an ad-hoc signature. Developer ID releases follow the [durable notarization decision](../process/2026-10-21-macos-release-notarization.md). The application's package manifest owns its version. A separate temporary Electrobun project owns native staging and its lock; packaged metadata selects the stable channel, and development processes keep their existing resources. Release main-process compilation fixes packaged runtime selection, while explicit runtime overrides remain available to the operator. It also validates and embeds the build environment’s `ENTERPRISE_API_URL`, so an app launched from Finder retains its intended deployment. HTTPS origins and explicit HTTP loopback origins use the same validation as native login; malformed or insecure remote origins fail before packaging. Source development continues to read launch-time settings. Native account origins follow the [API-only authentication decision](2026-10-21-desktop-api-only-authentication.md).

On x64 Windows, the same builder prepares a host-native Electrobun projection, compiles the DPAPI credential helper and Node launcher with Zig or MSVC, and writes a stable `智域OS-Setup.zip`. The ZIP keeps Electrobun's `Setup.exe`, `.installer` metadata and Zstandard application payload together; the application is only installable when the archive is extracted as a whole. The local Windows artifact has no Authenticode identity. Its verifier checks the SHA-256 sidecar, x64 PE header, stable metadata and payload magic, while an interactive install remains a Windows-host acceptance step.

Native credential reads use a restricted platform environment. Both the [desktop credential store](../../../../apps/electrobun/src/keychain.ts) and the [enterprise request bridge](../../../../packages/client/ui-enterprise/src/index.ts) preserve Windows `LOCALAPPDATA` for DPAPI file lookup and `SystemRoot` for system libraries, with a system-only `PATH` and hidden helper windows. They exclude unrelated inherited variables. The [bridge regression](../../../../packages/client/ui-enterprise/tests/keychain-environment.host.spec.ts) checks platform environments, authenticated RPC results and rejection before HTTP when the helper fails.

The [resource protector](../../../../apps/electrobun/scripts/protect-build.ts) applies pinned `javascript-obfuscator` transformations to first-party JavaScript in Resources, including the shell, browser bundles, copied plugins and `@deepseek-ai` runtime dependencies. A native DSH launcher replaces itself with the bundled official Node to execute the protected on-disk CLI, preserving its PID and signal delivery. CLI and plugin imports resolve from the same shipped production dependency tree, which includes desktop dependencies and declared workspace peers. Dependency traversal and the deployment manifest omit the enterprise client’s bundled API dependency, preventing source-only server files from entering the runtime tree. The official Node archive matches the build host version and is checked against Node’s published SHA-256; its license ships with the app. Generated identifiers use a filename-derived prefix because Client combo scripts share one global scope. Strings use escaped literals resolved by the JavaScript parser; protected render paths perform no generated string-array lookup or Base64 decoding. Export names, property names and reflective service names remain stable. Source maps, source-map comments, TypeScript, native source files and environment files are removed from staging. Resource writes replace staged files so hard-linked build inputs remain unchanged. Third-party JavaScript and licenses remain available. The protector regression executes concatenated classic-script registrations and invokes both factories; file hashes alone do not prove browser execution. Module hashes detect accidental replacement or omission after protection; they do not provide cryptographic authenticity against an attacker who replaces the record.

Protection precedes verification and ad-hoc signing. The packaged-profile smoke runner locates the desktop project from its script URL, independent of its caller’s working directory. The [installer verifier](../../../../apps/electrobun/scripts/verify-installer.ts) checks the DMG checksum, copies the application outside the checkout, verifies the signed bundle and protected resources, and starts packaged enterprise Web profiles against a keyless local API fixture. On Windows it checks the complete extracted setup payload; the wrapper's post-wrap hook runs the packaged profile smoke before the ZIP is published. Configured and empty model catalogs exercise real dependency resolution and authenticated HTML. The [SDK executable distribution](2026-07-10-single-file-executable-sdk-runtime-distribution.md) retains its own packaging policy; [development startup](../bug-fix/2026-09-16-enterprise-start-builds-runtime.md) retains source runtime selection.

[Desktop branding](2026-10-21-zhiyu-desktop-brand.md) owns product names, icon artwork and the stable identity retained across renamed installers.

## Alternatives considered

**Archive resources without transformation.** Archives preserve the original JavaScript and source maps, so ordinary extraction reveals the application source.

**Minification alone.** Minification reduces size and removes comments but leaves application literals and much of the module structure readable. Identifier transformation and escaped literals add an independent obstacle while preserving ESM interoperability.

**Runtime string-array decoding.** Repeated lookups and Base64 decoding increase protected long-conversation switch costs. Parse-time escaped literals retain the source transformation without adding decoder calls to each render. The manual [browser benchmark](../../../../apps/web/tests/complex-history.perf.ts) can serve staged or installed Client resources and reports plugin lifecycle changes separately from script, style and layout time; it does not assert wall-clock thresholds.

**Bytecode-only Electrobun main process.** Electrobun 2.0.1 declares Cottontail bytecode configuration as unimplemented. The desktop uses Bun because the pinned Cottontail runtime crashes on the current Apple Silicon host. A bytecode-only shell would also leave browser and dynamically loaded plugin JavaScript exposed.

**Apple-trusted distribution without a developer identity.** Ad-hoc signing validates local code integrity but supplies no Developer ID identity or notarization ticket. Public Gatekeeper acceptance requires the separate Apple signing and notarization workflow.

## Consequences

Local builds provide installable artifacts and detect readable source/debug files in shipped resources. Obfuscation adds build time and reduces production stack readability. Client-side executable logic remains recoverable; protocols, public names and third-party code remain inspectable. Secrets must stay outside the application. The local smoke does not prove Intel support, clean-machine native-module portability, real-model operation, Windows publisher trust or Gatekeeper trust.
