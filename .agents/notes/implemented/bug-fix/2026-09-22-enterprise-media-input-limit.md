# Agent Note: Separate enterprise media and response limits

Status: implemented

English | [中文](2026-09-22-enterprise-media-input-limit.zh.md)

## Problem

The enterprise desktop gateway used its model-response byte limit while reading video, audio, and document attachments. A media file below the configured model and API request limits could therefore fail locally at the smaller response limit.

## Decision

The enterprise gateway has separate `maxMediaBytes` and `maxResponseChars` settings. The generated desktop profile allows media up to the platform's 512 MiB validation ceiling while retaining the 16 MiB response safety limit. Media reads use `maxMediaBytes`; streamed model output and gateway metadata continue to use `maxResponseChars`.

## Alternatives considered

**Raise `maxResponseChars` for every payload:** Rejected because model responses and metadata would lose their independent memory bound.

**Remove the desktop media guard:** Rejected because the client still needs a bounded read before constructing provider upload requests.

## Consequences

The model catalog and API request-body limits remain authoritative for provider calls. The desktop profile no longer rejects an attachment solely because it is larger than the response limit. A deployment must still configure the selected model's per-file and request limits, and the API's request-body limit must be large enough for the intended media.

## Testing

The profile test checks that both limits are emitted independently, and the gateway fixture supplies the new media setting. The desktop provider typecheck and focused tests cover the updated configuration contract.
