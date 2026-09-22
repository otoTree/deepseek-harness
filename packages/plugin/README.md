---
description: "Shared protocol, author SDK, and runtime bindings for enterprise Cordis plugins."
kind: "package-group"
---

# Plugin packages

English | [中文](README.zh.md)

## Summary

The plugin package group defines the contracts used by enterprise plugins after the platform installs and activates them. `plugin-protocol` owns manifest and capability types, `plugin-sdk` creates an installation-scoped facade, and `plugin-runtime` binds that facade to a Cordis activation lifetime.

The broader plugin activation model is documented on the [extensions subsystem page](../../docs/subsystems/extensions.md).

## Packages

| Package | Role |
|---|---|
| [`protocol/`](protocol/README.md) | Manifest, identity, lifecycle, capability, and error contracts |
| [`sdk/`](sdk/README.md) | Author-facing identity, model, object, database, and cache facade |
| [`runtime/`](runtime/README.md) | Host/Client binding and disposer helpers |

## Known Limitations and Deferred Work

The first release has no background task API, Cloud target runtime, or image/video generation facade. Plugin execution remains trusted Cordis code in the hosting process.

## Dev Note

None.
