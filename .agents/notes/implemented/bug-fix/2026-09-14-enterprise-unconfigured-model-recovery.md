# Agent Note: Recover the enterprise model after a late organization grant

Status: implemented

English | [中文](2026-09-14-enterprise-unconfigured-model-recovery.zh.md)

## Problem

The desktop profile is generated before an organization may have an authorized model. When the catalog is empty, the profile stores `enterprise-unconfigured`. A later organization grant updates the server catalog, but an already running desktop still submitted that sentinel and the gateway rejected the request as unavailable.

## Decision

The enterprise gateway resolves `enterprise-unconfigured` against the live authorized model catalog for both model resolution and streaming. An exact authorized model remains required for every other request. The selected catalog id is the id sent to the server, so the placeholder never crosses the model-call API.

## Alternatives considered

**Require a desktop restart after the organization grant.** Rejected because the gateway already owns a live authorization directory and can resolve the sentinel without replacing the running profile.

**Accept every unknown model as the first catalog entry.** Rejected because only the startup sentinel represents an intentionally empty catalog; arbitrary ids must remain unauthorized.

## Consequences

Granting the first model to an organization takes effect for an already running desktop when its next model request refreshes the live catalog. Existing profiles can still boot with no models and continue to report no available model until the organization grants one. Unauthorized non-sentinel ids remain rejected.

## Testing

The Electrobun gateway fixture covers live model discovery and model-call admission; the recovery path uses the same catalog and request assertions, while the unauthorized-model case continues to prove that arbitrary ids are not accepted.
