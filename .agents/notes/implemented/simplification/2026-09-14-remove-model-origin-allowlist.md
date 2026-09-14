# Agent Note: Remove the enterprise model-origin allowlist

Status: implemented

English | [中文](2026-09-14-remove-model-origin-allowlist.zh.md)

## Problem

The enterprise deployment has one platform administrator, but saving a model required a separate origin allowlist entry. A missing environment variable made otherwise valid public model endpoints fail with an opaque 400 response and added configuration work that did not match this deployment's ownership model.

## Decision

The model directory accepts any public HTTPS endpoint. The gateway still rejects credentials embedded in URLs, query strings, fragments, and literal IP addresses. Its connection-time DNS lookup rejects forbidden private and special-use IPv4 ranges before sending the stored model credential. The per-model API key remains encrypted at rest and model writes remain restricted to platform administrators.

The origin allowlist configuration and generated environment variable are removed. If a deployment later needs destination-specific policy, it must add an explicit policy at the owning deployment boundary rather than silently reintroducing a required setting for all installations.

## Alternatives considered

**Keep the required allowlist and document the setup.** Rejected because it turns a single-administrator local workflow into a two-step configuration task and fails before the model request can provide a useful diagnostic.

**Allow every URL without transport and DNS checks.** Rejected because HTTPS alone does not prevent credentials in URL components or requests to private addresses after DNS resolution.

**Make the allowlist optional with an empty value meaning unrestricted.** Rejected because it retains two operating modes and an obsolete configuration surface without benefit for the current single-administrator deployment.

## Consequences

Platform administrators can save any compatible public HTTPS model service without editing environment files. The server continues to protect the highest-risk outbound destinations and never exposes the stored key in a tenant response. Deployments that require a fixed provider set no longer receive that control from this package and must supply an explicit network or deployment policy before reintroducing one.

## Testing

Gateway tests accept multiple public HTTPS origins and continue to reject plaintext, credential-bearing, query-bearing, and literal-IP URLs. API and admin type checks, the model-capacity regression test, and the API build pass with the configuration field removed.
