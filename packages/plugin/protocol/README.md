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

Import `pluginManifest` at a package boundary and use the exported types for SDK and platform messages. The parser accepts Client and Host targets plus object, database, and cache declarations. It does not add background execution or Cloud target declarations.

Manifest permissions use the fixed first-release vocabulary: `identity.read`, `models.text`, separate object read/write grants, separate database query/transaction grants, and separate cache read/write grants. The runtime checks the requested grant on every capability call.

## Model Experience

### Protocol model context

#### What the model sees

No model-visible content is produced by this package. The runtime owns any plugin model request made through `PluginSdk`.

#### Token effect

No direct token effect; the enterprise gateway records tokens for the SDK call owner.

#### KV Cache effect

No direct cache effect; model providers own cache behavior for a request.


## Known Limitations and Deferred Work

- The manifest schema exposes text model capabilities only. Image/video generation and Cloud target fields require a later protocol version.

### Dev Note

None.
