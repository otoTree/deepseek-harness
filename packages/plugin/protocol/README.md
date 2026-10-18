---
description: "Manifest and capability contracts shared by enterprise plugin authors and the platform."
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-protocol

English | [中文](README.zh.md)

## Summary

This package defines branded plugin identities, standard package manifests, installation states, capability request types, and stable plugin errors. It contains no transport or service state.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Import `pluginManifest` at a package boundary and use the exported types for SDK and platform messages. Schema v2 keeps targets at the product level; schema v3 groups one or more Host and Client targets under Cordis packages with declared package names, versions, and dependencies. Each v3 package archive entry includes its `package.json`. A Client target declares the module-table `moduleId` registered by its standard `window.__ModuleLoader__.load(...)` bundle and structured `slot` or `window` contributions. Window contributions carry a surface, shell, locale key, bounded default size, and explicit `singleton` or `many` multiplicity. The protocol does not add a Cloud target.

A v3 package may include `presets` entries pointing to `presets/<id>/agent.cordis.yml`. The desktop Plugin Manager installs these files into the configured AgentPresets user root; AgentPresets remains responsible for discovery, composition, and disposal. A preset is declarative composition and cannot replace the Agent loop.

A slot contribution's `id` matches the Cordis registration selector: `key` for a keyed slot, or `id` for a list slot. For example, a `workbench.panel` registered with `key: media` declares contribution `id: media`. Contribution ids remain unique within each Client target, including contributions to different slots.

Manifest permissions authorize platform SDK calls for identity, models, storage, network, credentials, authorization, MCP, Skills and configuration. Network declarations specify allowed hosts and response limits. The parser validates declarations, and the Host enforces SDK grants. Trusted same-process Node packages can use native services and are not sandboxed by these permissions.

## Model Experience

### Protocol model context

#### What the model sees

No model-visible content is produced by this package. The runtime owns any plugin model request made through `PluginSdk`.

#### Token effect

No direct token effect; the enterprise gateway records tokens for the SDK call owner.

#### KV Cache effect

No direct cache effect; model providers own cache behavior for a request.


## Known Limitations and Deferred Work

- The manifest schema has no Cloud target declaration.

### Dev Note

None.

**Runtime invariant:** No runtime invariant companion is published. The package defines schemas and wire records without mutable service state.
