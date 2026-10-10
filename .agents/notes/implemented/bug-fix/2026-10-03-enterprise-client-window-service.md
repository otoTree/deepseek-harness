# Agent Note: Enterprise Client targets receive the window capability service

Status: implemented

English | [中文](2026-10-03-enterprise-client-window-service.zh.md)

## Problem

Enterprise Client targets could declare `clientWindow`, but the browser target reconciler mounted them with only `pluginSdk`. A rail contribution could render successfully and then fail on click because its injected window capability had no callable `open` method. The shared target mount helper also assigned the SDK and window services the same Cordis isolation label, which made the two providers collide when both were supplied.

## Decision

The enterprise Client reconciler creates the restricted window service from the target's existing authenticated transport and passes it to `mountPluginTarget`. The mount helper assigns independent isolation labels to `pluginSdk` and `clientWindow`, so both services can be provided to one target without sharing a service-store key. Window operations remain transport-backed and limited to manifest-declared contributions.

Independent window URLs now remain in the Client target boot path while skipping the main application renderer. A window contribution can therefore replace the mount point with its own surface instead of showing a second copy of the DSH shell.

## Consequences

Client targets that declare `clientWindow` now receive the same open, close, focus, and list service used by the Host-owned window registry. Targets that do not request the capability keep the existing SDK-only composition. The service remains scoped to one activation and is disposed with that target.

## Testing

The enterprise Client runtime test mounts a target that calls `ctx.clientWindow.open()` and verifies the operation crosses the plugin SDK relay. The plugin runtime test mounts a target with both injected services and verifies both are isolated from the parent context.

## Alternatives considered

**Call the window platform directly from the plugin bundle.** Rejected because native window creation belongs to the Host-owned registry and must not expose URLs, native handles, or broker credentials to plugin code.

**Keep one shared isolation label and provide both services in one fiber.** Rejected because Cordis uses the label as the service-store key; different services would overwrite each other rather than share a target lifetime.
