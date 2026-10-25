# Agent Note: Session-scoped advisory model catalogs

Status: implemented

English | [中文](2026-10-25-session-scoped-model-catalog.zh.md)

## Problem

A Host-generation catalog can load before cloud recovery and can describe a deployment default belonging to another project. A durable project model then remains selected while its original composer shows an internal route and omits that project's other model choices.

## Decision

The [model-directory resolver](../../../../packages/client/ui-model-selection/src/client/service.ts) accepts one optional Session catalog source. Both original selection entries retain the same directory and original selection command. A source supplies presentation metadata only; it never changes deployment defaults, durable model selections or accepted calls. Null delegates to the shared Host catalog. Failed reads remain retryable. While scoped metadata is unavailable, the original Host catalog supplies only provider availability and the durable selection; its names and choices never enter the scoped directory. Session disposal, source replacement and connection reset cancel scoped reads and suppress late results. Removing the source restores shared discovery. Deployments without a source retain shared discovery and reconnect behavior.

The Arivo startup plugin registers the source through its authenticated local RPC. The Host derives project authority from the original active Session cwd and the verified native folder registration. The native handle verifies current cloud ownership and the configured tool-capable model, and the adapter lists only that billing project's models. Foreign routes, missing settings, removed models and account replacement fail visibly; they cannot fall back to another project's catalog. Original unbound Harness directories retain shared discovery. No model generation or credit charge occurs during discovery.

## Alternatives considered

**Change the global default when opening a project.** This changes unrelated conversations and gives concurrent project selectors one mutable catalog. Scoped presentation preserves explicit Session choices.

**Store display names in the browser.** Cached names do not establish current authorization or model availability. The native account owner reads current online metadata.

## Consequences

The optional source extends the existing selector service; it adds no Agent loop, selector UI or enterprise account dependency. Project data and conversation journals retain their existing storage. Whole-project storage activation and formal native/Windows release acceptance remain separate work.

## Testing

Resolver tests cover two simultaneous projects, cloud recovery, unchanged default and selections, source registration/removal, shared fallback, addressed subagent refusal, connection reset, Session disposal and late old-account replies. Native catalog tests cover exact billing routes, missing settings, foreign entries, revoked scope, cancellation and handle disposal. Recorded Agent replay resolves the scoped name before exercising the original tool loop. Packaged product acceptance checks the visible name after a full Host restart and cloud recovery.
