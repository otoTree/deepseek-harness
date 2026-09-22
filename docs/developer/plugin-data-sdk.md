---
description: "Current author-facing SDK contract for identity, text models, objects, database access, and cache."
---

# Plugin Data SDK

English | [中文](plugin-data-sdk.zh.md)

Plugin authors import `@deepseek-ai/dsh-plugin-sdk` and receive an installation-scoped `PluginSdk` from the Host or Client runtime. The SDK transport carries no platform, database, object-store, or model-provider credential. Every call is bound to the activation that created the SDK.

`identity.current()` returns the stable platform user id, name, avatar, email, organization context, and installation owner. A plugin cannot supply another user id to read a different profile.

The manifest must request the capability permission for each operation. `identity.read` permits the profile call, `models.text` permits model listing and text calls, `objects.read` and `objects.write` cover object reads and mutations, `database.query` and `database.transaction` are separate SQL grants, and `cache.read` and `cache.write` cover cache access. The server rejects a call when its permission is absent, even when the resource is declared.

`models.list()` returns enabled text models backed by the implemented OpenAI-compatible chat protocol. Models using an unimplemented protocol are omitted from the plugin catalog. `models.text()` accepts bounded system, user, and assistant messages, a model id, and an idempotency key. Calls return text and usage status. `models.textStream()` uses the same authorization and idempotency rules and yields server-sent text chunks followed by a terminal item.

When a plugin exposes an Agent tool, the tool result already enters the Session through the standard `tool/call` and `tool/result` events. Session projection reconstructs that result before a later model request. A direct SDK call made by a Client page is outside an Agent Session and does not create an Agent event.

Objects support versioned writes, reads with optional byte ranges, version listing, and deletion. Object keys are generated inside the platform data space. Downloads pass through activation authorization and never create a revocation-bypassing public URL.

The database methods accept parameterized SQL and bounded transaction batches. The enterprise infrastructure provisions `ENTERPRISE_PLUGIN_DATABASE_URL` on a PostgreSQL service separate from the platform database. The API places each installation data space in a dedicated schema, rejects administrative and cross-schema statements, and rolls back a failed batch. Deployments without that service return `plugin/data-unavailable`; the platform database is never exposed.

Release manifests carry ordered migration statements. An upgrade applies unapplied versions in the data-space transaction before the new release is marked active; a failed migration leaves the installation on its previous release.

The cache supports get, set with TTL, delete, and atomic increment in an installation namespace. Cache values are not an authorization or billing source and must not be the only copy of business data.

All methods accept `AbortSignal` where the protocol supports cancellation. Callers should retry only idempotent operations with the same idempotency key. A revoked activation, stale permission revision, invalid resource, quota violation, timeout, or cancellation produces a stable `plugin/*` error code.
