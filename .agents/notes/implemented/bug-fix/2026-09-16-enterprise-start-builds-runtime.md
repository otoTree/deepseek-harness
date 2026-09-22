# Agent Note: Enterprise start rebuilds development artifacts

Status: implemented

English | [中文](2026-09-16-enterprise-start-builds-runtime.zh.md)

## Problem

The enterprise start command could launch API and desktop processes with stale workspace libraries or browser bundles. Electrobun's development command rebuilt only its frontend and plugins, while the desktop runtime resolved workspace packages through generated `lib` files and the session-controller client bundle. The application bundle also copied the enterprise Client Host entry without its package dependencies, so Cordis could fail on its first import even after Electrobun reported a successful build.

## Decision

`pnpm run enterprise:start` runs `pnpm run enterprise:build` before infrastructure checks or application processes. The build refreshes the Host library graph and every Client bundle. When `--desktop` is present, startup also runs `pnpm run enterprise:build:desktop`, which rebuilds the Electrobun frontend, plugin bundles, native helper, runtime, generated iconset, and development app bundle before selecting the desktop package's `dev:prepared` entry. The enterprise Client Host entry bundles every non-builtin dependency. A post-build check copies the staged entry outside the workspace and imports it with plain Node, so the build fails when that entry still depends on workspace package resolution. The development runtime uses `apps/electrobun/scripts/dev-runtime` for the local DSH executable; the generated workspace artifacts and Electrobun resources it imports are refreshed in the same start operation. A failed build prevents the stack from spawning.

## Alternatives considered

**Build only from `apps/electrobun`'s `dev` script.** That command does not rebuild workspace Host libraries or the session-controller client bundle, so stale package output remains possible.

**Compile only the packaged Bun runtime on every development start.** The desktop app bundle itself must be rebuilt because `electrobun dev` launches the existing app bundle and does not copy the latest frontend or main-process resources. The runtime helper remains pointed at `apps/electrobun/scripts/dev-runtime`, so the compiled `build/dsh` executable is not selected for local DSH launches.

**Build only the session-controller Client bundle.** Client plugins such as the chat and trajectory renderers bundle shared browser dependencies independently. Rebuilding only the controller can leave a subscriber on an older copy of the same helper.

## Consequences

Every enterprise start pays the required build cost and fails early when generated output cannot be refreshed or a copied Host plugin lacks its runtime dependencies. The command does not claim a running stack while an older library or browser bundle is still selected. The rebuilt application contains `build/dsh`, while the local DSH process selected by `dev:prepared` continues to use the source-loading development helper.
