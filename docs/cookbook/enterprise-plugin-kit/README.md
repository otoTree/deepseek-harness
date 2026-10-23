# Enterprise plugin development kit

English | [中文](README.zh.md)

This directory is a standalone authoring kit for a trusted Harness enterprise plugin. It intentionally mixes documentation, SDK release archives, a working Host/Client/Skill/MCP example, a manifest, and packaging scripts. Copy this directory outside the Harness repository before editing. The extracted kit is the authoring workspace; the final `.dsh-plugin.zip` is the only file sent to the platform.

## Contents

| Path | Purpose |
| --- | --- |
| `docs/sdk.md` | SDK capability reference, package versions, transport rules, and lifecycle behavior. |
| `docs/slots.md` | The current 57-key Client Slot index. `docs/slot-catalog.json` contains register options, owner props, framework props, examples, and source pointers. |
| `sdk/*.tgz` | Offline-installable `protocol`, `sdk`, and `runtime` package archives from the matching platform release. |
| `src/host.ts` | Host example that registers a Tool, Skill, and optional MCP bridge through the injected SDK. |
| `src/client.ts` | Client example that contributes a settings panel through `settings.section`. |
| `packages/standard/package.json` | Cordis package metadata required by schema v3. |
| `presets/default/agent.cordis.yml` | Declarative Agent preset that composes the example package without replacing the Agent loop. |
| `scripts/build.mjs` | Bundles Host and Client entries into the schema v3 archive paths. |
| `scripts/package.mjs` | Writes the lockfile digest, computes entry integrity, and creates the `.dsh-plugin.zip`. |
| `scripts/verify.mjs` | Reopens the ZIP and verifies manifest, paths, package metadata, and hashes. |

## Start from the kit

1. Copy this directory to a separate repository and rename `pluginId`, package name, display text, and contribution ids.
2. Run `pnpm install`. The `sdk/*.tgz` files satisfy the Harness plugin protocol and SDK dependencies without a Harness checkout or registry access.
3. Edit `src/host.ts`, `src/client.ts`, `manifest.json`, and `packages/standard/package.json` together. Remove a target when the product does not provide it.
4. Run `pnpm run typecheck`, `pnpm run build`, `pnpm run package`, and `pnpm run verify:package`.
5. Upload `dist/acme-enterprise-plugin-1.0.0.dsh-plugin.zip` through the platform administrator flow. The platform performs the final compatibility, permission, integrity, and activation checks.

The kit is a reference implementation, not a platform runtime. It does not contain credentials, an Agent loop, a Host process, or a Client shell. The platform injects `pluginSdk`, `tools`, and `slots` when the verified entries are loaded.

## Contribution choices

- Host Tools call `ctx.tools.register()` and are visible to the Agent after the Host fiber activates.
- Skills call `ctx.pluginSdk.skills.register()` and are removed when the activation is disposed.
- MCP is an opt-in bridge in `src/host.ts`: add `mcp.connect`, a declared `mcp:*` contribution, and the platform's `contributions.mcpConnection` metadata only after choosing the server and authorization mode. The helper then calls `ctx.pluginSdk.mcp.connect()`, discovers tools, and registers qualified names into `ctx.tools`.
- Agent types are preset files under `presets/`; a preset composes packages and does not implement an Agent loop.
- Client UI uses `ctx.slots.inject()` followed by `ctx.slots.register()`. Start with an additive `list` or `keyed` Slot from [the Slot catalog](docs/slots.md). A `single` Slot replaces the shipped occupant and should only be used when the product intentionally owns that whole surface.

## Release boundary

The SDK archives in `sdk/` are versioned snapshots. Replace them only when the platform publishes a compatible release, then regenerate the Slot catalog from that same release. Do not import Harness `apps/`, `packages/`, database modules, or desktop source into the kit.
