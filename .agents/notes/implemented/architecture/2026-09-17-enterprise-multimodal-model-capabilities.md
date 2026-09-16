# Agent Note: Enterprise multimodal model capability metadata

Status: implemented

English | [中文](2026-09-17-enterprise-multimodal-model-capabilities.zh.md)

## Problem

The enterprise model directory exposed only a boolean image flag while the shared LLM seam already carried protocol and input-modality metadata, so a platform model could not advertise its wire protocol or be selected as an image-capable route without client-specific assumptions.

## Decision

The enterprise model record now stores a wire protocol, declared input modalities, and a file-input policy with backward-compatible defaults. The platform and tenant model contracts expose these fields, and the Admin model editor owns their configuration. The enterprise desktop gateway consumes the catalog through its existing LLM adapter plugin, preserves only the modalities currently supported by the shared vocabulary, and resolves durable image references through the attachment service before encoding read-only bytes as OpenAI `data:` URLs. The API relay continues to forward the resulting request transparently and rejects protocols it cannot yet stream and meter. Ark-specific Files API handling, video, audio, document projection, and signed object-storage URLs remain deferred to a separate provider capability rather than entering the Agent Loop or the provider-neutral attachment service.

## Alternatives considered

**Add Ark branches to Agent Loop or session code.** Rejected because protocol selection and media projection belong to the LLM adapter and attachment seams; loop changes would couple every provider and require new durable representations.

**Pass permanent object-storage URLs to the model.** Rejected because bearer URLs can outlive authorization and leak storage topology; the current desktop path reads verified attachment bytes and emits a request-scoped Data URL.

**Make the API rewrite every multimodal protocol.** Rejected because the relay is intentionally protocol-transparent and should not become a second provider implementation; unsupported protocols fail explicitly until their adapter and usage observer exist.

## Consequences

Existing clients remain valid through defaults for `openai-completions`, text input, and no provider Files API. Admin can publish capability metadata for future routes, while enterprise image-capable routes now use the shared attachment lifecycle and OpenAI-compatible inline image representation. Data URLs increase request size and are bounded by the existing attachment limits; no image bytes or credentials enter diagnostics. Video, audio, documents, provider file lifecycle, and signed URL projection require a follow-up capability seam and migration.

## Testing

Enterprise API and desktop type checks pass. API contract and integration tests pass with legacy model payloads, defaulted capability fields, and the new migration. The desktop gateway suite verifies durable image bytes become a `data:image/...;base64,...` content item and all existing relay, stream, cancellation, and usage tests remain green.
