# Agent Note: Enterprise start rebuilds development artifacts

Status: implemented

English | [中文](2026-09-16-enterprise-start-builds-runtime.zh.md)

## Problem

The enterprise start command could launch API and desktop processes with stale workspace libraries or browser bundles. Electrobun's development command rebuilt only its frontend and plugins, while the desktop runtime resolved workspace packages through generated `lib` files and the session-controller client bundle. A successful-looking window could therefore execute code from an earlier build.

## Decision

`pnpm run enterprise:start` runs `pnpm run enterprise:build` before infrastructure checks or application processes. The build refreshes the Host library graph and every Client bundle. When `--desktop` is present, startup also runs `pnpm run enterprise:build:desktop` to refresh the Electrobun frontend and plugins, then selects the desktop package's `dev:prepared` entry so those assets are not rebuilt a second time. The development desktop continues to use `apps/electrobun/scripts/dev-runtime`, which loads the current CLI source; the generated workspace artifacts it imports are now refreshed in the same start operation. A failed build prevents the stack from spawning.

## Alternatives considered

**Build only from `apps/electrobun`'s `dev` script.** That command does not rebuild workspace Host libraries or the session-controller client bundle, so stale package output remains possible.

**Compile the packaged Bun runtime on every development start.** The development runtime intentionally uses the source launcher and repository profile graph. Compiling `build/dsh` adds release-only packaging work without changing the process used by the development window.

**Build only the session-controller Client bundle.** Client plugins such as the chat and trajectory renderers bundle shared browser dependencies independently. Rebuilding only the controller can leave a subscriber on an older copy of the same helper.

## Consequences

Every enterprise start pays the required build cost and fails early when generated output cannot be refreshed. The command no longer claims a running stack while an older library or browser bundle is still selected. Release packaging remains responsible for `build:runtime`; development startup does not produce or select that packaged binary.
