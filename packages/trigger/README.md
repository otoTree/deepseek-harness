---
description: "Managed timer and file event delivery to Sessions."
kind: "package-group"
---

# trigger/ — managed event delivery

English | [中文](README.zh.md)

## Summary

The [trigger package](trigger/README.md) owns timer, local-file and cloud-file providers, durable rule revisions, batching and Session delivery. The enterprise Host registers cloud access and presents rule management over RPC.

## Table of Contents

- [Ownership](#ownership)
- [Dev Note](#dev-note)

## Ownership

The [Session subsystem](../../docs/subsystems/session.md) owns the destination inbox and persisted Session identity. Trigger delivery queues an ordinary user message; a successful enqueue does not imply Agent completion.

## Dev Note

See the [enterprise trigger decision](../../.agents/notes/implemented/feature/2026-09-24-enterprise-triggers.md).
